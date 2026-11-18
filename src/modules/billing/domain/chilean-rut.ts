const RUT_BODY_MIN = 1_000_000;

export function computeRutCheckDigit(body: string): string {
  let sum = 0;
  let factor = 2;

  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }

  const remainder = 11 - (sum % 11);

  if (remainder === 11) {
    return '0';
  }

  return remainder === 10 ? 'K' : String(remainder);
}

export function normalizeRut(raw: string): string | null {
  const cleaned = raw.replace(/[.\s]/g, '').toUpperCase();
  const match = /^(\d{7,8})-?([\dK])$/.exec(cleaned);

  if (!match || Number(match[1]) < RUT_BODY_MIN) {
    return null;
  }

  const [, body, check] = match;

  if (computeRutCheckDigit(body) !== check) {
    return null;
  }

  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${check}`;
}

export function isValidRut(raw: string): boolean {
  return normalizeRut(raw) !== null;
}
