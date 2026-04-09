const req = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

export const config = {
  SIGNALING_URL:   req('SIGNALING_URL'),
  HUB_SERVICE_URL: req('HUB_SERVICE_URL'),
  AUTH_URL:        req('AUTH_URL'),
  GATEWAY_URL:     req('GATEWAY_URL'),
  PEER_HOST:       req('PEER_HOST'),
  PEER_PORT:       parseInt(process.env.PEER_PORT ?? '443'),
  PEER_PATH:       process.env.PEER_PATH  ?? '/peerjs',
  PEER_SECURE:     process.env.PEER_SECURE !== 'false',

  BOT_USERNAME: req('BOT_USERNAME'),
  BOT_PASSWORD: req('BOT_PASSWORD'),
  BOT_SECRET:   req('BOT_SECRET'),

  PORT:                  parseInt(process.env.PORT ?? '4000'),
  PEER_ID_EVENT:         process.env.PEER_ID_EVENT         ?? 'peer-assigned',
  PEER_ID_KEY:           process.env.PEER_ID_KEY           ?? 'peerId',
  SCREEN_PEER_ID_EVENT:  process.env.SCREEN_PEER_ID_EVENT  ?? 'screen-peer-assigned',
  SCREEN_PEER_ID_KEY:    process.env.SCREEN_PEER_ID_KEY    ?? 'peerId',
  TURN_HOST:             process.env.TURN_HOST             ?? 'mdes.sh',
  TURN_PORT:             parseInt(process.env.TURN_PORT    ?? '3478'),
};