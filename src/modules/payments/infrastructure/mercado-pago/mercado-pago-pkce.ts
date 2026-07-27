import { createHash, randomBytes } from 'node:crypto';

const CODE_VERIFIER_LENGTH_BYTES = 64;

export function generateCodeVerifier(): string {
  return randomBytes(CODE_VERIFIER_LENGTH_BYTES).toString('base64url');
}

export function buildCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}
