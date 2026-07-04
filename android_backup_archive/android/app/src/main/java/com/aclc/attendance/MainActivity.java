package com.aclc.attendance;

import android.Manifest;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.provider.Settings;
import android.content.ContentResolver;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int REQUEST_CAMERA_PERMISSION = 1001;
    private static final int REQUEST_LOCATION_PERMISSION = 1002;

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

    private void checkForDeveloperOptions() {
        if (com.aclc.attendance.util.DeveloperOptionsChecker.INSTANCE.isThreatDetected(this)) {
            Intent intent = new Intent(this, com.aclc.attendance.ui.DevOptionsOverlayActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        }
    }

    private void requestCameraPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, REQUEST_CAMERA_PERMISSION);
        }
    }

    private void requestLocationPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, REQUEST_LOCATION_PERMISSION);
        }
    }

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getBridge().getWebView().addJavascriptInterface(new NativeBridge(), "nativeBridge");

        getBridge().getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        requestCameraPermission();
        requestLocationPermission();
        checkForDeveloperOptions();
    }

    @Override
    public void onResume() {
        super.onResume();
        checkForDeveloperOptions();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        String js = "window.dispatchEvent(new CustomEvent('nativeBridgeMessage', { detail: { type: 'PERMISSION_RESULT', requestCode: " + requestCode + ", granted: " + (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) + " } }))";
        WebView wv = (WebView) getBridge().getWebView();
        wv.evaluateJavascript(js, null);
    }
}
