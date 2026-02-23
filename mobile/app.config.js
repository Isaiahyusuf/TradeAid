export default {
  expo: {
    name: "TradeAid",
    slug: "tradeaid",
    version: "1.0.0",
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
      buildNumber: "1"
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#0a0f0a"
      },
      package: "com.tradeaid.app",
      versionCode: 1,
      useNextNotificationsApi: true
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    extra: {
      // API URL - defaults to localhost for development
      // Set API_URL environment variable for production builds
      apiUrl: process.env.API_URL || process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000",
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
