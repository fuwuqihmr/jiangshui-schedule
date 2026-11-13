package cn.local.tomorrow;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;

/**
 * Android 应用内更新：检查 GitHub Release、下载、校验并拉起系统安装器。
 *
 * 安全边界：
 * - 只访问 api.github.com 与 GitHub 资产下载域名；
 * - 只从内存中缓存的候选 Release 下载，不接受 JS 传入的 URL/路径；
 * - 下载后必须同时通过 SHA-256 与签名证书指纹校验才允许安装；
 * - 不采集或上传设备信息。
 */
public class UpdateChecker {
    private static final String TAG = "UpdateChecker";
    private static final String PREFS = "app-update";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_LAST_AUTO_CHECK = "lastAutoCheckAt";
    private static final String KEY_SKIPPED = "skippedVersion";
    private static final String API_URL = "https://api.github.com/repos/fuwuqihmr/jiangshui-schedule/releases?per_page=30";
    private static final String EXPECTED_CERT_SHA256 = "005b1bf12f8ace80673546a284dbb0592cde5804c8a19957ac05b9899a46cb0c";
    private static final long DAY_MS = 24L * 60L * 60L * 1000L;
    private static final long MAX_JSON_BYTES = 512L * 1024L;
    private static final long MAX_CHECKSUM_BYTES = 4096L;
    private static final long MAX_APK_BYTES = 100L * 1024L * 1024L;
    private static final long CONNECT_TIMEOUT_MS = 8000L;
    private static final long READ_TIMEOUT_MS = 8000L;
    private static final int MAX_REDIRECTS = 5;
    private static final String UPDATE_DIR = "updates";
    private static final String UPDATE_FILE = "update.apk";
    private static final Pattern TAG_PATTERN = Pattern.compile("^v?(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?$");
    private static final Pattern IDENTIFIER_PATTERN = Pattern.compile("^([A-Za-z]*)(\\d*)$");
    private static final Pattern SHA256_PATTERN = Pattern.compile("^[0-9a-fA-F]{64}$");

    interface ProgressSink { void onProgress(JSONObject payload); }
    interface ResultSink { void deliver(JSONObject result); }

    private final Activity activity;
    private final ProgressSink progressSink;
    private final SharedPreferences prefs;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean checking = new AtomicBoolean(false);
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private volatile boolean cancelled = false;
    private volatile boolean destroyed = false;
    private volatile boolean pendingInstall = false;
    private volatile HttpsURLConnection activeConnection;
    private volatile Release latest;
    private volatile File verifiedFile;
    private volatile String verifiedVersion;

    UpdateChecker(Activity activity, ProgressSink progressSink) {
        this.activity = activity;
        this.progressSink = progressSink;
        this.prefs = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
    }

    static final class Version implements Comparable<Version> {
        final int major;
        final int minor;
        final int patch;
        final String pre;

        Version(int major, int minor, int patch, String pre) {
            this.major = major;
            this.minor = minor;
            this.patch = patch;
            this.pre = pre;
        }

        static Version parse(String raw) {
            if (raw == null) return null;
            String value = raw.trim();
            if (value.isEmpty() || value.length() > 80) return null;
            Matcher matcher = TAG_PATTERN.matcher(value);
            if (!matcher.matches()) return null;
            try {
                return new Version(Integer.parseInt(matcher.group(1)), Integer.parseInt(matcher.group(2)),
                        Integer.parseInt(matcher.group(3)), matcher.group(4));
            } catch (NumberFormatException error) {
                return null;
            }
        }

        @Override public String toString() {
            return major + "." + minor + "." + patch + (pre == null ? "" : "-" + pre);
        }

        @Override public int compareTo(Version other) {
            int result = Integer.compare(major, other.major);
            if (result != 0) return result;
            result = Integer.compare(minor, other.minor);
            if (result != 0) return result;
            result = Integer.compare(patch, other.patch);
            if (result != 0) return result;
            if (pre == null && other.pre == null) return 0;
            if (pre == null) return 1;
            if (other.pre == null) return -1;
            return comparePrerelease(pre, other.pre);
        }
    }

    private static int comparePrerelease(String left, String right) {
        String[] a = left.split("[.-]");
        String[] b = right.split("[.-]");
        int count = Math.min(a.length, b.length);
        for (int i = 0; i < count; i++) {
            int result = compareIdentifier(a[i], b[i]);
            if (result != 0) return result;
        }
        return Integer.compare(a.length, b.length);
    }

