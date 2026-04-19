import { createPublicKey } from 'crypto';

const req = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

const decodeAndValidatePublicKey = (raw: string): string => {
  const pem = Buffer.from(raw, 'base64').toString('utf8');
  try {
    createPublicKey(pem);
    return Buffer.from(pem).toString('base64');
  } catch {
    throw new Error('Invalid JWT_PUBLIC_KEY_B64');
  }
};

export const config = {
  SIGNALING_URL: req('SIGNALING_URL'),
  HUB_SERVICE_URL: req('HUB_SERVICE_URL'),
  AUTH_URL: req('AUTH_URL'),
  GATEWAY_URL: req('GATEWAY_URL'),
  PEER_HOST: req('PEER_HOST'),
  PEER_PORT: parseInt(process.env.PEER_PORT ?? '443'),
  PEER_PATH: process.env.PEER_PATH  ?? '/peerjs',
  PEER_SECURE: process.env.PEER_SECURE !== 'false',

  BOT_USERNAME: req('BOT_USERNAME'),
  BOT_PASSWORD: req('BOT_PASSWORD'),
  BOT_SECRET: req('BOT_SECRET'),
  JWT_PUBLIC_KEY_B64: decodeAndValidatePublicKey(req('JWT_PUBLIC_KEY_B64')),
  JWT_ISSUER: process.env.JWT_ISSUER ?? 'mdes-secure-voip-auth',
  JWT_ACCESS_AUDIENCE: process.env.JWT_ACCESS_AUDIENCE ?? 'voip-services',

  PORT: parseInt(process.env.PORT ?? '4000'),
  PEER_ID_EVENT: process.env.PEER_ID_EVEN ?? 'peer-assigned',
  PEER_ID_KEY: process.env.PEER_ID_KEY ?? 'peerId',
  SCREEN_PEER_ID_EVENT: process.env.SCREEN_PEER_ID_EVENT  ?? 'screen-peer-assigned',
  SCREEN_PEER_ID_KEY: process.env.SCREEN_PEER_ID_KEY ?? 'peerId',
  TURN_HOST: req('TURN_HOST'),
  TURN_PORT: parseInt(process.env.TURN_PORT ?? '3478'),
  TURN_SECURE: process.env.TURN_SECURE === 'true',

  ALLOWED_AUDIO_ORIGINS: process.env.ALLOWED_AUDIO_ORIGINS,
  ALLOWED_VIDEO_ORIGINS: process.env.ALLOWED_VIDEO_ORIGINS,

};
