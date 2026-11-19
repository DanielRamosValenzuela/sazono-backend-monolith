import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Role,
  TaxDocumentStatus,
  TaxProvider,
  TaxProviderAccountStatus,
  TaxProviderEnvironment,
} from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { SecretCipherService } from '../../../common/crypto/secret-cipher.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { normalizeRutForProvider } from '../infrastructure/openfactura/openfactura.mapper';
import type {
  TaxProviderCredentials,
  TaxDocumentProviderPort,
} from './ports/tax-document-provider.port';
import { TAX_DOCUMENT_PROVIDER } from './ports/tax-document-provider.port';
import type { PutTaxProviderDto } from '../presentation/http/dto/tax-documents.dto';
import type { TaxProviderStateDto } from '../presentation/http/dto/tax-documents.dto';

export const TAX_PROVIDER_CIPHER_PROVIDER = 'OPENFACTURA';

type RequestMeta = { ip: string | null; userAgent: string | null };

type FiscalRestaurant = {
  taxId: string | null;
  legalName: string | null;
  businessActivity: string | null;
  legalAddress: string | null;
  legalCommune: string | null;
  economicActivityCode: number | null;
};

export function listMissingFiscalData(restaurant: FiscalRestaurant): string[] {
  const missing: string[] = [];

  if (!restaurant.taxId || !normalizeRutForProvider(restaurant.taxId)) {
    missing.push('taxId');
  }

  if (!restaurant.legalName?.trim()) {
    missing.push('legalName');
  }

  if (!restaurant.businessActivity?.trim()) {
    missing.push('businessActivity');
  }

  if (!restaurant.legalAddress?.trim()) {
    missing.push('legalAddress');
  }

  if (!restaurant.legalCommune?.trim()) {
    missing.push('legalCommune');
  }

  if (!restaurant.economicActivityCode) {
    missing.push('economicActivityCode');
  }

  return missing;
}

