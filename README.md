# MDES - Secure VoIP and Chat

MDES is a self-hosted, microservices-based platform for end-to-end encrypted voice calls, realtime messaging, hubs, channels, and rooms. It includes TOTP MFA, a media bot, a web client, and an Electron desktop client.

## Features

| Area | Details |
| --- | --- |
| Voice calls | WebRTC P2P calling via PeerJS, with COTURN for NAT traversal |
| Messaging | AES-256-GCM encrypted realtime and channel messaging |
| Hubs and channels | Invite-code access control, rate limiting, ephemeral rooms |
| Authentication | JWT access and refresh tokens, TOTP MFA, trusted devices, demo mode |
| MusicMan bot | Streams supported media sources into voice rooms |
| Clients | React web app plus Electron desktop packaging for Windows |
| Security | Capability dropping, read-only containers, helmet headers, CORS filtering, rate limiting |

## Architecture

| Service | Language / Stack | Role |
| --- | --- | --- |
| Frontend | React 19 + Vite + Electron | Web and desktop client |
| Gateway | Node.js / Express | Public API entrypoint, proxying, TURN credentials, health aggregation |
| Auth Service | Java 21 / Spring Boot | User accounts, MFA, JWT issuance, bot login |
| Realtime | Node.js / Socket.IO + PeerJS | Signaling, peer coordination, room session state |
| Hub Service | Go / Chi | Hubs, channels, invite codes, encrypted message and key distribution |
| MusicMan | Node.js / Werift | Media bot orchestration and streaming |
| PostgreSQL | Postgres | Auth DB and hub DB |
| Redis | Redis | Session and token support for auth |
| COTURN | coturn | TURN relay for remote peers |

The repository includes a Docker Compose stack and can also be run service-by-service for local development.

## Prerequisites

### Docker-first setup

- Docker Desktop or Docker Engine with `docker compose`
- OpenSSL for generating secrets and RSA keys
- Optional: a public IP or forwarded TURN port if remote users will connect from outside your LAN

### Local development

- Node.js 20+ and npm
- Go 1.22+ for `services/hub-service`
- Java 21 for `services/auth-service`
- Docker Desktop still helps for service dependencies and Auth Service Testcontainers tests
- Playwright browser install for frontend E2E: `npx playwright install chromium`

## Quick Start

### 1. Clone the repo and create `.env.local`

```bash
git clone https://github.com/your-org/mdes-secure-voip.git
cd mdes-secure-voip
cp .env.example .env.local
```

Fill in `.env.local` before starting the stack. The sections below call out the required values for a basic local boot.

### 2. Generate the required secrets

#### JWT key pair

Auth signs JWTs with the private key, while the other services verify them with the public key. The project expects both PEM files to be base64-encoded into `.env.local`.

This PowerShell-safe example generates both values and prints lines you can paste directly into `.env.local`:

```powershell
$priv = openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>$null
$pub  = $priv | openssl rsa -pubout 2>$null

$JWT_PRIVATE_KEY_B64 = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($priv))
$JWT_PUBLIC_KEY_B64  = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($pub))

"JWT_PRIVATE_KEY_B64=$JWT_PRIVATE_KEY_B64"
"JWT_PUBLIC_KEY_B64=$JWT_PUBLIC_KEY_B64"
```

#### BOT_SECRET

`BOT_SECRET` is the shared bot-auth secret used by:

- `services/gateway`
- `services/hub-service`
- `services/auth-service`
- `services/musicman-service`

It is sent in the `X-Bot-Secret` header for bot-specific flows and is also used to protect the MusicMan bot login path. Generate a random 256-bit value:

```bash
openssl rand -base64 32
```

Paste the output into:

```dotenv
BOT_SECRET=...
```

#### BOT_PASSWORD

`BOT_PASSWORD` is the password the MusicMan bot account uses when it authenticates through `/auth/user/bot-login`. It should be a strong random secret and should not match any human user's password.

```bash
openssl rand -base64 24
```

Paste the output into:

```dotenv
BOT_PASSWORD=...
```

#### Other required secrets for a basic local stack

Generate strong values for:

- `AUTH_DB_PASSWORD`
- `HUB_DB_PASSWORD`
- `REDIS_PASSWORD`
- `TURN_SECRET` using `openssl rand -base64 32`

### 3. Configure `.env.local`

For local Docker usage, these are the most important settings to review.

