import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import { CashMovementsService } from '../../application/cash-movements.service';
import {
  CashSessionsService,
  type CashRequestMeta,
} from '../../application/cash-sessions.service';
import {
  CloseCashSessionDto,
  CreateCashAdjustmentDto,
  CreateCashMovementDto,
  ListCashMovementsQueryDto,
  ListCashSessionsQueryDto,
  OpenCashSessionDto,
} from './dto/cash.dto';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;

function readMeta(request: Request): CashRequestMeta {
  const userAgent = request.headers['user-agent'];

  return {
    ip: request.ip?.slice(0, 200) ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
  };
}

function requireKey(key: string | undefined): string {
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new BadRequestException({
      message:
        'Falta el header Idempotency-Key (8 a 100 caracteres: letras, numeros, punto, guion, guion bajo o dos puntos).',
      code: 'CASH_IDEMPOTENCY_KEY_INVALID',
    });
  }

  return key;
}

@ApiTags('cash')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfileTypeGuard)
@RequireProfileType(LoginProfileType.STAFF)
@Controller(buildVersionedControllerPath('branches/:branchId'))
export class CashController {
  constructor(
    private readonly sessions: CashSessionsService,
    private readonly movements: CashMovementsService,
  ) {}

  @Post('cash-sessions/open')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Abre una sesion de caja con fondo inicial.' })
  open(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: OpenCashSessionDto,
    @Req() request: Request,
  ) {
    return this.sessions.open(authUser, branchId, dto, readMeta(request));
  }

  @Get('cash-sessions/current')
  @ApiOperation({
    summary: 'Sesion abierta del usuario con el esperado en vivo.',
  })
  current(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.sessions.current(authUser, branchId);
  }

  @Get('cash-sessions')
  @ApiOperation({
    summary:
      'Lista sesiones de caja. ADMIN y SUPERVISOR ven todas; CASHIER solo las propias.',
  })
  list(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListCashSessionsQueryDto,
  ) {
    return this.sessions.list(authUser, branchId, query);
  }

  @Get('cash-sessions/:id')
  @ApiOperation({ summary: 'Detalle de una sesion con pagos y movimientos.' })
  detail(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sessions.detail(authUser, branchId, id);
  }

  @Post('cash-sessions/:id/close')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cierra la sesion con el efectivo contado.' })
  close(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseCashSessionDto,
    @Req() request: Request,
  ) {
    return this.sessions.close(authUser, branchId, id, dto, readMeta(request));
  }

  @Post('cash-sessions/:id/force-close')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Cierre forzado de una sesion ajena u olvidada. Solo ADMIN y SUPERVISOR, con motivo.',
  })
  forceClose(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseCashSessionDto,
    @Req() request: Request,
  ) {
    return this.sessions.forceClose(
      authUser,
      branchId,
      id,
      dto,
      readMeta(request),
    );
  }

  @Post('cash-movements')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Registra un ingreso (CASH_IN) o egreso (CASH_OUT) manual de efectivo. Requiere Idempotency-Key.',
  })
  createMovement(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: CreateCashMovementDto,
    @Req() request: Request,
  ) {
    return this.movements.create(
      authUser,
      branchId,
      requireKey(key),
      dto,
      readMeta(request),
    );
  }

  @Post('cash-movements/adjustments')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Ajuste de caja con signo (solo ADMIN). Requiere Idempotency-Key.',
  })
  createAdjustment(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: CreateCashAdjustmentDto,
    @Req() request: Request,
  ) {
    return this.movements.createAdjustment(
      authUser,
      branchId,
      requireKey(key),
      dto,
      readMeta(request),
    );
  }

  @Get('cash-movements')
  @ApiOperation({
    summary:
      'Lista movimientos de efectivo. ADMIN y SUPERVISOR ven todos; CASHIER solo los propios.',
  })
  listMovements(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListCashMovementsQueryDto,
  ) {
    return this.movements.list(authUser, branchId, query);
  }
}
