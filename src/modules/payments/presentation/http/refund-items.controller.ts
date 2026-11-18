import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { CurrentAuthUser } from '../../../auth/decorators/current-auth-user.decorator';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { RefundItemsService } from '../../application/refund-items.service';
import {
  CreateRefundItemsDto,
  PreviewRefundItemsDto,
  type BillRefundableItemDto,
  type RefundItemsPreviewResponseDto,
  type RefundResultResponseDto,
} from './dto/refunds.dto';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
const MAX_IP_LENGTH = 200;

@ApiTags('refunds')
@ApiBearerAuth()
@Controller(
  buildVersionedControllerPath('branches/:branchId/bills/:billId/refunds'),
)
@UseGuards(JwtAuthGuard, ProfileTypeGuard)
@RequireProfileType(LoginProfileType.STAFF)
export class RefundItemsController {
  constructor(private readonly refundItemsService: RefundItemsService) {}

  @Get('items')
  @ApiOperation({
    summary:
      'Lineas de la cuenta con cantidad y monto reembolsable por producto.',
  })
  list(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('billId', ParseUUIDPipe) billId: string,
  ): Promise<{ billId: string; items: BillRefundableItemDto[] }> {
    return this.refundItemsService.list(authUser, branchId, billId);
  }

  @Post('items/preview')
  @ApiOperation({
    summary:
      'Calcula el monto de un reembolso por producto sin registrarlo (neto de descuentos).',
  })
  preview(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body() dto: PreviewRefundItemsDto,
  ): Promise<RefundItemsPreviewResponseDto> {
    return this.refundItemsService.preview(authUser, branchId, billId, dto);
  }

  @Post('items')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Registra un reembolso por producto de un pago. El monto lo calcula el servidor. Requiere Idempotency-Key.',
  })
  create(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateRefundItemsDto,
    @Req() request: Request,
  ): Promise<RefundResultResponseDto> {
    if (!idempotencyKey) {
      throw new BadRequestException({
        message: 'Falta el header Idempotency-Key.',
        code: 'REFUND_IDEMPOTENCY_KEY_REQUIRED',
      });
    }

    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException({
        message:
          'Idempotency-Key debe tener entre 8 y 100 caracteres: letras, numeros, punto, guion, guion bajo o dos puntos.',
        code: 'REFUND_IDEMPOTENCY_KEY_INVALID',
      });
    }

    const userAgent = request.headers['user-agent'];

    return this.refundItemsService.execute(
      authUser,
      branchId,
      billId,
      idempotencyKey,
      dto,
      {
        ip: request.ip?.slice(0, MAX_IP_LENGTH) ?? null,
        userAgent: typeof userAgent === 'string' ? userAgent : null,
      },
    );
  }
}
