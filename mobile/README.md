# MemeScannerAI Mobile App

React Native mobile app for MemeScannerAI crypto token scanner.

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

- Alpha Scanner with safe picks and hot tokens
- RugShield token safety analyzer
- WhaleWatch wallet tracker
- MemeTrend social sentiment
- User account management

## Requirements

- Node.js 18+
- Expo CLI
- iOS: Xcode (Mac only)
- Android: Android Studio
- Apple Developer Account ($99/year) for iOS publishing
- Google Play Developer Account ($25) for Android publishing
