package cn.local.tomorrow;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/**
 * App 内反馈页：用独立 WebView 打开问卷星问卷。
 * 不向外部页面暴露任何 JS 桥；只允许问卷星域名留在 WebView 内，
 * 其余链接交给系统浏览器，加载失败时提供重试/复制链接兜底。
 */
public class FeedbackActivity extends Activity {
    static final String EXTRA_DARK = "dark";
    private static final int REQ_FILE_CHOOSER = 41;
    private static final String USER_AGENT =
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

    private boolean dark;
    private FeedbackConfig config;
    private WebView web;
    private ProgressBar progress;
    private View errorPanel;
    private ValueCallback<Uri[]> fileCallback;
    private int bg, surface, textColor, mutedColor, accentColor, dividerColor;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        config = FeedbackConfig.load(this);
        if (!config.enabled) {
            Toast.makeText(this, R.string.feedback_not_configured, Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        dark = getIntent().getBooleanExtra(EXTRA_DARK, false);
        resolveColors();
        applyWindow();
        View root = buildUi();
        setContentView(root);
        installInsets(root);
        web.loadUrl(config.url);
    }

    private void resolveColors() {
        bg = Color.parseColor(dark ? "#000000" : "#ffffff");
        surface = Color.parseColor(dark ? "#121212" : "#ffffff");
        textColor = Color.parseColor(dark ? "#f2f2f2" : "#111111");
        mutedColor = Color.parseColor(dark ? "#a8adb3" : "#5f6368");
        accentColor = Color.parseColor(dark ? "#83d1f4" : "#1668b3");
        dividerColor = Color.parseColor(dark ? "#2a2a2a" : "#e6e8eb");
    }

    @SuppressWarnings("deprecation")
    private void applyWindow() {
        Window window = getWindow();
        window.setBackgroundDrawable(new ColorDrawable(bg));
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        if (!dark) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        window.getDecorView().setSystemUiVisibility(flags);
        if (Build.VERSION.SDK_INT >= 30 && window.getInsetsController() != null) {
            int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            window.getInsetsController().setSystemBarsAppearance(dark ? 0 : mask, mask);
        }
    }

    private void installInsets(View root) {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets safe = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return WindowInsets.CONSUMED;
            });
        } else {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                return insets.consumeSystemWindowInsets();
            });
        }
        root.requestApplyInsets();
    }

    private int dp(int value) {
        return Math.round(getResources().getDisplayMetrics().density * value);
    }

    private String appVersionName() {
        try {
            android.content.pm.PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.versionName == null ? "" : info.versionName;
        } catch (Exception ignored) {
            return "";
        }
    }

    private View buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(bg);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(surface);
        bar.setPadding(dp(4), 0, dp(8), 0);
        bar.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)));

        TextView back = new TextView(this);
        back.setText("\u2039");
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);
        back.setTextColor(textColor);
        back.setGravity(Gravity.CENTER);
        back.setContentDescription(getString(R.string.feedback_back));
        back.setBackgroundResource(android.R.drawable.list_selector_background);
        back.setLayoutParams(new LinearLayout.LayoutParams(dp(48), LinearLayout.LayoutParams.MATCH_PARENT));
        back.setOnClickListener(view -> finish());
        bar.addView(back);

        LinearLayout titleBox = new LinearLayout(this);
        titleBox.setOrientation(LinearLayout.VERTICAL);
        titleBox.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams titleBoxParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        titleBoxParams.setMarginStart(dp(4));
        titleBox.setLayoutParams(titleBoxParams);

        TextView title = new TextView(this);
        title.setText(config.title);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        title.setTextColor(textColor);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setSingleLine(true);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        titleBox.addView(title);

        String versionName = appVersionName();
        if (!versionName.isEmpty()) {
            TextView version = new TextView(this);
            version.setText("v" + versionName);
            version.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
            version.setTextColor(mutedColor);
            version.setSingleLine(true);
            titleBox.addView(version);
        }
        bar.addView(titleBox);

        TextView browser = new TextView(this);
        browser.setText(R.string.feedback_open_browser);
        browser.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        browser.setTextColor(accentColor);
        browser.setGravity(Gravity.CENTER);
        browser.setMinHeight(dp(44));
        browser.setPadding(dp(12), dp(8), dp(12), dp(8));
        browser.setOnClickListener(view -> openInBrowser());
        bar.addView(browser);
        root.addView(bar);

        View divider = new View(this);
        divider.setBackgroundColor(dividerColor);
        root.addView(divider, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Math.max(1, dp(1))));

        FrameLayout content = new FrameLayout(this);
        content.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(bg);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        content.addView(web);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgress(0);
        progress.setIndeterminate(false);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(3));
        progressParams.gravity = Gravity.TOP;
        progress.setLayoutParams(progressParams);
        progress.setVisibility(View.GONE);
        content.addView(progress);

        errorPanel = buildErrorPanel();
        content.addView(errorPanel);
        configureWeb();
        root.addView(content);
        return root;
    }

    private View buildErrorPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setBackgroundColor(bg);
        panel.setPadding(dp(32), dp(24), dp(32), dp(24));
        panel.setVisibility(View.GONE);
        panel.setLayoutParams(new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        TextView message = new TextView(this);
        message.setText(R.string.feedback_error);
        message.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        message.setTextColor(textColor);
        message.setGravity(Gravity.CENTER);
        message.setLineSpacing(dp(4), 1f);
        panel.addView(message);

        TextView note = new TextView(this);
        note.setText(R.string.feedback_error_note);
        note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        note.setTextColor(mutedColor);
        note.setGravity(Gravity.CENTER);
        note.setPadding(0, dp(8), 0, dp(20));
        panel.addView(note);

        ColorStateList buttonTint = ColorStateList.valueOf(Color.parseColor(dark ? "#1f1f1f" : "#f2f3f7"));
        Button retry = new Button(this);
        retry.setText(R.string.feedback_retry);
        retry.setAllCaps(false);
        retry.setTextColor(accentColor);
        retry.setBackgroundTintList(buttonTint);
        retry.setOnClickListener(view -> reload());
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(dp(200), LinearLayout.LayoutParams.WRAP_CONTENT);
        retry.setLayoutParams(retryParams);
        panel.addView(retry);

        Button copy = new Button(this);
        copy.setText(R.string.feedback_copy_link);
        copy.setAllCaps(false);
        copy.setTextColor(accentColor);
        copy.setBackgroundTintList(buttonTint);
        copy.setOnClickListener(view -> copyLink());
        LinearLayout.LayoutParams copyParams = new LinearLayout.LayoutParams(dp(200), LinearLayout.LayoutParams.WRAP_CONTENT);
        copyParams.topMargin = dp(6);
        copy.setLayoutParams(copyParams);
        panel.addView(copy);
        return panel;
    }

    private void configureWeb() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(USER_AGENT);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (FeedbackConfig.isAllowed(uri.toString())) return false;
                openExternal(uri);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                progress.setProgress(0);
                progress.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError();
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response != null && response.getStatusCode() >= 400) showError();
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                showError();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception ignored) {
                    fileCallback = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }
        });
    }

    private void showError() {
        progress.setVisibility(View.GONE);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private void reload() {
        errorPanel.setVisibility(View.GONE);
        progress.setVisibility(View.VISIBLE);
        progress.setProgress(0);
        if (web.getUrl() == null) web.loadUrl(config.url);
        else web.reload();
    }

    private void openInBrowser() {
        String current = web.getUrl();
        String target = FeedbackConfig.isAllowed(current) ? current : config.url;
        openExternal(Uri.parse(target));
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)
                || "mailto".equalsIgnoreCase(scheme) || "tel".equalsIgnoreCase(scheme))) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            Toast.makeText(this, R.string.feedback_open_failed, Toast.LENGTH_SHORT).show();
        }
    }

    private void copyLink() {
        String current = web.getUrl();
        String target = FeedbackConfig.isAllowed(current) ? current : config.url;
        ClipboardManager manager = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (manager != null) manager.setPrimaryClip(ClipData.newPlainText(getString(R.string.feedback_title_default), target));
        Toast.makeText(this, R.string.feedback_copied, Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        if (web != null) {
            web.setWebChromeClient(null);
            web.setWebViewClient(null);
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
