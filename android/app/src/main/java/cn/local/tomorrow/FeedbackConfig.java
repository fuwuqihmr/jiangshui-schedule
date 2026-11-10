package cn.local.tomorrow;

import android.content.Context;
import android.net.Uri;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * 反馈通道配置：读取 assets 里的 web/feedback.json。
 * 只有 https + 问卷星域名 + 无凭据/非默认端口的地址才会启用入口。
 */
final class FeedbackConfig {
    static final String ASSET = "feedback.json";
    private static final int MAX_CONFIG_BYTES = 64 * 1024;
    private static final int MAX_URL_LENGTH = 2048;
    private static final String[] DOMAINS = {"wjx.cn", "wjx.top", "sojump.com", "wjx.com"};

    final boolean enabled;
    final String title;
    final String intro;
    final String url;

    private FeedbackConfig(boolean enabled, String title, String intro, String url) {
        this.enabled = enabled;
        this.title = title;
        this.intro = intro;
        this.url = url;
    }

    static FeedbackConfig load(Context context) {
        String text;
        try (InputStream in = context.getAssets().open(ASSET)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
                if (out.size() > MAX_CONFIG_BYTES) throw new IllegalStateException("feedback config too large");
            }
            text = new String(out.toByteArray(), StandardCharsets.UTF_8);
            if (text.startsWith("\uFEFF")) text = text.substring(1);
        } catch (Exception ignored) {
            return disabled(context);
        }
        try {
            JSONObject json = new JSONObject(text);
            String rawUrl = json.optString("url", "").trim();
            String title = clean(json.optString("title", ""), 40, context.getString(R.string.feedback_title_default));
            String intro = clean(json.optString("intro", ""), 200, "");
            boolean on = json.optBoolean("enabled", true) && isAllowed(rawUrl);
            return new FeedbackConfig(on, title, intro, rawUrl);
        } catch (Exception ignored) {
            return disabled(context);
        }
    }

    static FeedbackConfig disabled(Context context) {
        return new FeedbackConfig(false, context.getString(R.string.feedback_title_default), "", "");
    }

    static String clean(String value, int limit, String fallback) {
        if (value == null) return fallback;
        String text = value.trim();
        if (text.isEmpty()) return fallback;
        return text.length() > limit ? text.substring(0, limit) : text;
    }

    static boolean isAllowed(String raw) {
        if (raw == null) return false;
        String value = raw.trim();
        if (value.isEmpty() || value.length() > MAX_URL_LENGTH) return false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            // 拒绝空白、C0/DEL 控制字符与反斜杠，避免解析歧义。
            if (c <= 0x20 || c == 0x7f || c == '\\') return false;
        }
        Uri uri;
        try {
            uri = Uri.parse(value);
        } catch (Exception e) {
            return false;
        }
        if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
        if (uri.getUserInfo() != null) return false;
        int port = uri.getPort();
        if (port != -1 && port != 443) return false;
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        if (!isFeedbackHost(host)) return false;
        String path = uri.getPath();
        return path != null && path.length() > 1 && path.startsWith("/");
    }

    private static boolean isFeedbackHost(String host) {
        for (String domain : DOMAINS) {
            if (host.equals(domain) || host.endsWith("." + domain)) return true;
        }
        return false;
    }
}
