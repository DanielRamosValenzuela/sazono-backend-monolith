import type { ConfigService } from '@nestjs/config';
import { SecretCipherService } from './secret-cipher.service';

describe('SecretCipherService', () => {
  const validKey = Buffer.alloc(32, 7).toString('base64');

  function buildService(key: string | undefined): SecretCipherService {
    const configService = {
      get: jest.fn().mockReturnValue(key),
    } as unknown as ConfigService;

    return new SecretCipherService(configService);
  }

  const context = { provider: 'MERCADO_PAGO', restaurantId: 'restaurant-1' };

  it('round-trips a plain text secret through encrypt and decrypt', () => {
    const service = buildService(validKey);

    const cipherText = service.encrypt('super-secret-token', context);

    expect(cipherText).not.toContain('super-secret-token');
    expect(service.decrypt(cipherText, context)).toBe('super-secret-token');
  });

  it('fails to decrypt when the AAD context does not match', () => {
    const service = buildService(validKey);

    const cipherText = service.encrypt('super-secret-token', context);

    expect(() =>
      service.decrypt(cipherText, {
        provider: 'MERCADO_PAGO',
        restaurantId: 'restaurant-2',
      }),
    ).toThrow();
  });

  it('fails to decrypt when the ciphertext has been tampered with', () => {
    const service = buildService(validKey);

    const cipherText = service.encrypt('super-secret-token', context);
    const segments = cipherText.split('.');
    const tamperedCiphertextSegment =
      segments[3].slice(0, -1) + (segments[3].endsWith('A') ? 'B' : 'A');
    const tamperedCipherText = [
      segments[0],
      segments[1],
      segments[2],
      tamperedCiphertextSegment,
    ].join('.');

    expect(() => service.decrypt(tamperedCipherText, context)).toThrow();
  });

  it('throws a clear error when the encryption key is missing', () => {
    const service = buildService(undefined);

    expect(() => service.encrypt('super-secret-token', context)).toThrow(
      /PAYMENTS_ENCRYPTION_KEY no esta configurada/,
    );
  });

  it('throws a clear error when the encryption key does not decode to 32 bytes', () => {
    const service = buildService(Buffer.alloc(16, 1).toString('base64'));

    expect(() => service.encrypt('super-secret-token', context)).toThrow(
      /debe decodificar a 32 bytes/,
    );
  });
});
