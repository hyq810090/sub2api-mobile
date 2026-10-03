<p align="center">
  <img src="icons/ios/AppIcon.appiconset/icon-1024.png" alt="sub2api-mobile logo" width="96" />
</p>

# sub2api-mobile

Mobile-first admin console for Sub2API operations, built with Expo + React Native + Expo Router.

## Mobile Preview

<img src="docs/mobile.jpg" alt="Mobile Preview" width="420" />

## Highlights

- Cross-platform app (iOS / Android / Web) for operational and admin workflows.
- Server health and metrics monitoring views.
- User balances/status, API key quotas, account usage, reset credits, and subscription quota management.
- Multi-account admin server switching in settings.

Android 1.1.0 focuses on daily queries and management, with four tabs: overview,
users, accounts, and servers. See the [mobile management guide](docs/MOBILE_MANAGEMENT.md)
for supported actions, backend requirements, and validation instructions.

## Tech Stack

- Expo SDK 54
- React Native 0.81
- React 19
- Expo Router
- TanStack Query
- Valtio

## Prerequisites

- Node.js 20+
- npm 10+

## Getting Started

Install dependencies:

```bash
npm ci
```

Run locally:

```bash
npm run start
```

Common targets:

```bash
npm run android
npm run ios
npm run web
```

## Build & Release

EAS scripts:

```bash
npm run eas:build:development
npm run eas:build:preview
npm run eas:build:production
```

OTA update scripts:

```bash
npm run eas:update:preview -- "your message"
npm run eas:update:production -- "your message"
```

Additional release notes: [docs/EXPO_RELEASE.md](docs/EXPO_RELEASE.md)

GitHub Actions Android build (downloadable):

- Workflow: `.github/workflows/eas-build.yml`
- Trigger: **Actions → EAS Build → Run workflow**
- Inputs: `profile=preview`, `platform=android`
- Requirement: repository secret `EXPO_TOKEN`
- Download: after completion, open the run **Summary** and use the `ANDROID download` link.

## Project Structure

```txt
app/                 Expo Router routes/screens
src/components/      Reusable UI components
src/services/        Admin API request layer
src/store/           Global config/account state (Valtio)
src/lib/             Utilities, query client, fetch helpers
docs/                Operational and release documentation
server/              Local Express proxy for admin APIs
```

## Security Notes

- Web builds are intentionally configured to avoid persistent storage of `adminApiKey`.
- Native platforms continue to use secure storage semantics.
- For responsible disclosure, see [SECURITY.md](SECURITY.md).

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
