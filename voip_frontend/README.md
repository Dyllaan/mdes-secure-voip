# Frontend - mdes.sh

React/TypeScript frontend for the VoIP and chat platform, deployable as a website or Electron desktop app.

## Prerequisites

- Node.js 18+
- `npm install`

## Development

Web only:
```bash
npx vite
```

Web + Electron:
```bash
npm run dev
```

## Building

### Website
```bash
npm run build
```
Output is in `dist/` - This is served to users

### Electron (Windows)
```bash
npm run package
```
Output is in `release/` - produces an installer and a portable `.exe`.

> Run this in a standalone terminal and not VS Code's integrated terminal, as it can cause file lock issues.

# Playwright Guide
Playwright will run tests in a browser environment to ensure core functionalities work.
# Tests

# Commands
-`npm install`

-`npx playwright install chromium`
    - Only need to run this once

-`npm run test:ui`
    - Run before committing when changes are made