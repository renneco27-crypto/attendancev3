import React, { useRef, useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';

const WEBAPP_URL = 'https://attendancemaker-tsjz.onrender.com';

// JavaScript injected into the WebView to bridge native capabilities
// back to the web app via window.postMessage / window.nativeBridge
const INJECTED_JS = `
  (function() {
    // Bridge: web app calls window.nativeBridge.checkMockLocation()
    // Native side responds via postMessage back into the WebView
    window.nativeBridge = {
      checkMockLocation: function() {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'CHECK_MOCK_LOCATION'
        }));
      },
      // Web app can call this to get the result asynchronously
      // Result comes back via window.onNativeBridgeMessage event
    };

    // Listener for native → web messages
    document.addEventListener('message', function(e) {
      try {
        var data = JSON.parse(e.data);
        var event = new CustomEvent('nativeBridgeMessage', { detail: data });
        window.dispatchEvent(event);
      } catch(err) {}
    });

    true; // required for injectedJavaScript
  })();
`;

export default function App() {
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Request location permission on mount (needed for mock detection)
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location Required',
          'Location permission is needed to verify you are in the classroom. Please enable it in Settings.',
          [{ text: 'OK' }]
        );
      }
    })();
  }, []);

  // Handle messages from the web app (window.ReactNativeWebView.postMessage)
  const handleMessage = async (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      if (data.type === 'CHECK_MOCK_LOCATION') {
        let isMocked = false;

        if (Platform.OS === 'android') {
          // On Android, expo-location exposes mock provider detection
          try {
            const location = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            // isMockLocationProviderActive is Android-only
            isMocked = (location.mocked === true);
          } catch (err) {
            // If location fails, treat as inconclusive (don't hard-block)
            isMocked = false;
          }
        }
        // iOS: mock location via developer tools requires a Mac + Xcode
        // connected device — not a realistic student attack vector,
        // so we don't block on iOS, just return false.

        // Send result back into the WebView
        const response = JSON.stringify({
          type: 'MOCK_LOCATION_RESULT',
          isMocked,
          platform: Platform.OS,
        });

        webviewRef.current?.injectJavaScript(`
          (function() {
            var event = new CustomEvent('nativeBridgeMessage', {
              detail: ${response}
            });
            window.dispatchEvent(event);
          })();
        `);
      }
    } catch (err) {
      // Malformed message from web — ignore
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" backgroundColor="#1a1a2e" />

      {/* Loading screen while web app boots */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <Text style={styles.loadingTitle}>Attendance</Text>
          <ActivityIndicator size="large" color="#4f8ef7" style={{ marginTop: 24 }} />
          <Text style={styles.loadingSubtitle}>Loading...</Text>
        </View>
      )}

      {/* Error screen if web app fails to load */}
      {error && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>Connection Error</Text>
          <Text style={styles.errorSubtitle}>
            Could not reach the attendance server.{'\n'}
            Check your internet connection and try again.
          </Text>
          <Text
            style={styles.retryButton}
            onPress={() => {
              setError(false);
              setLoading(true);
              webviewRef.current?.reload();
            }}
          >
            Retry
          </Text>
        </View>
      )}

      <WebView
        ref={webviewRef}
        source={{ uri: WEBAPP_URL }}
        style={styles.webview}

        // Inject bridge before page JS runs
        injectedJavaScriptBeforeContentLoaded={INJECTED_JS}

        // Handle messages from web app
        onMessage={handleMessage}

        // Loading state callbacks
        onLoadStart={() => { setLoading(true); setError(false); }}
        onLoadEnd={() => setLoading(false)}
        onError={() => { setLoading(false); setError(true); }}
        onHttpError={(e) => {
          if (e.nativeEvent.statusCode >= 500) {
            setLoading(false);
            setError(true);
          }
        }}

        // WebView settings
        javaScriptEnabled={true}
        domStorageEnabled={true}          // localStorage for PIN/device state
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        cacheEnabled={true}

        // Allow camera access inside WebView (QR scanning)
        allowsProtectedMedia={true}
        mediaCapturePermissionGrantType="grant"  // auto-grant camera in WebView

        // Android specific
        androidLayerType="hardware"
        mixedContentMode="always"

        // iOS specific
        allowsBackForwardNavigationGestures={false}
        bounces={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  webview: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 1,
  },
  loadingSubtitle: {
    color: '#8888aa',
    fontSize: 14,
    marginTop: 12,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    padding: 32,
  },
  errorTitle: {
    color: '#ff6b6b',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  errorSubtitle: {
    color: '#8888aa',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryButton: {
    marginTop: 28,
    color: '#4f8ef7',
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderWidth: 1,
    borderColor: '#4f8ef7',
    borderRadius: 8,
    overflow: 'hidden',
  },
});
