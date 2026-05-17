package com.hexon.beta;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * HEXON BETA — minimal WebView wrapper for the bundled HTML5 game.
 *
 * The whole game (HTML/CSS/JS) lives under assets/web/. We point the
 * WebView at file:///android_asset/web/index.html and let it run.
 *
 * Targets Android 5.0 (API 21) through Android 15 (API 35).
 */
public class MainActivity extends Activity {

    private static final String START_URL = "file:///android_asset/web/index.html";
    private static final int REQ_LEGACY_STORAGE = 4711;
    private static final int REQ_FILE_CHOOSER  = 4712;
    /** Folder inside public Documents that survives uninstall. */
    private static final String PROFILES_SUBDIR = "HEXON";

    private WebView webView;
    /** Pending callback for a WebView <input type="file"> picker.
     *  We hold it across the Intent round-trip; only one chooser is
     *  ever open at a time so a single field is enough. */
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint({"SetJavaScriptEnabled", "ObsoleteSdkInt"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Edge-to-edge dark background (matches the in-game theme).
        getWindow().setBackgroundDrawableResource(R.drawable.splash_bg);
        getWindow().setStatusBarColor(0xFF0B0F1A);
        getWindow().setNavigationBarColor(0xFF0B0F1A);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        configureWebView();
        // Expose AndroidHexon.exit() to JS so the in-game "Quit" button
        // can really close the app.
        webView.addJavascriptInterface(new HexonJsBridge(), "AndroidHexon");

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    /**
     * Tiny bridge object that the web layer can call to actually
     * close the activity. We post the finish onto the WebView's
     * looper because JS-thread callbacks aren't allowed to touch
     * the activity directly.
     */
    private class HexonJsBridge {
        @JavascriptInterface
        public void exit() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        finishAndRemoveTask();
                    } else {
                        finish();
                    }
                }
            });
        }

        // -------------------------------------------------------- storage
        /** True iff we can read/write the public Documents/HEXON/ folder. */
        @JavascriptInterface
        public boolean hasStoragePermission() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                try { return Environment.isExternalStorageManager(); }
                catch (Throwable ignored) { return false; }
            }
            // Runtime permissions only matter from API 23 onwards.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
            return checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    == PackageManager.PERMISSION_GRANTED;
        }

        /**
         * Opens the correct system UI for the player to grant file access.
         * On Android 11+ it's the "All files access" page; on older it's
         * the runtime permission dialog handled by requestPermissions.
         */
        @JavascriptInterface
        public void requestStoragePermission() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        try {
                            Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                            i.setData(Uri.parse("package:" + getPackageName()));
                            startActivity(i);
                        } catch (Throwable t1) {
                            try {
                                startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                            } catch (Throwable ignored) { /* no-op */ }
                        }
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        requestPermissions(new String[]{
                                Manifest.permission.READ_EXTERNAL_STORAGE,
                                Manifest.permission.WRITE_EXTERNAL_STORAGE
                        }, REQ_LEGACY_STORAGE);
                    }
                }
            });
        }

        /** Writes JSON to Documents/HEXON/{name}.json. Overwrites. */
        @JavascriptInterface
        public boolean saveProfile(String name, String json) {
            try {
                File f = profileFile(name);
                if (f == null) return false;
                f.getParentFile().mkdirs();
                try (FileOutputStream out = new FileOutputStream(f, false);
                     OutputStreamWriter w = new OutputStreamWriter(out, StandardCharsets.UTF_8)) {
                    w.write(json == null ? "" : json);
                    w.flush();
                }
                return true;
            } catch (Throwable t) {
                android.util.Log.w("HEXON", "saveProfile failed: " + t.getMessage());
                return false;
            }
        }

        /** Reads back Documents/HEXON/{name}.json, or empty string if absent. */
        @JavascriptInterface
        public String loadProfile(String name) {
            try {
                File f = profileFile(name);
                if (f == null || !f.isFile()) return "";
                try (FileInputStream in = new FileInputStream(f);
                     ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                    return new String(bos.toByteArray(), StandardCharsets.UTF_8);
                }
            } catch (Throwable t) {
                android.util.Log.w("HEXON", "loadProfile failed: " + t.getMessage());
                return "";
            }
        }

        /** Returns a JSON-array string of saved profile nicknames. */
        @JavascriptInterface
        public String listProfiles() {
            JSONArray arr = new JSONArray();
            try {
                File dir = profilesDir();
                if (dir == null || !dir.isDirectory()) return "[]";
                File[] files = dir.listFiles();
                if (files == null) return "[]";
                Arrays.sort(files);
                for (File f : files) {
                    String fn = f.getName();
                    if (fn.toLowerCase().endsWith(".json")) {
                        arr.put(fn.substring(0, fn.length() - 5));
                    }
                }
            } catch (Throwable t) { /* fall through with what we have */ }
            return arr.toString();
        }

        /** True if the named profile already exists on disk. */
        @JavascriptInterface
        public boolean profileExists(String name) {
            File f = profileFile(name);
            return f != null && f.isFile();
        }

        // ----- internal helpers (NOT exposed to JS) -----
        private File profilesDir() {
            File docs = Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_DOCUMENTS);
            return new File(docs, PROFILES_SUBDIR);
        }
        private File profileFile(String name) {
            String safe = safeName(name);
            if (safe.isEmpty()) return null;
            return new File(profilesDir(), safe + ".json");
        }
        private String safeName(String name) {
            if (name == null) return "";
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < name.length() && b.length() < 40; i++) {
                char c = name.charAt(i);
                if (Character.isLetterOrDigit(c) || c == '_' || c == '-') b.append(c);
            }
            return b.toString().toLowerCase();
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        // Modern WebView (Chromium) already disallows cross-origin file
        // access by default; the legacy getters/setters were removed in
        // newer SDKs so we only call them on older devices.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            try {
                s.setAllowFileAccessFromFileURLs(false);
                s.setAllowUniversalAccessFromFileURLs(false);
            } catch (Throwable ignored) { /* no-op on stripped builds */ }
        }
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setBackgroundColor(0xFF0B0F1A);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setVerticalScrollBarEnabled(false);

        // Enable WebView contents debugging only in debug builds.
        if (BuildConfig.DEBUG && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        CookieManager.getInstance().setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        }

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                // Forwards JS console output to logcat under tag "HEXON".
                android.util.Log.d("HEXON", cm.message()
                        + " (line " + cm.lineNumber() + ")");
                return true;
            }

            /**
             * Handle <input type="file"> from the web layer. Without
             * this override the chooser silently does nothing in
             * stock WebView, which is why "Choose image" used to
             * appear dead inside the APK.
             *
             * We honour the accept= filter (image, audio, ...) and
             * default to any MIME so the same path works for
             * unrelated inputs the game might add later.
             */
            @Override
            public boolean onShowFileChooser(WebView wv,
                                             ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    // A previous request is still in flight — drop it.
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = cb;

                String mime = "*/*";
                try {
                    String[] types = params != null ? params.getAcceptTypes() : null;
                    if (types != null && types.length > 0 && types[0] != null && !types[0].isEmpty()) {
                        mime = types[0];
                    }
                } catch (Throwable ignored) { /* keep default */ }

                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType(mime);
                Intent chooser = Intent.createChooser(pick, "Select");
                try {
                    startActivityForResult(chooser, REQ_FILE_CHOOSER);
                } catch (Throwable t) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleExternal(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view,
                                                    android.webkit.WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return false;
                return handleExternal(request.getUrl().toString());
            }

            private boolean handleExternal(String url) {
                if (url == null) return false;
                if (url.startsWith("file://") || url.startsWith("about:")) {
                    return false;
                }
                if (url.startsWith("http://") || url.startsWith("https://")
                        || url.startsWith("mailto:") || url.startsWith("tel:")) {
                    try {
                        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Throwable ignored) { /* nothing to do */ }
                    return true;
                }
                return false;
            }
        });
    }

    /**
     * Receive the file chooser result and forward it to the pending
     * WebView callback. Called after {@code onShowFileChooser} above
     * dispatches an {@code ACTION_GET_CONTENT} Intent.
     */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            Uri[] result = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                Uri uri = data.getData();
                if (uri != null) {
                    result = new Uri[]{ uri };
                } else if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    result = new Uri[n];
                    for (int i = 0; i < n; i++) {
                        result[i] = data.getClipData().getItemAt(i).getUri();
                    }
                }
            }
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(result);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
