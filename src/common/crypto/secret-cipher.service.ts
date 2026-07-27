import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const CIPHER_ALGORITHM = 'aes-256-gcm';
const CIPHER_FORMAT_VERSION = 'v1';
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

export type SecretCipherContext = {
  provider: string;
  restaurantId: string;
};

export const PAYMENTS_ENCRYPTION_KEY_GENERATION_COMMAND =
  'openssl rand -base64 32';

@Injectable()
export class SecretCipherService {
  private cachedKey?: Buffer;

  constructor(private readonly configService: ConfigService) {}

  encrypt(plainText: string, context: SecretCipherContext): string {
    const key = this.getKey();
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv);
    cipher.setAAD(this.buildAad(context));

    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      CIPHER_FORMAT_VERSION,
      iv.toString('base64url'),
      authTag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  decrypt(cipherText: string, context: SecretCipherContext): string {
    const key = this.getKey();
    const segments = cipherText.split('.');

    if (segments.length !== 4 || segments[0] !== CIPHER_FORMAT_VERSION) {
      throw new Error('Formato de secreto cifrado invalido.');
    }

    const [, ivSegment, tagSegment, ciphertextSegment] = segments;
    const iv = Buffer.from(ivSegment, 'base64url');
    const authTag = Buffer.from(tagSegment, 'base64url');
    const ciphertext = Buffer.from(ciphertextSegment, 'base64url');

    const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv);
    decipher.setAAD(this.buildAad(context));
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  private buildAad(context: SecretCipherContext): Buffer {
    return Buffer.from(`${context.provider}:${context.restaurantId}`, 'utf8');
  }

  private getKey(): Buffer {
    if (this.cachedKey) {
      return this.cachedKey;
    }

    const rawKey = this.configService.get<string>('PAYMENTS_ENCRYPTION_KEY');

    if (!rawKey) {
      throw new Error(
        `PAYMENTS_ENCRYPTION_KEY no esta configurada. Genera una con: ${PAYMENTS_ENCRYPTION_KEY_GENERATION_COMMAND}`,
      );
    }

    const key = Buffer.from(rawKey, 'base64');

    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `PAYMENTS_ENCRYPTION_KEY debe decodificar a ${KEY_LENGTH_BYTES} bytes en base64, se obtuvieron ${key.length}.`,
      );
    }

    this.cachedKey = key;

    return this.cachedKey;
  }
}