    private static int compareIdentifier(String left, String right) {
        Matcher a = IDENTIFIER_PATTERN.matcher(left);
        Matcher b = IDENTIFIER_PATTERN.matcher(right);
        if (a.matches() && b.matches()) {
            String prefixA = a.group(1).toLowerCase(Locale.US);
            String prefixB = b.group(1).toLowerCase(Locale.US);
            if (!prefixA.equals(prefixB)) return prefixA.compareTo(prefixB) < 0 ? -1 : 1;
            String numberA = stripLeadingZeros(a.group(2));
            String numberB = stripLeadingZeros(b.group(2));
            if (numberA.isEmpty() && numberB.isEmpty()) return 0;
            if (numberA.isEmpty()) return -1;
            if (numberB.isEmpty()) return 1;
            if (numberA.length() != numberB.length()) return numberA.length() < numberB.length() ? -1 : 1;
            int result = numberA.compareTo(numberB);
            return result == 0 ? 0 : (result < 0 ? -1 : 1);
        }
        String valueA = left.toLowerCase(Locale.US);
        String valueB = right.toLowerCase(Locale.US);
        int result = valueA.compareTo(valueB);
        return result == 0 ? 0 : (result < 0 ? -1 : 1);
    }

    private static String stripLeadingZeros(String value) {
        int index = 0;
        while (index < value.length() - 1 && value.charAt(index) == '0') index++;
        return value.substring(index);
    }

    static final class Release {
        final Version version;
        final String tag;
        final boolean prerelease;
        final String notes;
        final String publishedAt;
        final String apkName;
        final String apkUrl;
        final String checksumUrl;

        Release(Version version, String tag, boolean prerelease, String notes, String publishedAt,
                String apkName, String apkUrl, String checksumUrl) {
            this.version = version;
            this.tag = tag;
            this.prerelease = prerelease;
            this.notes = notes;
            this.publishedAt = publishedAt;
            this.apkName = apkName;
            this.apkUrl = apkUrl;
            this.checksumUrl = checksumUrl;
        }

        boolean hasAssets() {
            return apkName != null && apkUrl != null && checksumUrl != null;
        }
    }

    JSONObject info() {
        JSONObject result = new JSONObject();
        try {
            result.put("enabled", prefs.getBoolean(KEY_ENABLED, true));
            result.put("currentVersion", currentVersion());
            result.put("skippedVersion", prefs.getString(KEY_SKIPPED, ""));
            result.put("lastAutoCheckAt", prefs.getLong(KEY_LAST_AUTO_CHECK, 0L));
        } catch (Exception failure) {
            return error("storage", "读取更新设置失败");
        }
        return result;
    }

    JSONObject setEnabled(boolean enabled) {
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply();
        JSONObject result = ok();
        try {
            result.put("enabled", enabled);
        } catch (Exception ignored) {
        }
        return result;
    }

    JSONObject skip(String rawVersion) {
        Version version = Version.parse(rawVersion);
        if (version == null) return error("version", "版本号格式不正确");
        prefs.edit().putString(KEY_SKIPPED, version.toString()).apply();
        JSONObject result = ok();
        try {
            result.put("skippedVersion", version.toString());
        } catch (Exception ignored) {
        }
        return result;
    }

    void check(boolean manual, ResultSink sink) {
        if (destroyed) return;
        if (downloading.get()) {
            sink.deliver(error("busy", "正在处理，请稍候"));
            return;
        }
        if (!manual) {
            if (!prefs.getBoolean(KEY_ENABLED, true)) {
                sink.deliver(skipped("disabled", "自动检查已关闭"));
                return;
            }
            long last = prefs.getLong(KEY_LAST_AUTO_CHECK, 0L);
            long now = System.currentTimeMillis();
            if (last > 0L && now - last < DAY_MS) {
                sink.deliver(skipped("rate", "今天已经自动检查过"));
                return;
            }
            prefs.edit().putLong(KEY_LAST_AUTO_CHECK, now).apply();
        }
        if (!checking.compareAndSet(false, true)) {
            sink.deliver(error("busy", "正在处理，请稍候"));
            return;
        }
        executor.execute(() -> {
            JSONObject output;
            try {
                Release best = fetchBestRelease();
                String current = currentVersion();
                Version currentVersion = Version.parse(current);
                if (best == null) {
                    latest = null;
                    output = noUpdate(current);
                } else if (currentVersion == null) {
                    output = error("version", "当前版本号无法识别，暂时无法检查更新");
                } else if (best.version.compareTo(currentVersion) <= 0) {
                    latest = null;
                    output = noUpdate(current);
                } else if (!manual && best.version.toString().equals(prefs.getString(KEY_SKIPPED, ""))) {
                    latest = best;
                    output = noUpdate(current);
                    output.put("skipped", true);
                } else {
                    latest = best;
                    output = available(best, current);
                }
            } catch (UpdateException failure) {
                output = error(failure.code, failure.getMessage());
            } catch (Exception failure) {
                Log.w(TAG, "check failed", failure);
                output = error("network", "网络连接失败，请检查网络后重试");
            } finally {
                checking.set(false);
            }
            sink.deliver(output);
        });
    }

