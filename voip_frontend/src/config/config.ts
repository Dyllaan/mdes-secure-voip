const buildEnv = import.meta.env as Record<string, string | undefined>;
const runtimeEnv = window.__APP_CONFIG__ ?? {};
const env = { ...buildEnv, ...runtimeEnv };

const config = {
  AUTH_URL: env.VITE_AUTH_URL || '/auth',
  HUB_SERVICE_URL: env.VITE_HUB_SERVICE_URL || 'http://localhost:8080/api',
  SIGNALING_SERVER: env.VITE_SOCKET_URL || window.location.origin,
  PEER_HOST: env.VITE_PEER_HOST || window.location.hostname,
  PEER_PORT: Number(env.VITE_PEER_PORT || window.location.port || 80),
  PEER_SECURE: (env.VITE_PEER_SECURE ?? (window.location.protocol === 'https:' ? 'true' : 'false')) === 'true',
  PEER_PATH: env.VITE_PEER_PATH || '/peerjs',
  GATEWAY_URL: env.VITE_GATEWAY_URL || 'http://localhost:4000',
  MUSICMAN_URL: env.VITE_MUSICMAN_URL ?? 'http://localhost:4000',
  GITHUB_URL: env.VITE_GITHUB_URL || 'https://github.com/Dyllaan/mdes-secure-voip',
  TURN_HOST: env.VITE_TURN_HOST || window.location.hostname,
  TURN_PORT: Number(env.VITE_TURN_PORT || 3478),
  TURN_SECURE: (env.VITE_TURN_SECURE ?? 'false') === 'true',
  MAX_MESSAGE_LENGTH: Number(env.VITE_MAX_MESSAGE_LENGTH || 500),
  MIN_HUB_NAME_LENGTH: Number(env.VITE_MIN_HUB_NAME_LENGTH || 1),
  MAX_HUB_NAME_LENGTH: Number(env.VITE_MAX_HUB_NAME_LENGTH || 25),
  MAX_CHANNEL_NAME_LENGTH: Number(env.VITE_MAX_CHANNEL_NAME_LENGTH || 25),
  MIN_CHANNEL_NAME_LENGTH: Number(env.VITE_MIN_CHANNEL_NAME_LENGTH || 1),
  MAX_ROOM_NAME_LENGTH: Number(env.VITE_MAX_ROOM_NAME_LENGTH || 25),
  MIN_ROOM_NAME_LENGTH: Number(env.VITE_MIN_ROOM_NAME_LENGTH || 1),
  MAX_USERNAME_LENGTH: Number(env.VITE_MAX_USERNAME_LENGTH || 25),
  MAX_PASSWORD_LENGTH: Number(env.VITE_MAX_PASSWORD_LENGTH || 100),
  MIN_USERNAME_LENGTH: Number(env.VITE_MIN_USERNAME_LENGTH || 1),
  MIN_PASSWORD_LENGTH: Number(env.VITE_MIN_PASSWORD_LENGTH || 8),
  MAX_ALIAS_LENGTH: Number(env.VITE_MAX_ALIAS_LENGTH || 25),
  MIN_ALIAS_LENGTH: Number(env.VITE_MIN_ALIAS_LENGTH || 1)
};
export default config;
