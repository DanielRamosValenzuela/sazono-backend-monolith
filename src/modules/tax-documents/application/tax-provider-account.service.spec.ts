import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Role, TaxProviderEnvironment } from '@prisma/client';
import type { AuditService } from '../../../common/audit/audit.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { SecretCipherService } from '../../../common/crypto/secret-cipher.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type {
  TaxDocumentProviderPort,
  VerifyOutcome,
} from './ports/tax-document-provider.port';
import {
  TaxProviderAccountService,
  listMissingFiscalData,
} from './tax-provider-account.service';

const authUser = { profileId: 'staff-1' } as unknown as JwtPayload;
const meta = { ip: null, userAgent: null };
const API_KEY = 'super-secret-api-key';

const completeRestaurant = {
  taxId: '76.795.561-8',
  legalName: 'Demo SpA',
  businessActivity: 'Restaurantes',
  legalAddress: 'Calle 1',
  legalCommune: 'Santiago',
  economicActivityCode: 561000,
};

function build(
  options: {
    verify?: VerifyOutcome;
    restaurant?: Record<string, unknown>;
    forbidden?: boolean;
    encryptThrows?: boolean;
    stored?: Record<string, unknown> | null;
    pendingOld?: number;
  } = {},
) {
  const tx = {
    restaurantTaxProviderAccount: {
      upsert: jest.fn().mockResolvedValue({ id: 'acc-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    restaurant: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ ...completeRestaurant, ...options.restaurant }),
    },
    restaurantTaxProviderAccount: {
      findFirst: jest.fn().mockResolvedValue(
        options.stored === undefined
          ? {
              id: 'acc-1',
              provider: 'OPENFACTURA',
              status: 'ACTIVE',
              environment: 'SANDBOX',
              lastVerifiedAt: new Date('2026-11-19T12:00:00Z'),
              lastErrorMessage: null,
              apiKeyCipher: 'v1.cipher.stored.value',
            }
          : options.stored,
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    taxDocument: {
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(where.requestSnapshot ? (options.pendingOld ?? 0) : 2),
      ),
    },
    $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) =>
      cb(tx),
    ),
  };
  const branchAccess = {
    ensureAccess: jest.fn(() =>
      options.forbidden
        ? Promise.reject(new ForbiddenException('no'))
        : Promise.resolve({ staffUserId: 'staff-1', restaurantId: 'rest-1' }),
    ),
  };
  const cipher = {
    encrypt: jest.fn(() => {
      if (options.encryptThrows) {
        throw new Error('PAYMENTS_ENCRYPTION_KEY no esta configurada');
      }

      return 'v1.cipher.text.value';
    }),
    decrypt: jest.fn().mockReturnValue(API_KEY),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const provider = {
    verifyCredentials: jest.fn().mockResolvedValue(
      options.verify ?? {
        kind: 'VERIFIED',
        rut: '76795561-8',
        legalName: 'Demo',
        foliosAvailable: {},
      },
    ),
  };
  const service = new TaxProviderAccountService(
    prisma as unknown as PrismaService,
    branchAccess as unknown as BranchAccessService,
    cipher as unknown as SecretCipherService,
    audit as unknown as AuditService,
    provider as unknown as TaxDocumentProviderPort,
  );

  return { service, prisma, tx, branchAccess, cipher, audit, provider };
}

describe('TaxProviderAccountService.put', () => {
  it('verifies the key, stores it encrypted, disables other accounts and audits without secrets', async () => {
    const ctx = build();

    const state = await ctx.service.put(
      authUser,
      'br-1',
      { apiKey: API_KEY, environment: TaxProviderEnvironment.PRODUCTION },
      meta,
    );

    expect(ctx.branchAccess.ensureAccess).toHaveBeenCalledWith(
      authUser,
      'br-1',
      [Role.ADMIN],
    );
    expect(ctx.provider.verifyCredentials).toHaveBeenCalledWith({
      apiKey: API_KEY,
      environment: 'PRODUCTION',
    });
    expect(ctx.cipher.encrypt).toHaveBeenCalledWith(API_KEY, {
      provider: 'OPENFACTURA',
      restaurantId: 'rest-1',
    });
    const upsert = ctx.tx.restaurantTaxProviderAccount.upsert.mock
      .calls[0][0] as { create: Record<string, unknown> };
    expect(upsert.create.apiKeyCipher).toBe('v1.cipher.text.value');
    expect(upsert.create.status).toBe('ACTIVE');
    expect(ctx.tx.restaurantTaxProviderAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'DISABLED' },
        where: expect.objectContaining({ id: { not: 'acc-1' } }),
      }),
    );
    expect(JSON.stringify(ctx.audit.record.mock.calls)).not.toContain(API_KEY);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      ctx.tx,
      expect.objectContaining({ action: 'TAX_PROVIDER_CONNECTED' }),
    );
    expect(JSON.stringify(state)).not.toContain(API_KEY);
    expect(JSON.stringify(state)).not.toContain('cipher');
    expect(state).toMatchObject({
      configured: true,
      status: 'ACTIVE',
      apiKeyConfigured: true,
      pendingDocuments: 2,
      stuckDocuments: 2,
      missingFiscalData: [],
    });
  });

  it('refuses switching environment while documents of the old one are PENDING', async () => {
    const ctx = build({ pendingOld: 3 });

    await expect(
      ctx.service.put(
        authUser,
        'br-1',
        { apiKey: API_KEY, environment: TaxProviderEnvironment.PRODUCTION },
        meta,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.prisma.taxDocument.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: 'PENDING',
        requestSnapshot: { path: ['environment'], equals: 'SANDBOX' },
      }),
    });
    expect(ctx.provider.verifyCredentials).not.toHaveBeenCalled();
  });

  it('answers 400 when the provider rejects the key and never stores it', async () => {
    const ctx = build({
      verify: {
        kind: 'FAILED',
        retryable: true,
        code: 'AUTH',
        message: 'x',
        auth: true,
        retryAfterMs: null,
      },
    });

    await expect(
      ctx.service.put(
        authUser,
        'br-1',
        { apiKey: API_KEY, environment: TaxProviderEnvironment.SANDBOX },
        meta,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.cipher.encrypt).not.toHaveBeenCalled();
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('answers 502 when the provider is unreachable', async () => {
    const ctx = build({
      verify: {
        kind: 'FAILED',
        retryable: true,
        code: 'NETWORK',
        message: 'x',
        auth: false,
        retryAfterMs: null,
      },
    });

    await expect(
      ctx.service.put(
        authUser,
        'br-1',
        { apiKey: API_KEY, environment: TaxProviderEnvironment.SANDBOX },
        meta,
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('refuses a production key that belongs to another rut', async () => {
    const ctx = build({
      verify: {
        kind: 'VERIFIED',
        rut: '11111111-1',
        legalName: null,
        foliosAvailable: {},
      },
    });

    await expect(
      ctx.service.put(
        authUser,
        'br-1',
        { apiKey: API_KEY, environment: TaxProviderEnvironment.PRODUCTION },
        meta,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TAX_PROVIDER_RUT_MISMATCH' }),
    });
  });

  it('accepts the demo organization in sandbox even with a different rut', async () => {
    const ctx = build({
      verify: {
        kind: 'VERIFIED',
        rut: '11111111-1',
        legalName: null,
        foliosAvailable: {},
      },
    });

    await expect(
      ctx.service.put(
        authUser,
        'br-1',
        { apiKey: API_KEY, environment: TaxProviderEnvironment.SANDBOX },
        meta,
      ),
    ).resolves.toBeDefined();
  });

  it('requires complete fiscal data for production and lists what is missing', async () => {
    const ctx = build({
      restaurant: { legalAddress: null, economicActivityCode: null },
    });

    await expect(
      ctx.service.put(
        authUser,
        'br-1',
        { apiKey: API_KEY, environment: TaxProviderEnvironment.PRODUCTION },
        meta,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'TAX_FISCAL_DATA_INCOMPLETE',
        missing: ['legalAddress', 'economicActivityCode'],
      }),
    });
    expect(ctx.provider.verifyCredentials).not.toHaveBeenCalled();
  });

  it('answers 503 when the encryption key is not configured', async () => {
    const ctx = build({ encryptThrows: true });

    await expect(
      ctx.service.put(
        authUser,
        'br-1',
        { apiKey: API_KEY, environment: TaxProviderEnvironment.SANDBOX },
        meta,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects non admins before touching anything', async () => {
    const ctx = build({ forbidden: true });

    await expect(
      ctx.service.put(
        authUser,
        'br-1',
        { apiKey: API_KEY, environment: TaxProviderEnvironment.SANDBOX },
        meta,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.provider.verifyCredentials).not.toHaveBeenCalled();
  });
});

describe('TaxProviderAccountService.getState and disconnect', () => {
  it('returns the masked state, never the key', async () => {
    const ctx = build();

    const state = await ctx.service.getState(authUser, 'br-1');

    expect(state.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(state)).not.toMatch(/cipher|apiKey"/);
    expect(ctx.branchAccess.ensureAccess).toHaveBeenCalledWith(
      authUser,
      'br-1',
      [Role.ADMIN],
    );
  });

  it('reports an unconfigured restaurant', async () => {
    const ctx = build({ stored: null });

    await expect(ctx.service.getState(authUser, 'br-1')).resolves.toMatchObject(
      { configured: false, status: null, environment: null },
    );
  });

  it('disables the active account and audits', async () => {
    const ctx = build();

    await ctx.service.disconnect(authUser, 'br-1', meta);

    expect(ctx.tx.restaurantTaxProviderAccount.updateMany).toHaveBeenCalledWith(
      {
        where: { restaurantId: 'rest-1', status: 'ACTIVE' },
        data: { status: 'DISABLED' },
      },
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      ctx.tx,
      expect.objectContaining({ action: 'TAX_PROVIDER_DISCONNECTED' }),
    );
  });

  it('does not audit a disconnect that changed nothing', async () => {
    const ctx = build();
    ctx.tx.restaurantTaxProviderAccount.updateMany.mockResolvedValue({
      count: 0,
    });

    await ctx.service.disconnect(authUser, 'br-1', meta);

    expect(ctx.audit.record).not.toHaveBeenCalled();
  });
});

describe('TaxProviderAccountService.resolveCredentials', () => {
  it('decrypts the key with the restaurant context', async () => {
    const ctx = build();

    await expect(ctx.service.resolveCredentials('rest-1')).resolves.toEqual({
      accountId: 'acc-1',
      credentials: { apiKey: API_KEY, environment: 'SANDBOX' },
    });
    expect(ctx.cipher.decrypt).toHaveBeenCalledWith('v1.cipher.stored.value', {
      provider: 'OPENFACTURA',
      restaurantId: 'rest-1',
    });
  });

  it('returns null without an active account', async () => {
    const ctx = build({ stored: null });

    await expect(ctx.service.resolveCredentials('rest-1')).resolves.toBeNull();
  });
});

describe('listMissingFiscalData', () => {
  it('flags a missing or malformed rut', () => {
    expect(
      listMissingFiscalData({ ...completeRestaurant, taxId: 'abc' }),
    ).toEqual(['taxId']);
    expect(listMissingFiscalData(completeRestaurant)).toEqual([]);
  });
});
