const appEnv = process.env.APP_ENV || 'development';
const isProductionBuild = appEnv === 'production';
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL;

if (isProductionBuild && !configuredApiUrl) {
  throw new Error('Missing EXPO_PUBLIC_API_URL/API_URL for production build.');
}

export default {
  expo: {
    name: "TradeAid",
    slug: "tradeaid",
    version: "1.0.0",
    scheme: "tradeaid",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#0a0f0a"
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.tradeaid.app",
      buildNumber: "1",
      config: {
        usesNonExemptEncryption: false
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#0a0f0a"
      },
      package: "com.tradeaid.app",
      versionCode: 1,
      permissions: ["INTERNET", "VIBRATE"],
      blockedPermissions: [
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.SYSTEM_ALERT_WINDOW"
      ]
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    extra: {
      // API URL - defaults to localhost for development
      // Set API_URL environment variable for production builds
      appEnv,
      apiUrl: configuredApiUrl || "http://localhost:8000",
      eas: {
        projectId: "cafdcb5d-4be3-464e-a79e-d9776cf124cc"
      }
    },
    plugins: [
      "expo-secure-store",
      [
        "expo-notifications",
        {
          icon: "./assets/adaptive-icon.png",
          color: "#22c55e",
          defaultChannel: "default"
        }
      ]
    ]
  }
};
