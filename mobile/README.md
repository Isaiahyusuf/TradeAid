# TradeAid Mobile App

React Native mobile application for TradeAid - a blockchain intelligence platform for token scanning, risk assessment, and wallet intelligence.

## Features

✅ **Alpha Scanner** - Discover new tokens with safety scores  
✅ **RugShield** - Scan any token for safety (honeypot detection, liquidity checks)  
✅ **Whale Watch** - Monitor wallet movements and alerts  
✅ **Meme Trends** - Track trending tokens and market data  
✅ **Account Management** - User profiles and settings  
✅ **Real-time Updates** - WebSocket integration for live data  
✅ **Secure Authentication** - JWT-based auth with secure token storage

## Tech Stack

- **React Native 0.73** with Expo 50
- **TypeScript** for type safety
- **React Navigation** for routing
- **TanStack Query** for data fetching and caching
- **Axios** for HTTP requests
- **Expo Secure Store** for secure token storage
- **WebSocket** for real-time updates

## Prerequisites

- Node.js 18+ and npm/yarn
- Expo CLI: `npm install -g expo-cli`
- iOS Simulator (macOS) or Android Studio (for emulator)
- Trade Aid backend running (see `/trade_aid/README.md`)

## Setup

### 1. Install Dependencies

```bash
cd mobile
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and update the API URL:

```bash
cp .env.example .env
```

Edit `.env`:
```env
# For local development with Trade Aid backend
API_URL=http://localhost:8000

# For production
# API_URL=https://your-backend.railway.app
```

**Important**: For iOS simulator, use `http://localhost:8000`. For Android emulator, use `http://10.0.2.2:8000`.

### 3. Start Development

```bash
# Start Expo development server
npm start

# Or run directly on platform
npm run ios     # iOS simulator
npm run android # Android emulator
npm run web     # Web browser
```

## Project Structure

```
mobile/
├── src/
│   ├── components/      # Reusable UI components
│   │   └── TokenCard.tsx
│   ├── hooks/          # Custom React hooks
│   │   └── useAuth.ts
│   ├── navigation/     # Navigation configuration
│   │   └── AppNavigator.tsx
│   ├── screens/        # App screens
│   │   ├── LoginScreen.tsx
│   │   ├── RegisterScreen.tsx
│   │   ├── ScannerScreen.tsx
│   │   ├── RugShieldScreen.tsx
│   │   ├── WhaleWatchScreen.tsx
│   │   ├── MemeTrendScreen.tsx
│   │   └── AccountScreen.tsx
│   ├── services/       # API and WebSocket services
│   │   ├── api.ts
│   │   └── websocket.ts
│   └── types/          # TypeScript type definitions
│       └── index.ts
├── App.tsx             # App entry point
├── app.config.js       # Expo configuration
└── package.json
```

## API Integration

The app integrates with the Trade Aid Python backend. See full API docs at `http://localhost:8000/docs`.

## Development Tips

### Running with Local Backend

1. Start the Trade Aid backend:
   ```bash
   cd trade_aid
   docker-compose up
   ```

2. Start the mobile app:
   ```bash
   cd mobile
   npm start
   ```

### Building for Production

1. Install EAS CLI:
   ```bash
   npm install -g eas-cli
   ```

2. Build:
   ```bash
   eas build --platform all
   ```

3. Submit to stores:
   ```bash
   eas submit --platform ios
   eas submit --platform android
   ```

## Common Issues

- **Network request failed**: Check API_URL in `.env` matches your backend
- **401 Unauthorized**: Logout and login again
- **WebSocket errors**: Ensure backend WebSocket endpoints are accessible

## Support

- Backend: See `/trade_aid/README.md`
- API docs: Visit `http://localhost:8000/docs`
- Expo docs: https://docs.expo.dev/

## Store Submission Assets

- Privacy Policy: `./PRIVACY_POLICY.md`
- Terms of Service: `./TERMS_OF_SERVICE.md`

Before submitting to stores, host these documents on a public HTTPS URL and use those links in App Store Connect and Google Play Console.

---

Built with ❤️ using React Native and Expo
