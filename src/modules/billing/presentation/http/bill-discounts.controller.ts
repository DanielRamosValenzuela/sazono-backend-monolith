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
import { ApplyBillDiscountService } from '../../application/apply-bill-discount.service';
import {
  ListBillDiscountsService,
  VoidBillDiscountService,
} from '../../application/void-bill-discount.service';
import {
  CreateBillDiscountDto,
  VoidBillDiscountDto,
  type BillDiscountListDto,
  type BillDiscountResultDto,
  type DiscountPreviewDto,
  type VoidBillDiscountResultDto,
} from './dto/discounts.dto';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
const MAX_IP_LENGTH = 200;

function readRequestMeta(request: Request) {
  const userAgent = request.headers['user-agent'];

  return {
    ip: request.ip?.slice(0, MAX_IP_LENGTH) ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
  };
}

@ApiTags('discounts')
@ApiBearerAuth()
@Controller(
  buildVersionedControllerPath('branches/:branchId/bills/:billId/discounts'),
)
export class BillDiscountsController {
  constructor(
    private readonly applyBillDiscountService: ApplyBillDiscountService,
    private readonly voidBillDiscountService: VoidBillDiscountService,
    private readonly listBillDiscountsService: ListBillDiscountsService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Aplica un descuento a la cuenta o a una linea. Requiere el header Idempotency-Key.',
  })
  create(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateBillDiscountDto,
    @Req() request: Request,
  ): Promise<BillDiscountResultDto> {
    if (!idempotencyKey) {
      throw new BadRequestException({
        message: 'Falta el header Idempotency-Key.',
        code: 'DISCOUNT_IDEMPOTENCY_KEY_REQUIRED',
      });
    }

    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException({
        message:
          'La Idempotency-Key debe tener entre 8 y 100 caracteres (letras, numeros, . _ : -).',
        code: 'DISCOUNT_IDEMPOTENCY_KEY_INVALID',
      });
    }

    return this.applyBillDiscountService.execute(
      authUser,
      branchId,
      billId,
      idempotencyKey,
      dto,
      readRequestMeta(request),
    );
  }

  @Post('preview')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({ summary: 'Calcula un descuento sin guardarlo.' })
  preview(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body() dto: CreateBillDiscountDto,
  ): Promise<DiscountPreviewDto> {
    return this.applyBillDiscountService.preview(
      authUser,
      branchId,
      billId,
      dto,
    );
  }

  @Post(':discountId/void')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({ summary: 'Anula un descuento activo con motivo.' })
  void(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Param('discountId', ParseUUIDPipe) discountId: string,
    @Body() dto: VoidBillDiscountDto,
    @Req() request: Request,
  ): Promise<VoidBillDiscountResultDto> {
    return this.voidBillDiscountService.execute(
      authUser,
      branchId,
      billId,
      discountId,
      dto,
      readRequestMeta(request),
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Lista los descuentos de la cuenta, anulados incluidos.',
  })
  list(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('billId', ParseUUIDPipe) billId: string,
  ): Promise<BillDiscountListDto> {
    return this.listBillDiscountsService.execute(authUser, branchId, billId);
  }
}