    void download(ResultSink sink) {
        if (destroyed) return;
        if (!downloading.compareAndSet(false, true)) {
            sink.deliver(error("busy", "正在处理，请稍候"));
            return;
        }
        cancelled = false;
        verifiedFile = null;
        verifiedVersion = null;
        executor.execute(() -> {
            File part = null;
            File target = null;
            JSONObject output;
            try {
                Release release = latest;
                if (release == null) throw new UpdateException("not_ready", "请先检查更新");
                if (!release.hasAssets()) throw new UpdateException("asset_missing", "发布资产不完整，已停止更新");
                File dir = new File(activity.getCacheDir(), UPDATE_DIR);
                if (!dir.isDirectory() && !dir.mkdirs()) throw new UpdateException("storage", "本机存储空间不足或文件写入失败");
                part = new File(dir, UPDATE_FILE + ".part");
                target = new File(dir, UPDATE_FILE);
                if (part.exists() && !part.delete()) throw new UpdateException("storage", "本机存储空间不足或文件写入失败");
                String expected = downloadChecksum(release.checksumUrl);
                String actual = downloadApk(release.apkUrl, part);
                if (!constantTimeEquals(expected, actual)) {
                    throw new UpdateException("checksum_mismatch", "安装包校验失败，已删除文件并阻止安装");
                }
                emitProgress(96, "verify", part.length(), part.length());
                verifyApk(part);
                if (target.exists() && !target.delete()) throw new UpdateException("storage", "本机存储空间不足或文件写入失败");
                if (!part.renameTo(target)) throw new UpdateException("storage", "本机存储空间不足或文件写入失败");
                verifiedFile = target;
                verifiedVersion = release.version.toString();
                mainHandler.post(() -> {
                    if (destroyed) return;
                    JSONObject installResult = installNow();
                    sink.deliver(installResult);
                });
                return;
            } catch (UpdateException failure) {
                deleteQuietly(part);
                if ("checksum_mismatch".equals(failure.code) || "signature_mismatch".equals(failure.code)) {
                    deleteQuietly(target);
                }
                output = error(failure.code, failure.getMessage());
            } catch (Exception failure) {
                Log.w(TAG, "download failed", failure);
                deleteQuietly(part);
                output = error("network", "网络连接失败，请检查网络后重试");
            } finally {
                downloading.set(false);
                activeConnection = null;
            }
            JSONObject finalOutput = output;
            mainHandler.post(() -> sink.deliver(finalOutput));
        });
    }

    void install(ResultSink sink) {
        mainHandler.post(() -> {
            if (destroyed) return;
            sink.deliver(installNow());
        });
    }

    void cancel() {
        cancelled = true;
        HttpsURLConnection connection = activeConnection;
        if (connection != null) {
            try {
                connection.disconnect();
            } catch (Exception ignored) {
            }
        }
    }

    void onResume() {
        if (destroyed || !pendingInstall) return;
        if (!activity.getPackageManager().canRequestPackageInstalls()) return;
        File file = verifiedFile;
        if (file == null || !file.isFile()) return;
        pendingInstall = false;
        try {
            launchInstaller(file);
        } catch (Exception failure) {
            Log.w(TAG, "install resume failed", failure);
        }
    }

    void shutdown() {
        destroyed = true;
        cancel();
        executor.shutdownNow();
        mainHandler.removeCallbacksAndMessages(null);
    }

