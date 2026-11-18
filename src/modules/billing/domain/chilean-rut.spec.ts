import { computeRutCheckDigit, isValidRut, normalizeRut } from './chilean-rut';

describe('chilean RUT', () => {
  it('computes the modulo 11 check digit', () => {
    expect(computeRutCheckDigit('12345678')).toBe('5');
    expect(computeRutCheckDigit('76086428')).toBe('5');
    expect(computeRutCheckDigit('11111111')).toBe('1');
    expect(computeRutCheckDigit('10000013')).toBe('K');
    expect(computeRutCheckDigit('7000004')).toBe('0');
  });

  it('normalises to dotted format with dash', () => {
    expect(normalizeRut('12345678-5')).toBe('12.345.678-5');
    expect(normalizeRut('123456785')).toBe('12.345.678-5');
    expect(normalizeRut(' 12.345.678-5 ')).toBe('12.345.678-5');
    expect(normalizeRut('10.000.013-k')).toBe('10.000.013-K');
  });

  it('rejects wrong check digits and malformed values', () => {
    expect(isValidRut('12.345.678-9')).toBe(false);
    expect(isValidRut('abc')).toBe(false);
    expect(isValidRut('')).toBe(false);
    expect(isValidRut('123-4')).toBe(false);
    expect(isValidRut('1234567890-1')).toBe(false);
  });
});
