# MDES — Secure VoIP & Chat

A self-hosted, microservices-based platform for end-to-end encrypted voice/video calls and real-time messaging. Organized around **hubs → channels → rooms**, with TOTP-based MFA, a media bot, and support for both web and desktop (Electron) clients.

## Features

- **Voice & video calls** via WebRTC P2P (PeerJS), with COTURN for NAT traversal
- **Real-time text messaging** per room using Socket.io
- **Hub & channel management** — invite-code access control, rate-limited redemption
- **Authentication** — JWT (access/refresh), TOTP MFA, trusted device management, demo mode
- **MusicMan bot** — streams YouTube, SoundCloud, and Spotify audio into calls via yt-dlp
- **Desktop app** — Electron wrapper for Windows
- **Security** — no privileged containers, capability dropping, helmet headers, CORS filtering, rate limiting

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

Edit `.env.local` — the required values are:

```bash
# JWT — shared across all services
SECRET_KEY=<long random string>
TEMP_MFA_SECRET_KEY=<long random string>

# Databases
AUTH_DB_PASSWORD=<password>
HUB_DB_PASSWORD=<password>

# MusicMan bot credentials (must match a registered user)
BOT_SECRET=<secret>
BOT_PASSWORD=<password>

# TURN server
TURN_SECRET=<32-byte hex, e.g. openssl rand -hex 32>
COTURN_REALM=<your domain or hostname>
COTURN_EXTERNAL_IP=<your public IP>
TURN_HOST=10.10.10.10
TURN_PORT=3478

# CORS — the URL your frontend is served from
ALLOWED_ORIGINS=http://localhost

# Demo mode (optional — set false to disable)
DEMO_MODE=false
```

Token expiry, media limits, and log levels can also be tuned — see `.env.example` for the full reference.

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
