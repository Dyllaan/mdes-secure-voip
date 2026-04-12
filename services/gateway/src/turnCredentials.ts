import { createHmac, randomBytes } from 'crypto';
import { type Request, type Response } from 'express';
import { config } from './config';

export function turnCredentials(req: Request, res: Response) {
  const ttl = 3600;
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const nonce = randomBytes(8).toString('hex');
  const username = `${timestamp}:${nonce}:${req.user.sub}`;
  const password = createHmac('sha1', config.TURN_SECRET).update(username).digest('base64');

  res.json({ username, password, ttl });
}