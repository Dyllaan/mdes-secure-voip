const config = {
  AUTH_URL: import.meta.env.VITE_AUTH_URL || '/auth',
  HUB_SERVICE_URL: import.meta.env.VITE_HUB_SERVICE_URL || 'http://localhost:8080/api',
  SIGNALING_SERVER: import.meta.env.VITE_SOCKET_URL || window.location.origin,
  PEER_HOST: import.meta.env.VITE_PEER_HOST || window.location.hostname,
  PEER_PORT: import.meta.env.VITE_PEER_PORT || (window.location.port || '80'),
  PEER_SECURE: import.meta.env.VITE_PEER_SECURE || (window.location.protocol === 'https:' ? 'true' : 'false'),
  PEER_PATH: import.meta.env.VITE_PEER_PATH || '/peerjs',
  MUSICMAN_URL: import.meta.env.VITE_MUSICMAN_URL ?? 'http://localhost:4000',
};
export default config;