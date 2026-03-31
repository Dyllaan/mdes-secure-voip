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

### `auth.spec.ts`: Login

1. Renders username, password inputs and Sign In button
2. Toggle to register mode shows register form
3. Successful login redirects off the login page
4. Login failure shows error message
5. MFA-required response shows MFA form
6. Sign In button is disabled while request is in flight

### `auth.spec.ts`: Register

1. Renders register form when toggled from login
2. Can toggle back to login from register
3. Passwords not matching shows error toast
4. Password shorter than 8 chars is rejected by browser validation
5. Successful registration shows MFA setup dialog
6. Server error during registration shows error toast

### `hubs.spec.ts`: Hub list

1. Displays list of hubs from API
2. Shows empty state when user has no hubs

### `hubs.spec.ts`: Create hub

1. Create button is disabled when hub name input is empty
2. Create button is enabled after typing a hub name
3. Creating a hub adds it to the list
4. Pressing Enter in hub name input creates the hub
5. Create hub API error shows error message

### `hubs.spec.ts`: Join hub

1. Join button is disabled when invite input is empty
2. Join button is enabled after typing an invite code
3. Redeeming an invite code navigates to the hub
4. Invalid invite code shows error message

### `hubs.spec.ts`: Hub navigation

1. Clicking a hub item navigates to the hub page
2. Page shows the correct hub count

### `navigation.spec.ts`: Unauthenticated redirects

1. Unauthenticated user visiting `/` is redirected to `/login`
2. Unauthenticated user visiting `/hubs/123` is redirected to `/login`
3. Unauthenticated user visiting `/keys` is redirected to `/login`

### `navigation.spec.ts`: Authenticated redirects

1. Authenticated user without IDB keys visiting `/` is redirected to `/keys`
2. Authenticated user with IDB keys visiting `/login` is redirected to `/`
3. Authenticated user with IDB keys visiting `/register` is redirected to `/`
4. Unknown route shows 404 page

# Commands
-`npm install`

-`npx playwright install chromium`
    - Only need to run this once

-`npm run test:ui`
    - Run before committing when changes are made