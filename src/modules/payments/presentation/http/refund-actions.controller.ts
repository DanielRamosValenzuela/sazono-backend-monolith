import {
  Controller,
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
import { ManageGatewayRefundService } from '../../application/manage-gateway-refund.service';
import type { RefundResultResponseDto } from './dto/refunds.dto';

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
@Controller(buildVersionedControllerPath('refunds'))
export class RefundActionsController {
  constructor(
    private readonly manageGatewayRefundService: ManageGatewayRefundService,
  ) {}

  @Post(':refundId/retry')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Reintenta un reembolso de pasarela fallido o sin resolver. Solo ADMIN.',
  })
  retry(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('refundId', ParseUUIDPipe) refundId: string,
    @Req() request: Request,
  ): Promise<RefundResultResponseDto> {
    return this.manageGatewayRefundService.retry(
      authUser,
      refundId,
      readRequestMeta(request),
    );
  }

  @Post(':refundId/mark-manual')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Convierte un reembolso de pasarela fallido o sin resolver en un reembolso manual externo exitoso. Solo ADMIN.',
  })
  markManual(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('refundId', ParseUUIDPipe) refundId: string,
    @Req() request: Request,
  ): Promise<RefundResultResponseDto> {
    return this.manageGatewayRefundService.markManual(
      authUser,
      refundId,
      readRequestMeta(request),
    );
  }
}
