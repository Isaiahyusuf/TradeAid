# MemeScannerAI Mobile App

React Native mobile app for MemeScannerAI Solana token scanner.

## Setup

1. Install dependencies:
```bash
cd mobile
npm install
```

2. Configure API URL in `app.config.js`:
```javascript
extra: {
  apiUrl: "https://your-backend-url.com"
}
```

3. Start development:
```bash
npm start
```

4. Run on device:
- Press `i` for iOS Simulator
- Press `a` for Android Emulator
- Scan QR code with Expo Go app for physical device

## Building and publishing (Expo EAS)

1. Install EAS CLI and login:
```bash
npm install -g eas-cli
eas login
```

2. Configure build (first time):
```bash
cd mobile
eas build:configure
```

3. Build for Android (internal or store):
```bash
eas build --platform android --profile production
```

4. Build for iOS (archive for App Store):
```bash
eas build --platform ios --profile production
```

5. Submit to stores (optional):
```bash
eas submit --platform android
eas submit --platform ios
```

Notes:
- Set `API_URL` env var in Railway (or EAS secrets) to point to your deployed backend.
- Recommended `expo` packages to install for polish: `expo-font`, `expo-splash-screen`, `expo-asset`.
- For local development use `expo start` and Expo Go on device.

## Building for App Stores

### Setup Expo EAS:
```bash
npm install -g eas-cli
eas login
eas build:configure
```

### Build for iOS:
```bash
eas build --platform ios
```

### Build for Android:
```bash
eas build --platform android
```

### Submit to App Stores:
```bash
eas submit --platform ios
eas submit --platform android
```

## Project Structure

```
mobile/
├── App.tsx                    # Main app entry
├── app.config.js              # Expo configuration
├── package.json               # Dependencies
├── src/
│   ├── components/            # Reusable components
│   │   └── TokenCard.tsx
│   ├── hooks/                 # Custom hooks
│   │   └── useAuth.ts
│   ├── navigation/            # Navigation setup
│   │   └── AppNavigator.tsx
│   ├── screens/               # App screens
│   │   ├── ScannerScreen.tsx
│   │   ├── RugShieldScreen.tsx
│   │   ├── WhaleWatchScreen.tsx
│   │   ├── MemeTrendScreen.tsx
│   │   └── AccountScreen.tsx
│   ├── services/              # API services
│   │   └── api.ts
│   └── types/                 # TypeScript types
│       └── index.ts
└── assets/                    # Images and icons
```

## Features

- Alpha Scanner for Solana tokens with safe picks and hot tokens
- RugShield token safety analyzer focused on Solana token checks
- WhaleWatch wallet tracker for Solana wallets
- MemeTrend social sentiment
- User account management

## Requirements

- Node.js 18+
- Expo CLI
- iOS: Xcode (Mac only)
- Android: Android Studio
- Apple Developer Account ($99/year) for iOS publishing
- Google Play Developer Account ($25) for Android publishing