#### Required for first boot

- `JWT_PRIVATE_KEY_B64` and `JWT_PUBLIC_KEY_B64`
- `BOT_SECRET`
- `BOT_PASSWORD`
- `AUTH_DB_PASSWORD`
- `HUB_DB_PASSWORD`
- `REDIS_PASSWORD`
- `TURN_SECRET`

#### Important local defaults to set correctly

- `ALLOWED_ORIGINS=http://localhost:8080`
  Use `http://localhost:5173` for local Vite development, or set both:
  `http://localhost:8080,http://localhost:5173`
- `TURN_HOST=10.10.10.10`
  This matches the Compose network setup used by the backend services
- `TURN_PORT=3478`
- `TURN_SECURE=false`
- `COTURN_REALM=localhost`
- `COTURN_EXTERNAL_IP=`
  Leave blank for local-only testing, set this for remote clients
- Frontend TURN values
  The Docker frontend uses `VITE_TURN_*` values from `docker-compose.yml`, so review those too if you need browser TURN connectivity to match your environment

#### Optional

- `cookies.txt` file enables MusicMan to access age-restricted or private media supported by yt-dlp. In Video Mode, the media is screenshared to channel peers with integrated audio.
- `ALLOWED_VIDEO_ORIGINS` and `ALLOWED_AUDIO_ORIGINS` defaults to Soundcloud
- `DEMO_MODE` and related token expiry settings
  Useful for demo environments, not required for a normal local boot

### 5. Start the stack

```bash
docker compose --env-file .env.local up -d --build
```

### 6. Verify the stack

Host-facing endpoints:

- Frontend: `http://localhost:8080`
- Gateway: `http://localhost:3000`
- Aggregated health: `http://localhost:3000/health`

`/health` on the gateway checks the downstream auth, realtime, hub, and musicman services. Auth, hub, and gateway should all be healthy before MusicMan-related features will work reliably.

### 7. First use

Once the stack is up:

1. Open `http://localhost:8080`
2. Register a user account
3. Create a hub
4. Create or join a room

## Local Development

### Frontend

```bash
cd voip_frontend
npm install
npx vite
```

For Electron:

```bash
cd voip_frontend
npm install
npm run dev
```

### Gateway

```bash
cd services/gateway
npm install
npm run dev
```

### Realtime service

```bash
cd services/realtime
npm install
npm run dev
```

### Hub service

```bash
cd services/hub-service
go run main.go
```

### Auth service

```bash
cd services/auth-service
./gradlew bootRun
```

### MusicMan service

```bash
cd services/musicman-service
npm install
npm run dev
```

## Testing

### All services checklist

- Backend unit and integration tests:
  `gateway`, `realtime`, `musicman-service`, `hub-service`, `auth-service`
- Frontend E2E tests:
  `voip_frontend` via Playwright

### Gateway

```bash
cd services/gateway
npm test
```

### Realtime service

```bash
cd services/realtime
npm test
```

### MusicMan service

```bash
cd services/musicman-service
npm test
```

### Hub service

Prerequisite: Go

```bash
cd services/hub-service
go test ./...
```

### Auth service

Prerequisites:

- Java 21

```bash
cd services/auth-service
./gradlew test
```

### Frontend E2E

Prerequisites:

```bash
cd voip_frontend
npm install
npx playwright install chromium # only needed once
npm test
```

## Electron Build (Windows)

```bash
cd voip_frontend
npm install
npm run build
npm run package
```

Portable and setup builds are found in: `voip_frontend/release/`.

## Ports

| Service | Port | Notes |
| --- | --- | --- |
| Frontend (Docker) | 8080 | Nginx-served web client |
| Gateway | 3000 | Public API entrypoint and health endpoint |
| Frontend (Vite dev) | 5173 | Local frontend development and Playwright base URL |
| PeerJS | 9000 | Peer signaling behind the realtime service |
| Realtime | 9001 | Socket signaling service |
| MusicMan | 4000 | Internal service port in Compose |
| Hub Service | 8080 | Internal service port in Compose |
| Auth Service | 8010 | Internal service port in Compose |
| COTURN | 3478 | TURN port inside the container, mapped to host `13478` in Compose |

# Roadmap
1. Fork `werift` and `werift-ice` to remove its dependency on a vulnerable version of `ip`.
2. Move away from `PeerJS` for VoIP and screenshares to webrtc.