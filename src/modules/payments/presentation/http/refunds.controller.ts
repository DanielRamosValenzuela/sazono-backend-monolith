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
import { ListPaymentRefundsService } from '../../application/list-payment-refunds.service';
import { RefundPaymentService } from '../../application/refund-payment.service';
import {
  CreateRefundDto,
  type PaymentRefundsResponseDto,
  type RefundResultResponseDto,
} from './dto/refunds.dto';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;

const MAX_IP_LENGTH = 200;

function readRequestMeta(request: Request) {
  const userAgent = request.headers['user-agent'];

  return {
    ip: request.ip?.slice(0, MAX_IP_LENGTH) ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
  };
}

@ApiTags('refunds')
@ApiBearerAuth()
@Controller(
  buildVersionedControllerPath(
    'branches/:branchId/payments/:paymentId/refunds',
  ),
)
export class RefundsController {
  constructor(
    private readonly refundPaymentService: RefundPaymentService,
    private readonly listPaymentRefundsService: ListPaymentRefundsService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Registra un reembolso total o parcial de un pago cobrado. Requiere el header Idempotency-Key.',
  })
  create(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateRefundDto,
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

    return this.refundPaymentService.execute(
      authUser,
      branchId,
      paymentId,
      idempotencyKey,
      dto,
      readRequestMeta(request),
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Estado reembolsable de un pago, elegibilidad del usuario e historial de reembolsos.',
  })
  list(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ): Promise<PaymentRefundsResponseDto> {
    return this.listPaymentRefundsService.execute(
      authUser,
      branchId,
      paymentId,
    );
  }
}
