# TradeAid Store Submission Checklist

Last updated: April 15, 2026

## Current readiness status
- TypeScript check: passing
- Expo doctor: 14 of 15 checks passing
- Remaining warning: native folders exist with app config prebuild fields

## Pre-submission setup (required)
1. Create or verify Expo account access for project tradeaid.
2. Confirm EAS project ID is set in app config.
3. Set production environment variables in EAS:
- APP_ENV=production
- EXPO_PUBLIC_API_URL=https://your-production-api-domain
4. Host legal docs on public HTTPS URLs:
- Privacy Policy URL
- Terms of Service URL

## Build and signing (Google Play)
1. Run build command:
- npm run build:android
2. If prompted, log into Expo account.
3. Let EAS manage Android signing key or upload your own keystore.
4. Download resulting AAB artifact.
5. In Play Console, create app release and upload AAB.

## Build and signing (Apple App Store)
1. Run build command:
- npm run build:ios
2. If prompted, log into Expo account and Apple Developer account.
3. Let EAS manage iOS certificates and provisioning profiles, or provide your own.
4. Ensure bundle ID matches com.tradeaid.app in App Store Connect.
5. Upload build to TestFlight and complete internal testing.

## App Store Connect checklist
1. App information:
- App name: TradeAid
- Primary language set
- Bundle ID: com.tradeaid.app
- SKU created
2. Pricing and availability set.
3. App Privacy section completed using your real production data flows.
4. Export compliance set (usesNonExemptEncryption false in config).
5. Add required assets:
- App icon
- iPhone screenshots
- iPad screenshots only if supporting iPad listing
6. Add support URL and marketing URL.
7. Add Privacy Policy URL.
8. Add review notes and test credentials if login is required.
9. Submit for review.

## Google Play Console checklist
1. Main store listing:
- App name, short description, full description
- Graphics and screenshots
- Category and contact details
2. App content forms:
- Privacy policy URL
- Data safety form
- Ads declaration
- Target audience and content rating
- News app declaration if applicable
3. Production release:
- Upload AAB
- Add release notes
- Start rollout (phased rollout recommended)

## Data safety guidance for current mobile config
- Declared runtime permissions are INTERNET and VIBRATE.
- Storage and overlay permissions are blocked in config.
- Push notifications are used via Expo notifications.
- Secure token storage is used via expo-secure-store.

## Final go-live checks
1. Verify production API URL from a TestFlight/Internal test build.
2. Validate login, registration, token scanning, and push notification flow.
3. Validate no localhost endpoints are used in production.
4. Confirm crash-free startup and first-session performance.
5. Confirm legal links are live and accessible without login.

## Known technical warning
Expo doctor warns about unsynced app config fields with native folders present.

Recommended approach now:
- Keep native folder workflow and treat native project files as source of truth.
- If you want full config sync from app config, migrate to CNG by removing native folders and using prebuild workflow.
