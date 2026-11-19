import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { API_V1_PREFIX } from '../../../../common/http/api-version';
import { CurrentAuthUser } from '../../../auth/decorators/current-auth-user.decorator';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { TaxDocumentsService } from '../../application/tax-documents.service';
import { TaxProviderAccountService } from '../../application/tax-provider-account.service';
import {
  ListTaxDocumentsQueryDto,
  PutTaxProviderDto,
  type TaxDocumentResponseDto,
  type TaxProviderStateDto,
} from './dto/tax-documents.dto';

const MAX_IP_LENGTH = 200;

function readRequestMeta(request: Request) {
  const userAgent = request.headers['user-agent'];

  return {
    ip: request.ip?.slice(0, MAX_IP_LENGTH) ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
  };
}

@ApiTags('tax-documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfileTypeGuard)
@RequireProfileType(LoginProfileType.STAFF)
@Controller(API_V1_PREFIX)
export class TaxDocumentsController {
  constructor(
    private readonly accounts: TaxProviderAccountService,
    private readonly documents: TaxDocumentsService,
  ) {}

  @Get('branches/:branchId/tax-provider')
  @ApiOperation({
    summary:
      'Estado del proveedor de documentos tributarios del restaurante (sin la API key). Requiere ADMIN.',
  })
  getProvider(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ): Promise<TaxProviderStateDto> {
    return this.accounts.getState(authUser, branchId);
  }

  @Put('branches/:branchId/tax-provider')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Guarda la API key cifrada y el ambiente, la verifica con el proveedor y devuelve el estado enmascarado. Requiere ADMIN.',
  })
  putProvider(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: PutTaxProviderDto,
    @Req() request: Request,
  ): Promise<TaxProviderStateDto> {
    return this.accounts.put(authUser, branchId, dto, readRequestMeta(request));
  }

  @Delete('branches/:branchId/tax-provider')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Desactiva el proveedor tributario del restaurante. Requiere ADMIN.',
  })
  disconnectProvider(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Req() request: Request,
  ): Promise<TaxProviderStateDto> {
    return this.accounts.disconnect(
      authUser,
      branchId,
      readRequestMeta(request),
    );
  }

  @Get('branches/:branchId/tax-documents')
  @ApiOperation({
    summary:
      'Lista los documentos tributarios de la sucursal, filtrables por cuenta y estado.',
  })
  list(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListTaxDocumentsQueryDto,
  ): Promise<TaxDocumentResponseDto[]> {
    return this.documents.list(authUser, branchId, query);
  }

  @Get('branches/:branchId/bills/:billId/tax-documents')
  @ApiOperation({
    summary:
      'Documentos tributarios de una cuenta: estado, folio, PDF y errores.',
  })
  listForBill(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('billId', ParseUUIDPipe) billId: string,
  ): Promise<TaxDocumentResponseDto[]> {
    return this.documents.listForBill(authUser, branchId, billId);
  }

  @Post('tax-documents/:id/retry')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Reintenta manualmente un documento que agoto sus intentos o fue rechazado sin emitirse. Requiere ADMIN.',
  })
  retry(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<TaxDocumentResponseDto> {
    return this.documents.retry(authUser, id, readRequestMeta(request));
  }

  @Post('tax-documents/:id/reissue')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Anula una boleta rechazada o en revision manual y encola una nueva con otra clave de idempotencia. Requiere ADMIN.',
  })
  reissue(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<TaxDocumentResponseDto> {
    return this.documents.reissue(authUser, id, readRequestMeta(request));
  }

  @Get('tax-documents/:id/pdf')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Content-Type', 'application/pdf')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Descarga el PDF del documento emitido, obtenido del proveedor.',
  })
  async pdf(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { data, fileName } = await this.documents.getPdf(authUser, id);

    return new StreamableFile(data, {
      type: 'application/pdf',
      disposition: `inline; filename="${fileName}"`,
    });
  }
}
