import { createHash } from 'node:crypto';

export const TRANSBANK_BUY_ORDER_MAX_LENGTH = 26;

const BUY_ORDER_PREFIX = 'sz-';
const BUY_ORDER_HASH_LENGTH =
  TRANSBANK_BUY_ORDER_MAX_LENGTH - BUY_ORDER_PREFIX.length;

export function buildTransbankBuyOrder(attemptId: string): string {
  const hash = createHash('sha256').update(attemptId).digest('hex');

  return `${BUY_ORDER_PREFIX}${hash.slice(0, BUY_ORDER_HASH_LENGTH)}`;
}
