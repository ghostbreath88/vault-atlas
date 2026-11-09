import type { CapacitorConfig } from '@capacitor/cli';

// The Android app bundles the built web app (dist/) and serves it from the APK itself.
// It never loads the hosted website. See android/app/src/main/AndroidManifest.xml:
// the INTERNET permission is deliberately absent, so the WebView cannot reach any network.
const config: CapacitorConfig = {
  appId: 'io.github.ghostbreath88.vaultatlas',
  appName: 'Vault Atlas',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    captureInput: false,
    // webContentsDebuggingEnabled is left unset: Capacitor enables it only for debug (test) builds.
  },
  plugins: {
    CapacitorHttp: { enabled: false },
    CapacitorCookies: { enabled: false },
  },
};
export default config;
