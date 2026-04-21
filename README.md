# MDES — Secure VoIP & Chat

A self-hosted, microservices-based platform for end-to-end encrypted voice calls and real-time messaging. Organized around **hubs -> channels -> rooms**, with TOTP-based MFA, a media bot, and support for both web and desktop (Electron) clients.

| Features |  |
| ----------- | ----------- |
| Voice calls | via WebRTC P2P (PeerJS), with COTURN for NAT traversal |
| Realtime Communication | AES-256-GCM encrypted messaging, screenshares, VoIP
| Hubs & channels | invite-code access control, rate-limited redemption |
| Authentication | JWT (access/refresh), TOTP MFA, trusted device management, demo mode |
| MusicMan Bot | streams YouTube, SoundCloud, and Spotify audio into calls via yt-dlp |
| Desktop App | Electron wrapper for Windows |
| Security | no privileged containers, capability dropping, helmet headers, CORS filtering, rate limiting |

## Architecture

| Service | Language | Role |
|---|---|---|
| Gateway | Node.js / Express | Reverse proxy, rate limiting, WebSocket routing |
| Auth Service | Java 21 / Spring Boot | User accounts, MFA, JWT issuance |
| Realtime | Node.js / Socket.io | Signaling, room management |
| Hub Service | Go / Chi | Hubs, channels, rooms, invite codes |
| MusicMan | Node.js / Werift | Media bot, audio streaming |
| Frontend | React 19 + Vite + Electron | Web & desktop client |
| COTURN | coturn | TURN server for NAT traversal |
| PostgreSQL × 2 | — | Auth DB + Hub DB |
| Redis | — | Session caching, token blacklist |

All services run in a Docker bridge network (`10.10.10.0/24`).

## Prerequisites

- Docker & Docker Compose
- A public IP (or forwarded ports) for COTURN if hosting for remote users

## Self-Hosting

### 1. Clone and configure

```bash
git clone https://github.com/your-org/mdes-secure-voip.git
cd mdes-secure-voip
cp .env.example .env.local
```
#### JWT Secret Configuration

Authentication uses RS256 asymmetric signing to decouple token creation from verification. The server uses a Private Key to sign JWTs, while the Public Key allows services to verify authenticity without the ability to forge tokens. This 2048-bit RSA pair is Base64-encoded to ensure the PEM structure remains string-safe.

```powershell
# Generate the Private Key and derive the Public Key
$priv = openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>$null
$pub  = $priv | openssl rsa -pubout 2>$null

# Convert keys to Base64 strings
$JWT_PRIVATE_KEY_B64 = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($priv))
$JWT_PUBLIC_KEY_B64  = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($pub))

# Output
"JWT_PRIVATE_KEY_B64=$JWT_PRIVATE_KEY_B64"
"JWT_PUBLIC_KEY_B64=$JWT_PUBLIC_KEY_B64"
```

#### Demo Secret

Token expiry, media limits, and log levels can be configured as laid out in `.env.example`.

### 2. Start the stack

```bash
docker compose --env-file .env.local up -d
```

The frontend is served on **port 80** by Nginx. The gateway (API entry point) is on **port 3000**.

### 3. Open the app

Navigate to `http://localhost` (or your server's IP/domain). Register an account and create your first hub.

## Development

```bash
# Frontend (web + hot-reload)
cd voip_frontend && npm install && npx vite

# Frontend (Electron desktop)
cd voip_frontend && npm install && npm run dev

# Gateway
cd services/gateway && npm install && npm run dev

# Realtime service
cd services/realtime && npm install && npm run dev

# Hub service
cd services/hub-service && go run main.go

# Auth service
cd services/auth-service && ./gradlew bootRun
```

Each service reads its configuration from environment variables; see each service's directory for service-specific defaults.

## Building the Electron app (Windows)

```bash
cd voip_frontend
npm install
npm run build   # builds web assets + Electron
npm run package # produces installer & portable .exe in release/
```

## Running Tests

```bash
# Gateway & Realtime (Jest)
cd services/gateway && npm test
cd services/realtime && npm test

# Hub Service (Go — 88% coverage)
cd services/hub-service && go test -v ./...

# Auth Service (Spring Boot + TestContainers)
cd services/auth-service && ./gradlew test

# Frontend E2E (Playwright)
cd voip_frontend && npm test
```

## Port Reference

| Service | Port | Notes |
|---|---|---|
| Frontend | 80 | Nginx, production |
| Gateway | 3000 | API entry point |
| PeerJS | 9000 | P2P signaling |
| Realtime | 9001 | WebSocket signaling |
| COTURN | 3478 | TCP + UDP |
| Frontend dev | 5173 | Vite dev server |
