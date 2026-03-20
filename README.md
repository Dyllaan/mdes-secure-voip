# voip_and_content_synchronisation

---

## Services

- [Gateway](#gateway)
- [Realtime](#realtime)
- [Hub](#hub)

---

## Gateway

A lightweight Express reverse proxy that acts as the single entry point for the system. It routes HTTP and WebSocket connections to the appropriate downstream microservices.

### Tech Stack

| Layer | Technology |
|---|---|
| HTTP Framework | Express 4 |
| Proxying | http-proxy-middleware 2 |
| CORS | cors |
| Runtime | Node.js 18 (Alpine) |

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Gateway listen port |
| `NODE_ENV` | | Set to `docker` to load `.env.docker`, otherwise loads `.env.local` |
| `CORS_ORIGIN` | `*` | Value for the `Access-Control-Allow-Origin` header |
| `AUTH_SERVICE_URL` | `http://localhost:3003` | Auth service base URL |
| `REALTIME_SERVICE_URL` | `http://localhost:3001` | Realtime service base URL |
| `PEER_SERVICE_URL` | `http://localhost:9000` | PeerJS service base URL |
| `HUB_SERVICE_URL` | `http://localhost:8080` | Hub service base URL |
| `MUSICMAN_URL` | `http://localhost:4000` | MusicMan service base URL |
| `JWT_SECRET` | | Shared JWT secret used across all services |

### HTTP Routes

| Method | Path | Target | Path Rewrite | Auth | Description |
|---|---|---|---|---|---|
| `GET` | `/health` | Gateway | | None | Returns `{ status: 'UP', timestamp }` |
| `ALL` | `/auth/*` | Auth | `^/auth` -> `` | JWT | Strips `/auth` prefix and forwards to Auth service |
| `ALL` | `/realtime/health` | Realtime | `^/realtime/health` -> `/health` | None | Proxied health check for Realtime service |
| `ALL` | `/realtime/*` | Realtime | | JWT | Forwards to Realtime service HTTP endpoints |
| `ALL` | `/hub/*` | Hub | `^/hub` -> `/api` | JWT | Rewrites `/hub` to `/api` and forwards to Hub service |
| `ALL` | `/musicman/*` | MusicMan | `^/musicman` -> `` | JWT | Strips `/musicman` prefix and forwards to MusicMan service |
| `ALL` | `/*` | Gateway | | None | 404 — returns list of available routes |

### WebSocket Proxying

WebSocket upgrade requests are intercepted on the HTTP server's `upgrade` event and routed by URL prefix. Unrecognised paths have their socket destroyed immediately.

| Path Prefix | Target | Env Variable | Default | Description |
|---|---|---|---|---|
| `/socket.io/*` | Realtime | `REALTIME_SERVICE_URL` | `http://localhost:3001` | Socket.IO connection for real-time events |
| `/peerjs/*` | Peer | `PEER_SERVICE_URL` | `http://localhost:9000` | PeerJS WebRTC peer discovery |

### Downstream Services

The Gateway holds no database connection. All persistence is handled by downstream services.

| Service | Env Variable | Local | Docker | Purpose |
|---|---|---|---|---|
| Auth | `AUTH_SERVICE_URL` | `http://localhost:3003` | `http://voip-auth-service:8010` | User authentication and JWT issuance |
| Realtime | `REALTIME_SERVICE_URL` | `http://localhost:3001` | `http://voip-realtime:9001` | WebSocket events, room management |
| Peer | `PEER_SERVICE_URL` | `http://localhost:9000` | `http://voip-realtime:9000` | PeerJS WebRTC signalling |
| Hub | `HUB_SERVICE_URL` | `http://localhost:8080` | `http://hub-service:8080` | Content, channels, and data |
| MusicMan | `MUSICMAN_URL` | `http://localhost:4000` | `http://musicman-service:4000` | Music/media bot |

### Middleware

| Middleware | Purpose |
|---|---|
| `cors()` | Adds CORS headers; allows `GET, POST, PUT, DELETE, OPTIONS` with `Authorization` and `Content-Type` |
| Request logger | Logs `[ISO timestamp] METHOD PATH` for every request |
| `createProxyMiddleware()` | Per-route HTTP proxying with path rewriting and `onError` handlers |
| WebSocket upgrade handler | Routes WebSocket upgrade events to the correct proxy |
| 404 handler | Catches unmatched routes and returns a JSON list of valid paths |

### Docker

| Property | Value |
|---|---|
| Base image | `node:18-alpine` |
| Exposed ports | `3000` (HTTP), `9000` (PeerJS passthrough) |
| Container name | `voip-gateway` |
| Network | `voip-network` |
| Depends on | `p2p-voip-realtime-service` |
| Restart policy | `unless-stopped` |

### Directory Structure

```
services/gateway/
├── gateway.js
├── package.json
└── .dockerignore
```

---

## Realtime

A Node.js WebSocket and signalling server handling room management, WebRTC coordination, end-to-end encrypted messaging, and screen sharing.

### Tech Stack

| Layer | Technology |
|---|---|
| HTTP Framework | Express 4 |
| WebSockets | Socket.IO 4 |
| WebRTC Peers | PeerJS |
| Encryption | libsignal-protocol-typescript |
| Auth | jsonwebtoken |
| Security Headers | Helmet |
| State | In-memory (Maps) |

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `REALTIME_PORT` | `3001` | HTTP + Socket.IO listen port |
| `PEER_PORT` | `9000` | PeerJS server port |
| `JWT_SECRET` | | Base64-encoded JWT signing secret (required) |
| `JWT_EXPIRES_IN` | `24h` | JWT token lifetime |
| `ALLOWED_ORIGINS` | `localhost:3000,5173,8080` | Comma-separated CORS origins |
| `HUB_SERVICE_URL` | | Base URL of the Hub service |
| `NODE_ENV` | | Set to `production` to enable HTTPS |
| `SSL_KEY_PATH` | | Path to SSL private key (production only) |
| `SSL_CERT_PATH` | | Path to SSL certificate (production only) |

### REST API

All `/api/*` routes require `Authorization: Bearer <JWT_TOKEN>`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Service health: active rooms, users, keys, queued messages |
| `GET` | `/api/rooms` | JWT | List all active rooms with user counts |
| `POST` | `/api/rooms` | JWT | Create a room; `roomId` is optional in body and auto-generated if omitted |
| `DELETE` | `/api/rooms/:roomId` | JWT | Delete a room (creator only) |

### WebSocket API

Connect via Socket.IO with `{ auth: { token: "<JWT>" } }`.

#### Connection

| Direction | Event | Payload | Description |
|---|---|---|---|
| Server -> Client | `peer-assigned` | `{ peerId }` | Assigned peer ID on connect |
| Server -> Client | `room-list` | `Room[]` | Available rooms on connect |

#### User & Room

| Event | Direction | Payload | Rate Limit | Description |
|---|---|---|---|---|
| `join-room` | Client -> Server | `{ roomId, alias }` | 5/60s | Join a room; triggers Hub access check |
| `user-update` | Client -> Server | `{ alias }` | 5/60s | Update display alias |
| `user-connected` | Server -> Client | `{ peerId, alias }` | | Broadcast to room when user joins |
| `user-disconnected` | Server -> Client | `{ peerId }` | | Broadcast to room when user leaves |
| `all-users` | Server -> Client | `User[]` | | Current room members on join |
| `queued-messages` | Server -> Client | `Message[]` | | Queued offline messages on join |

#### WebRTC Signalling

| Event | Direction | Payload | Description |
|---|---|---|---|
| `webrtc-offer` | Bidirectional | `{ targetPeerId, offer }` | Forward SDP offer to target peer |
| `webrtc-answer` | Bidirectional | `{ targetPeerId, answer }` | Forward SDP answer to target peer |
| `webrtc-ice-candidate` | Bidirectional | `{ targetPeerId, candidate }` | Forward ICE candidate to target peer |

#### Screen Sharing

| Event | Direction | Payload | Rate Limit | Description |
|---|---|---|---|---|
| `request-screen-peer-id` | Client -> Server | | 5/60s | Request a dedicated screen-share peer ID |
| `screen-peer-assigned` | Server -> Client | `{ screenPeerId }` | | Returns the assigned screen peer ID |
| `screenshare-started` | Client -> Server | `{ screenPeerId }` | 10/10s | Notify room that screen share is active |
| `screenshare-stopped` | Client -> Server | | 10/10s | Notify room that screen share ended |
| `peer-screenshare-started` | Server -> Client | `{ peerId, screenPeerId }` | | Broadcast to room |
| `peer-screenshare-stopped` | Server -> Client | `{ peerId }` | | Broadcast to room |
| `room-screen-peers` | Server -> Client | `ScreenPeer[]` | | All active screen shares in room |

#### Signal Protocol (E2E Encryption Keys)

| Event | Direction | Payload | Rate Limit | Description |
|---|---|---|---|---|
| `signal-register-keys` | Client -> Server | `{ identityKey, signedPreKey, preKeys[], registrationId }` | 5/60s | Register Signal Protocol key bundle |
| `signal-keys-registered` | Server -> Client | | | Acknowledgement |
| `signal-request-bundle` | Client -> Server | `{ recipientUsername }` | 30/60s | Fetch recipient's key bundle |
| `signal-prekey-bundle` | Server -> Client | Bundle | | Returned key bundle |
| `signal-prekeys-low` | Server -> Client | | | Fewer than 10 pre-keys remaining |
| `signal-refresh-prekeys` | Client -> Server | `{ preKeys[] }` | 10/5min | Replenish one-time pre-keys |
| `signal-prekeys-refreshed` | Server -> Client | | | Acknowledgement |

#### RSA & Room Key Exchange

| Event | Direction | Payload | Rate Limit | Description |
|---|---|---|---|---|
| `register-rsa-key` | Client -> Server | `{ publicKey }` | 5/60s | Register RSA public key; broadcasts to room |
| `rsa-key-registered` | Server -> Client | | | Acknowledgement |
| `user-rsa-key` | Server -> Client | `{ username, publicKey }` | | Broadcast RSA key to room |
| `request-rsa-key` | Client -> Server | `{ username }` | 30/60s | Request a user's RSA public key |
| `request-room-key` | Client -> Server | `{ providerUsername }` | 5/60s | Request encrypted room key from provider |
| `room-key-response` | Client -> Server | `{ requesterUsername, encryptedKey }` | 10/60s | Deliver encrypted room key to requester |

#### Encrypted Messaging

| Event | Direction | Payload | Rate Limit | Description |
|---|---|---|---|---|
| `encrypted-chat-message` | Client -> Server | `{ recipientUsername, message, type, registrationId }` | 10/10s | 1:1 Signal Protocol encrypted message (type 1 or 3); queued if recipient is offline |
| `room-chat-message` | Client -> Server | `{ roomId, encryptedMessage }` | 10/10s | Broadcast encrypted message to all room members |
| `message-queued` | Server -> Client | | | Message was queued for offline recipient |

#### Channel Events

| Event | Direction | Payload | Rate Limit | Description |
|---|---|---|---|---|
| `channel-message-sent` | Client -> Server | `{ serverId, channelId }` | 30/10s | Broadcast channel message event to all connected clients |
| `channel-key-rotated` | Client -> Server | `{ serverId, channelId, newVersion }` | 5/60s | Broadcast channel key rotation event to all connected clients |

#### Error Events

| Event | Description |
|---|---|
| `chat-error` | Chat operation error |
| `signal-error` | Signal Protocol error |
| `webrtc-error` | WebRTC signalling error |
| `join-error` | Room join error |
| `user-error` | User operation error |
| `rate-limit-exceeded` | Rate limit hit; includes retry-after info |

### Connections to Other Services

**Hub Service**
- Verifies a user has access to a channel before allowing a room join
- `GET ${HUB_SERVICE_URL}/channels/{channelId}/access`
- Auth: Bearer token (same JWT passed by the client)
- Triggered by: `join-room` event

**PeerJS Server**
- WebRTC peer discovery and coordination
- Runs as an embedded server within the same process on `PEER_PORT` (default `9000`)

### Security Limits

| Limit | Value |
|---|---|
| Max message length | 500 characters (plain), 2000 characters (base64) |
| Max alias length | 50 characters |
| Max room ID length | 50 characters |
| Max queued messages per user | 100 |
| Message queue retention | 7 days |
| Signal key retention | 90 days |
| API rate limit | 1,000 requests / 15 minutes |
| Socket global rate limit | 100 actions / minute |

### Directory Structure

```
services/realtime/
├── index.js
├── config.js
├── SecureRealtimeService.js
├── routes.js
├── package.json
├── handlers/
│   ├── SocketEventHandlers.js
│   ├── ChatHandler.js
│   ├── WebRTCHandler.js
│   ├── SignalProtocolHandler.js
│   ├── RoomKeyHandler.js
│   └── UserHandler.js
├── http/
│   └── HttpAndServerSetup.js
├── middleware/
│   └── middleware.js
├── room/
│   └── RoomManager.js
└── utils/
    ├── sanitize.js
    ├── validate.js
    └── roomId.js
```

---

## Hub

A Go REST API for managing collaborative hubs with role-based access control, end-to-end encrypted messaging, multi-device key management, and ECIES-based channel key distribution.

### Tech Stack

| Layer | Technology |
|---|---|
| Language | Go 1.25 |
| HTTP Router | chi v5 |
| ORM | GORM |
| Database | PostgreSQL |
| Auth | golang-jwt/jwt v5 (HS256) |
| IDs | google/uuid |

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | | PostgreSQL connection string |
| `JWT_SECRET` | Yes | | Base64-encoded HMAC-SHA256 signing secret shared with other services |
| `BOT_SECRET` | Yes | | Shared secret required in `X-Bot-Secret` header for bot-join endpoint |
| `PORT` | No | `8080` | HTTP listen port |

JWT secret loading attempts base64 URL decoding first (with and without padding), then falls back to raw string.

### REST API

All `/api/*` routes require `Authorization: Bearer <JWT_TOKEN>`. The token must contain a `sub` claim (user ID).

#### Hubs

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/api/hubs` | Any authenticated user | Create a hub; creator is automatically added as owner |
| `GET` | `/api/hubs` | Any authenticated user | List all hubs the user is a member of |
| `GET` | `/api/hubs/{hubID}` | Member | Get hub details |
| `DELETE` | `/api/hubs/{hubID}` | Owner | Delete a hub |
| `POST` | `/api/hubs/{hubID}/bot-join` | Bot (`X-Bot-Secret` + JWT) | Add a bot user to the hub |

#### Channels

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/api/hubs/{hubID}/channels` | Owner / Admin | Create a channel (`type`: `"text"` or `"voice"`, default `"text"`) |
| `GET` | `/api/hubs/{hubID}/channels` | Member | List channels ordered by creation time |
| `DELETE` | `/api/hubs/{hubID}/channels/{channelID}` | Owner / Admin | Delete a channel |
| `GET` | `/api/channels/{channelID}/access` | Member | Verify voice channel access; returns user role and IDs |

#### Members

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/api/hubs/{hubID}/members` | Owner | Invite a user by `userId`; user must not already be a member |
| `GET` | `/api/hubs/{hubID}/members` | Member | List all members with role and join time |
| `DELETE` | `/api/hubs/{hubID}/members/{memberID}` | Owner | Kick a member (cannot kick owner) |
| `DELETE` | `/api/hubs/{hubID}/leave` | Non-owner member | Leave a hub (owner must delete instead) |

#### Messages

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/api/hubs/{hubID}/channels/{channelID}/messages` | Member | Send encrypted message (`ciphertext`, `iv`, `keyVersion`) |
| `GET` | `/api/hubs/{hubID}/channels/{channelID}/messages` | Member | Fetch message history; query params: `limit` (default 50, max 100), `before` (RFC3339 cursor) |

#### Invite Codes

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/api/hubs/{hubID}/invites` | Member | Generate a random 8-character hex invite code |
| `POST` | `/api/invites/{code}/redeem` | Any authenticated user | Redeem an invite code; returns hub and new member record |

#### Ephemeral Rooms

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/api/hubs/{hubID}/ephemeral` | Member | Start an ephemeral room with `roomId`; 30-minute TTL |
| `GET` | `/api/hubs/{hubID}/ephemeral` | Member | Get active ephemeral room status |
| `DELETE` | `/api/hubs/{hubID}/ephemeral` | Member | End the ephemeral room |

#### Device Keys (P-256 ECDH)

| Method | Path | Role | Description |
|---|---|---|---|
| `PUT` | `/api/hubs/{hubID}/device-key` | Member | Register or update a device's P-256 SPKI public key (`deviceId`, `publicKey`) |
| `GET` | `/api/hubs/{hubID}/device-keys` | Member | Get public keys for all members' devices in the hub |

#### Channel Key Bundles (ECIES)

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/api/hubs/{hubID}/channel-keys/bundles` | Member | Store ECIES-encrypted AES-256-GCM channel keys, one bundle per recipient device |
| `GET` | `/api/hubs/{hubID}/channel-keys/bundles` | Member | Retrieve key bundles addressed to the authenticated user's devices; filter by `channelId` |

#### Key Rotation Flags

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/api/hubs/{hubID}/channels/{channelID}/rotation-needed` | Member | Signal that channel key rotation is required |
| `GET` | `/api/hubs/{hubID}/channels/{channelID}/rotation-needed` | Member | Check if rotation is flagged; returns `{ rotationNeeded, rotationNeededSince }` |
| `DELETE` | `/api/hubs/{hubID}/channels/{channelID}/rotation-needed` | Member | Clear the rotation flag after successful key rotation |

#### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Returns `"ok"` |

### Database Schema

Auto-migrated via GORM on startup.

| Table | Key Columns | Notes |
|---|---|---|
| `hubs` | `id` (UUID), `name`, `owner_id`, `created_at` | |
| `channels` | `id` (UUID), `hub_id`, `name`, `type`, `created_at` | Name unique per hub |
| `members` | `id` (UUID), `user_id`, `hub_id`, `role`, `joined_at` | `user_id` + `hub_id` unique |
| `messages` | `id` (UUID), `channel_id`, `sender_id`, `ciphertext`, `iv`, `key_version`, `timestamp` | Indexed on `(channel_id, timestamp)` |
| `invite_codes` | `id` (UUID), `hub_id`, `code`, `created_at` | Code unique |
| `member_device_keys` | `id` (UUID), `user_id`, `device_id`, `hub_id`, `public_key`, `updated_at` | Unique on `(user_id, device_id, hub_id)` |
| `channel_key_bundles` | `id` (UUID), `channel_id`, `hub_id`, `recipient_user_id`, `recipient_device_id`, `key_version`, `sender_ephemeral_pub`, `ciphertext`, `iv`, `created_at` | |
| `channel_key_rotation_flags` | `channel_id` (PK), `rotation_needed`, `rotation_needed_since` | |

### Role Permissions

| Action | Owner | Admin | Member | Bot |
|---|---|---|---|---|
| Delete hub | Y | | | |
| Create / delete channel | Y | Y | | |
| Invite member | Y | | | |
| Kick member | Y | | | |
| Leave hub | | Y | Y | Y |
| Send / read messages | Y | Y | Y | Y |
| Register device key | Y | Y | Y | Y |
| Post / get key bundles | Y | Y | Y | Y |
| Signal key rotation | Y | Y | Y | Y |
| Start ephemeral room | Y | Y | Y | Y |

### Middleware

| Middleware | Scope | Description |
|---|---|---|
| CORS | Global | Allows all origins, `GET POST PUT DELETE OPTIONS`, `Content-Type` and `Authorization` headers |
| Auth | `/api/*` | Validates JWT Bearer token (HS256); injects user ID into request context |

### Connections to Other Services

The Hub service makes no outbound calls to other microservices at runtime. It exposes `GET /api/channels/{channelID}/access` which the Realtime service calls to verify voice channel access before allowing a room join. `JWT_SECRET` and `BOT_SECRET` are shared with the Auth and MusicMan services via the shared `.env`.

### Directory Structure

```
services/hub-service/
├── main.go
├── go.mod
├── go.sum
└── internal/
    ├── db/
    │   └── db.go
    ├── middleware/
    │   └── auth.go
    ├── structs/
    │   └── structs.go
    └── handlers/
        ├── hubs.go
        ├── channels.go
        ├── members.go
        ├── messages.go
        ├── invites.go
        ├── encryption.go
        └── ephemeral.go
```