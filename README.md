# voip_and_content_synchronisation

---

## Services

- [Gateway](#gateway)
- [Realtime](#realtime)
- [Hub](#hub)

# Get Started

`docker compose --env-file .env.local up`

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