import crypto from 'node:crypto';

export type TokenState = {
  token: string;
  expiresAt: number;
};

export function generateTemporaryToken(ttlMs: number = 5 * 60 * 1000): TokenState {
  const token = crypto.randomBytes(16).toString('hex');
  return { token, expiresAt: Date.now() + ttlMs };
}

export function isTokenValid(state: TokenState, candidate: string | undefined): boolean {
  if (!candidate) return false;
  if (Date.now() > state.expiresAt) return false;
  return timingSafeEqual(state.token, candidate);
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

