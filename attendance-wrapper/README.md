# Attendance Native Wrapper

Wraps https://attendancemaker-tsjz.onrender.com in a native Android/iOS shell.
Adds mock location detection that the browser cannot do on its own.

## What this does
- Loads your existing web app inside a native WebView
- Auto-grants camera permission inside WebView (for QR scanning)
- Detects mock/fake GPS on Android and reports it to your web app
- Shows a loading screen and error/retry screen if the server is unreachable

## Setup (one time)

### 1. Install dependencies
```
npm install
```

### 2. Install EAS CLI
```
npm install -g eas-cli
```

### 3. Log in to Expo
```
eas login
```
(Create a free account at expo.dev if you don't have one)

### 4. Link this project to EAS
```
eas init
```
This generates a projectId — it will be auto-written into app.json.

## Build the APK (Android) — no Android Studio needed

```
eas build --platform android --profile preview
```

- EAS builds it on their cloud servers (~5-10 minutes)
- When done, it gives you a download link for the .apk file
- Install the APK on any Android phone (enable "Install unknown apps" in settings first)

## Build for iOS (requires Apple Developer account $99/year)

```
eas build --platform ios --profile preview
```

For iOS prototype testing without paying, use TestFlight internal distribution,
or just use the Android APK for now since Android is the primary target.

## Test locally first (before building APK)

Install Expo Go on your phone, then:
```
npx expo start
```
Scan the QR in the terminal with Expo Go.
Note: mock location detection won't work in Expo Go (needs real build),
but everything else (WebView, loading screen, error screen) will work fine for a first look.

## How to use mock location detection in your web app

Once the native wrapper is installed, your web app can call:

```javascript
// Check if student is using a fake GPS location
window.nativeBridge.checkMockLocation();

// Listen for the result
window.addEventListener('nativeBridgeMessage', function(e) {
  if (e.detail.type === 'MOCK_LOCATION_RESULT') {
    if (e.detail.isMocked) {
      // Block check-in, show warning
      alert('Fake location detected. You must be physically present.');
    } else {
      // Proceed with check-in
    }
  }
});
```

Call `checkMockLocation()` right before submitting attendance on the student side.
The result comes back asynchronously via the event listener above.
On iOS, `isMocked` always returns false (mock location not a realistic iOS attack vector).
