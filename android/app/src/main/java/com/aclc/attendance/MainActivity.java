package com.aclc.attendance;

import android.provider.Settings;
import android.content.ContentResolver;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private class NativeBridge {
        @JavascriptInterface
        public void checkDeveloperOptions() {
            try {
                ContentResolver cr = getContentResolver();
                int devEnabled = Settings.Global.getInt(cr, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0);
                int adbEnabled = Settings.Global.getInt(cr, Settings.Global.ADB_ENABLED, 0);
                boolean isEnabled = devEnabled == 1 || adbEnabled == 1;
                final String js = "window.dispatchEvent(new CustomEvent('nativeBridgeMessage', { detail: { type: 'DEVELOPER_OPTIONS_RESULT', isEnabled: " + isEnabled + " } }))";
                runOnUiThread(() -> {
                    WebView wv = (WebView) getBridge().getWebView();
                    wv.evaluateJavascript(js, null);
                });
            } catch (Exception e) {
                WebView wv = (WebView) getBridge().getWebView();
                wv.evaluateJavascript("window.dispatchEvent(new CustomEvent('nativeBridgeMessage', { detail: { type: 'DEVELOPER_OPTIONS_RESULT', isEnabled: false } }))", null);
            }
        }

        @JavascriptInterface
        public void checkMockLocation() {
            try {
                ContentResolver cr = getContentResolver();
                int mockEnabled = Settings.Secure.getInt(cr, Settings.Secure.ALLOW_MOCK_LOCATION, 0);
                final String js = "window.dispatchEvent(new CustomEvent('nativeBridgeMessage', { detail: { type: 'MOCK_LOCATION_RESULT', isMocked: " + (mockEnabled == 1) + ", platform: 'android' } }))";
                runOnUiThread(() -> {
                    WebView wv = (WebView) getBridge().getWebView();
                    wv.evaluateJavascript(js, null);
                });
            } catch (Exception e) {
                WebView wv = (WebView) getBridge().getWebView();
                wv.evaluateJavascript("window.dispatchEvent(new CustomEvent('nativeBridgeMessage', { detail: { type: 'MOCK_LOCATION_RESULT', isMocked: false, platform: 'android' } }))", null);
            }
        }
    }

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new NativeBridge(), "nativeBridge");
    }
}