    private JSONObject installNow() {
        File file = verifiedFile;
        if (file == null || !file.isFile()) return error("not_ready", "请先下载并校验安装包");
        try {
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                pendingInstall = true;
                if (!openUnknownSourcesSettings()) {
                    pendingInstall = false;
                    return error("install", "无法打开系统安装设置，请手动允许安装未知应用");
                }
                JSONObject result = ok();
                result.put("needPermission", true);
                result.put("message", "安装包已校验，请在系统设置允许安装未知应用后返回");
                return result;
            }
            pendingInstall = false;
            launchInstaller(file);
            JSONObject result = ok();
            result.put("installing", true);
            result.put("message", "安装包已校验，正在打开系统安装器");
            return result;
        } catch (Exception failure) {
            Log.w(TAG, "install failed", failure);
            return error("install", "无法打开系统安装器，请稍后重试");
        }
    }

    private boolean openUnknownSourcesSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(intent);
            return true;
        } catch (Exception failure) {
            Log.w(TAG, "unknown sources settings unavailable", failure);
            try {
                activity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + activity.getPackageName())));
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }
    }

    private void launchInstaller(File file) {
        Uri uri = Uri.parse("content://" + activity.getPackageName() + ".updates/" + UPDATE_DIR + "/" + file.getName());
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.setClipData(ClipData.newRawUri("update", uri));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(intent);
    }

    private String downloadChecksum(String rawUrl) throws UpdateException {
        String body = fetchText(rawUrl, MAX_CHECKSUM_BYTES, false);
        Matcher matcher = Pattern.compile("([0-9a-fA-F]{64})").matcher(body);
        if (!matcher.find()) throw new UpdateException("asset_missing", "发布资产不完整，已停止更新");
        return matcher.group(1).toLowerCase(Locale.US);
    }

    private String downloadApk(String rawUrl, File target) throws UpdateException {
        HttpsURLConnection connection = null;
        InputStream input = null;
        FileOutputStream output = null;
        try {
            connection = openConnection(rawUrl, false);
            long total = connection.getContentLengthLong();
            if (total > MAX_APK_BYTES) throw new UpdateException("storage", "安装包超过大小限制");
            activeConnection = connection;
            input = connection.getInputStream();
            output = new FileOutputStream(target);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[32 * 1024];
            long downloaded = 0L;
            long lastEmit = 0L;
            int lastPercent = -1;
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (cancelled) throw new UpdateException("cancelled", "已取消下载");
                output.write(buffer, 0, read);
                digest.update(buffer, 0, read);
                downloaded += read;
                if (downloaded > MAX_APK_BYTES) throw new UpdateException("storage", "安装包超过大小限制");
                int percent = total > 0L ? (int) Math.min(95L, downloaded * 95L / total) : 0;
                long now = SystemClock.elapsedRealtime();
                if (percent != lastPercent && (now - lastEmit >= 250L || percent >= 95)) {
                    lastPercent = percent;
                    lastEmit = now;
                    emitProgress(percent, "download", downloaded, total);
                }
            }
            output.flush();
            return hex(digest.digest());
        } catch (UpdateException failure) {
            throw failure;
        } catch (Exception failure) {
            if (cancelled) throw new UpdateException("cancelled", "已取消下载");
            throw new UpdateException("network", "网络连接失败，请检查网络后重试");
        } finally {
            closeQuietly(input);
            closeQuietly(output);
            if (connection != null) connection.disconnect();
        }
    }

    private Release fetchBestRelease() throws UpdateException {
        String body = fetchText(API_URL, MAX_JSON_BYTES, true);
        try {
            JSONArray array = new JSONArray(body);
            Release best = null;
            for (int index = 0; index < array.length(); index++) {
                JSONObject item = array.optJSONObject(index);
                if (item == null || item.optBoolean("draft", false)) continue;
                Version version = Version.parse(item.optString("tag_name", ""));
                if (version == null) continue;
                Release candidate = parseRelease(item, version);
                if (best == null || isBetterRelease(candidate, best)) {
                    best = candidate;
                }
            }
            return best;
        } catch (Exception failure) {
            throw new UpdateException("network", "更新信息格式异常，请稍后重试");
        }
    }

    private static boolean isBetterRelease(Release candidate, Release best) {
        boolean sameNumber = candidate.version.major == best.version.major
                && candidate.version.minor == best.version.minor
                && candidate.version.patch == best.version.patch;
        if (sameNumber && candidate.prerelease != best.prerelease) {
            return !candidate.prerelease;
        }
        int comparison = candidate.version.compareTo(best.version);
        if (comparison != 0) return comparison > 0;
        return candidate.hasAssets() && !best.hasAssets();
    }

    private static Release parseRelease(JSONObject item, Version version) {
        String notes = sanitize(item.optString("body", ""), 1200);
        String publishedAt = item.optString("published_at", "");
        String apkName = null;
        String apkUrl = null;
        String checksumUrl = null;
        JSONArray assets = item.optJSONArray("assets");
        if (assets != null) {
            for (int index = 0; index < assets.length(); index++) {
                JSONObject asset = assets.optJSONObject(index);
                if (asset == null) continue;
                String name = asset.optString("name", "");
                String url = asset.optString("browser_download_url", "");
                if (name.toLowerCase(Locale.US).endsWith(".apk") && apkName == null) {
                    apkName = name;
                    apkUrl = url;
                }
            }
            if (apkName != null) {
                String checksumName = apkName + ".sha256";
                for (int index = 0; index < assets.length(); index++) {
                    JSONObject asset = assets.optJSONObject(index);
                    if (asset == null) continue;
                    if (checksumName.equals(asset.optString("name", ""))) {
                        checksumUrl = asset.optString("browser_download_url", "");
                        break;
                    }
                }
                if (checksumUrl == null) {
                    for (int index = 0; index < assets.length(); index++) {
                        JSONObject asset = assets.optJSONObject(index);
                        if (asset == null) continue;
                        String name = asset.optString("name", "");
                        if (name.toLowerCase(Locale.US).endsWith(".sha256")) {
                            checksumUrl = asset.optString("browser_download_url", "");
                            break;
                        }
                    }
                }
            }
        }
        return new Release(version, item.optString("tag_name", ""), version.pre != null || item.optBoolean("prerelease", false),
                notes, publishedAt, apkName, apkUrl, checksumUrl);
    }

    private String fetchText(String rawUrl, long limit, boolean api) throws UpdateException {
        HttpsURLConnection connection = null;
        InputStream input = null;
        try {
            connection = openConnection(rawUrl, api);
            long declared = connection.getContentLengthLong();
            if (declared > limit) throw new UpdateException("network", "更新信息过大，已停止更新");
            input = connection.getInputStream();
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            long total = 0L;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > limit) throw new UpdateException("network", "更新信息过大，已停止更新");
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        } catch (UpdateException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new UpdateException("network", "网络连接失败，请检查网络后重试");
        } finally {
            closeQuietly(input);
            if (connection != null) connection.disconnect();
        }
    }

    private HttpsURLConnection openConnection(String rawUrl, boolean api) throws UpdateException {
        String current = rawUrl;
        try {
            for (int redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
                URI uri = URI.create(current);
                if (!"https".equalsIgnoreCase(uri.getScheme())) throw new UpdateException("network", "只能通过 HTTPS 下载更新");
                String host = uri.getHost();
                if (host == null) throw new UpdateException("network", "更新地址无效");
                if (api) {
                    if (!"api.github.com".equalsIgnoreCase(host)) throw new UpdateException("network", "更新地址不在允许范围");
                } else if (!isAllowedAssetHost(host)) {
                    throw new UpdateException("network", "更新地址不在允许范围");
                }
                HttpsURLConnection connection = (HttpsURLConnection) uri.toURL().openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout((int) CONNECT_TIMEOUT_MS);
                connection.setReadTimeout((int) READ_TIMEOUT_MS);
                connection.setRequestProperty("User-Agent", "JiangshuiSchedule-Android/" + currentVersion());
                connection.setRequestProperty("Accept", api ? "application/vnd.github+json" : "application/octet-stream");
                if (api) connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
                int code = connection.getResponseCode();
                if (code >= 300 && code < 400) {
                    String location = connection.getHeaderField("Location");
                    connection.disconnect();
                    if (location == null || location.length() > 2048) throw new UpdateException("network", "更新地址重定向无效");
                    current = new URL(new URL(current), location).toString();
                    continue;
                }
                if (code != HttpURLConnection.HTTP_OK) {
                    connection.disconnect();
                    throw new UpdateException("network", "更新服务器暂时不可用，请稍后重试");
                }
                return connection;
            }
            throw new UpdateException("network", "更新地址重定向次数过多");
        } catch (UpdateException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new UpdateException("network", "网络连接失败，请检查网络后重试");
        }
    }

    private static boolean isAllowedAssetHost(String host) {
        String value = host.toLowerCase(Locale.US);
        return "github.com".equals(value)
                || "objects.githubusercontent.com".equals(value)
                || "release-assets.githubusercontent.com".equals(value)
                || "github-releases.githubusercontent.com".equals(value);
    }

    private void verifyApk(File file) throws UpdateException {
        try {
            PackageManager manager = activity.getPackageManager();
            int flags = Build.VERSION.SDK_INT >= 28
                    ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
            PackageInfo info = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
            if (info == null || !activity.getPackageName().equals(info.packageName)) {
                throw new UpdateException("signature_mismatch", "安装包校验失败，已删除文件并阻止安装");
            }
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= 28) {
                SigningInfo signingInfo = info.signingInfo;
                signatures = signingInfo == null ? null : signingInfo.getApkContentsSigners();
            } else {
                signatures = info.signatures;
            }
            if (signatures == null || signatures.length != 1) {
                throw new UpdateException("signature_mismatch", "安装包校验失败，已删除文件并阻止安装");
            }
            String actual = hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()));
            if (!constantTimeEquals(EXPECTED_CERT_SHA256, actual)) {
                throw new UpdateException("signature_mismatch", "安装包校验失败，已删除文件并阻止安装");
            }
        } catch (UpdateException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new UpdateException("signature_mismatch", "安装包校验失败，已删除文件并阻止安装");
        }
    }

    private void emitProgress(int percent, String phase, long bytes, long total) {
        if (destroyed || progressSink == null) return;
        JSONObject payload = new JSONObject();
        try {
            payload.put("phase", phase);
            payload.put("percent", Math.max(0, Math.min(100, percent)));
            payload.put("bytes", bytes);
            payload.put("total", total);
        } catch (Exception ignored) {
            return;
        }
        mainHandler.post(() -> {
            if (!destroyed) progressSink.onProgress(payload);
        });
    }

    private String currentVersion() {
        try {
            String value = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
            if (value != null && !value.trim().isEmpty()) return value.trim();
        } catch (Exception failure) {
            Log.w(TAG, "read version name failed", failure);
        }
        return "未知版本";
    }

    private static JSONObject available(Release release, String current) {
        JSONObject result = ok();
        try {
            result.put("updateAvailable", true);
            result.put("currentVersion", current);
            result.put("latestVersion", release.version.toString());
            result.put("prerelease", release.prerelease);
            result.put("notes", release.notes);
            result.put("publishedAt", release.publishedAt);
        } catch (Exception ignored) {
        }
        return result;
    }

    private static JSONObject noUpdate(String current) {
        JSONObject result = ok();
        try {
            result.put("updateAvailable", false);
            result.put("currentVersion", current);
        } catch (Exception ignored) {
        }
        return result;
    }

    private static JSONObject skipped(String reason, String message) {
        JSONObject result = ok();
        try {
            result.put("skipped", true);
            result.put("reason", reason);
            result.put("message", message);
        } catch (Exception ignored) {
        }
        return result;
    }

    private static JSONObject ok() {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", true);
        } catch (Exception ignored) {
        }
        return result;
    }

    private static JSONObject error(String code, String message) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", false);
            result.put("errorCode", code);
            result.put("message", message);
        } catch (Exception ignored) {
        }
        return result;
    }

    private static String sanitize(String value, int maxLength) {
        if (value == null) return "";
        StringBuilder builder = new StringBuilder(Math.min(value.length(), maxLength + 16));
        for (int index = 0; index < value.length() && builder.length() < maxLength; index++) {
            char character = value.charAt(index);
            if (character == '\r') continue;
            if (character == '\n' || character == '\t' || (character >= 0x20 && character != 0x7f)) {
                builder.append(character);
            }
        }
        String result = builder.toString().trim();
        return result.length() > maxLength ? result.substring(0, maxLength).trim() + "…" : result;
    }

    private static String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) builder.append(String.format(Locale.US, "%02x", value));
        return builder.toString();
    }

    private static boolean constantTimeEquals(String left, String right) {
        if (left == null || right == null) return false;
        return MessageDigest.isEqual(left.getBytes(StandardCharsets.US_ASCII), right.getBytes(StandardCharsets.US_ASCII));
    }

    private static void deleteQuietly(File file) {
        if (file != null) {
            try {
                if (file.exists()) file.delete();
            } catch (Exception ignored) {
            }
        }
    }

    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable != null) {
            try {
                closeable.close();
            } catch (IOException ignored) {
            }
        }
    }

    static final class UpdateException extends Exception {
        final String code;

        UpdateException(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