@Injectable()
export class TaxProviderAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
    private readonly cipher: SecretCipherService,
    private readonly audit: AuditService,
    @Inject(TAX_DOCUMENT_PROVIDER)
    private readonly provider: TaxDocumentProviderPort,
  ) {}

  async getState(
    authUser: JwtPayload,
    branchId: string,
  ): Promise<TaxProviderStateDto> {
    const context = await this.branchAccess.ensureAccess(authUser, branchId, [
      Role.ADMIN,
    ]);

    return this.buildState(context.restaurantId);
  }

  async put(
    authUser: JwtPayload,
    branchId: string,
    dto: PutTaxProviderDto,
    meta: RequestMeta,
  ): Promise<TaxProviderStateDto> {
    const context = await this.branchAccess.ensureAccess(authUser, branchId, [
      Role.ADMIN,
    ]);
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: context.restaurantId },
      select: {
        taxId: true,
        legalName: true,
        businessActivity: true,
        legalAddress: true,
        legalCommune: true,
        economicActivityCode: true,
      },
    });
    await this.assertNoPendingInOtherEnvironment(
      context.restaurantId,
      dto.environment,
    );

    const apiKey = dto.apiKey.trim();
    const credentials: TaxProviderCredentials = {
      apiKey,
      environment: dto.environment,
    };

    if (dto.environment === TaxProviderEnvironment.PRODUCTION) {
      const missing = listMissingFiscalData(restaurant);

      if (missing.length > 0) {
        throw new BadRequestException({
          message:
            'Completa los datos tributarios del restaurante antes de activar produccion.',
          code: 'TAX_FISCAL_DATA_INCOMPLETE',
          missing,
        });
      }
    }

    const verified = await this.provider.verifyCredentials(credentials);

    if (verified.kind === 'FAILED') {
      if (verified.auth) {
        throw new BadRequestException({
          message: 'El proveedor rechazo la API key.',
          code: 'TAX_PROVIDER_INVALID_API_KEY',
        });
      }

      throw new BadGatewayException({
        message: 'No se pudo verificar la API key con el proveedor.',
        code: 'TAX_PROVIDER_UNAVAILABLE',
      });
    }

    const expectedRut = restaurant.taxId
      ? normalizeRutForProvider(restaurant.taxId)
      : null;

    if (
      dto.environment === TaxProviderEnvironment.PRODUCTION &&
      expectedRut &&
      normalizeRutForProvider(verified.rut) !== expectedRut
    ) {
      throw new BadRequestException({
        message: 'La API key pertenece a otro RUT distinto al del restaurante.',
        code: 'TAX_PROVIDER_RUT_MISMATCH',
      });
    }

    let apiKeyCipher: string;

    try {
      apiKeyCipher = this.cipher.encrypt(apiKey, {
        provider: TAX_PROVIDER_CIPHER_PROVIDER,
        restaurantId: context.restaurantId,
      });
    } catch {
      throw new ServiceUnavailableException(
        'El cifrado de credenciales no esta configurado en este ambiente.',
      );
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const account = await tx.restaurantTaxProviderAccount.upsert({
        where: {
          restaurantId_provider_environment: {
            restaurantId: context.restaurantId,
            provider: TaxProvider.OPENFACTURA,
            environment: dto.environment,
          },
        },
        create: {
          restaurantId: context.restaurantId,
          provider: TaxProvider.OPENFACTURA,
          environment: dto.environment,
          status: TaxProviderAccountStatus.ACTIVE,
          apiKeyCipher,
          lastVerifiedAt: now,
        },
        update: {
          status: TaxProviderAccountStatus.ACTIVE,
          apiKeyCipher,
          lastVerifiedAt: now,
          lastErrorMessage: null,
        },
      });

      await tx.restaurantTaxProviderAccount.updateMany({
        where: {
          restaurantId: context.restaurantId,
          id: { not: account.id },
          status: TaxProviderAccountStatus.ACTIVE,
        },
        data: { status: TaxProviderAccountStatus.DISABLED },
      });

      await this.audit.record(tx, {
        restaurantId: context.restaurantId,
        branchId,
        actorStaffUserId: context.staffUserId,
        actorRole: Role.ADMIN,
        action: 'TAX_PROVIDER_CONNECTED',
        entityType: 'RestaurantTaxProviderAccount',
        entityId: account.id,
        after: {
          provider: TaxProvider.OPENFACTURA,
          environment: dto.environment,
          providerRut: verified.rut,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return this.buildState(context.restaurantId);
  }

  async disconnect(
    authUser: JwtPayload,
    branchId: string,
    meta: RequestMeta,
  ): Promise<TaxProviderStateDto> {
    const context = await this.branchAccess.ensureAccess(authUser, branchId, [
      Role.ADMIN,
    ]);

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.restaurantTaxProviderAccount.updateMany({
        where: {
          restaurantId: context.restaurantId,
          status: TaxProviderAccountStatus.ACTIVE,
        },
        data: { status: TaxProviderAccountStatus.DISABLED },
      });

      if (result.count > 0) {
        await this.audit.record(tx, {
          restaurantId: context.restaurantId,
          branchId,
          actorStaffUserId: context.staffUserId,
          actorRole: Role.ADMIN,
          action: 'TAX_PROVIDER_DISCONNECTED',
          entityType: 'Restaurant',
          entityId: context.restaurantId,
          after: { provider: TaxProvider.OPENFACTURA },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
    });

    return this.buildState(context.restaurantId);
  }

  async resolveCredentials(
    restaurantId: string,
    environment?: TaxProviderEnvironment,
  ): Promise<{
    accountId: string;
    credentials: TaxProviderCredentials;
  } | null> {
    const account = await this.prisma.restaurantTaxProviderAccount.findFirst({
      where: {
        restaurantId,
        provider: TaxProvider.OPENFACTURA,
        status: TaxProviderAccountStatus.ACTIVE,
        ...(environment ? { environment } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!account) {
      return null;
    }

    return {
      accountId: account.id,
      credentials: {
        apiKey: this.cipher.decrypt(account.apiKeyCipher, {
          provider: TAX_PROVIDER_CIPHER_PROVIDER,
          restaurantId,
        }),
        environment: account.environment,
      },
    };
  }

  private async assertNoPendingInOtherEnvironment(
    restaurantId: string,
    target: TaxProviderEnvironment,
  ): Promise<void> {
    const active = await this.prisma.restaurantTaxProviderAccount.findFirst({
      where: {
        restaurantId,
        provider: TaxProvider.OPENFACTURA,
        status: TaxProviderAccountStatus.ACTIVE,
      },
      select: { environment: true },
    });

    if (!active || active.environment === target) {
      return;
    }

    const pending = await this.prisma.taxDocument.count({
      where: {
        restaurantId,
        status: TaxDocumentStatus.PENDING,
        requestSnapshot: { path: ['environment'], equals: active.environment },
      },
    });

    if (pending > 0) {
      throw new ConflictException({
        message: `Hay ${pending} documentos pendientes en ${active.environment}. Resuelvelos antes de cambiar de ambiente.`,
        code: 'TAX_PROVIDER_ENVIRONMENT_HAS_PENDING_DOCUMENTS',
        pendingDocuments: pending,
      });
    }
  }

  async recordFailure(accountId: string, message: string): Promise<void> {
    await this.prisma.restaurantTaxProviderAccount.updateMany({
      where: { id: accountId },
      data: { lastErrorMessage: message.slice(0, 500) },
    });
  }

  private async buildState(restaurantId: string): Promise<TaxProviderStateDto> {
    const [account, restaurant, pendingCount, stuckCount] = await Promise.all([
      this.prisma.restaurantTaxProviderAccount.findFirst({
        where: { restaurantId, provider: TaxProvider.OPENFACTURA },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        select: {
          provider: true,
          status: true,
          environment: true,
          lastVerifiedAt: true,
          lastErrorMessage: true,
        },
      }),
      this.prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
        select: {
          taxId: true,
          legalName: true,
          businessActivity: true,
          legalAddress: true,
          legalCommune: true,
          economicActivityCode: true,
        },
      }),
      this.prisma.taxDocument.count({
        where: { restaurantId, status: TaxDocumentStatus.PENDING },
      }),
      this.prisma.taxDocument.count({
        where: {
          restaurantId,
          status: TaxDocumentStatus.PENDING,
          nextAttemptAt: null,
        },
      }),
    ]);

    return {
      configured: account !== null,
      provider: TaxProvider.OPENFACTURA,
      status: account?.status ?? null,
      environment: account?.environment ?? null,
      apiKeyConfigured: account !== null,
      lastVerifiedAt: account?.lastVerifiedAt?.toISOString() ?? null,
      lastErrorMessage: account?.lastErrorMessage ?? null,
      missingFiscalData: listMissingFiscalData(restaurant),
      pendingDocuments: pendingCount,
      stuckDocuments: stuckCount,
    };
  }
}
