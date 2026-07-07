import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { CurrentAuthUser } from '../../../auth/decorators/current-auth-user.decorator';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { ListStationTicketsService } from '../../application/list-station-tickets.service';
import { UpdateStationTicketStatusService } from '../../application/update-station-ticket-status.service';
import {
  ListStationTicketsQueryDto,
  StationTicketResponseDto,
  UpdateStationTicketStatusDto,
} from './dto/kitchen.dto';

@ApiTags('kitchen')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('kitchen'))
export class KitchenController {
  constructor(
    private readonly listStationTicketsService: ListStationTicketsService,
    private readonly updateStationTicketStatusService: UpdateStationTicketStatusService,
  ) {}

  @Get('station-tickets')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Lista los tickets de estacion de una sucursal, filtrables por estacion y estado.',
  })
  listStationTickets(
    @CurrentAuthUser() authUser: JwtPayload,
    @Query() query: ListStationTicketsQueryDto,
  ): Promise<StationTicketResponseDto[]> {
    return this.listStationTicketsService.execute(authUser, query);
  }

  @Post('station-tickets/:stationTicketId/status')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Avanza el estado de un ticket de estacion y sincroniza items y orden.',
  })
  updateStationTicketStatus(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('stationTicketId') stationTicketId: string,
    @Body() dto: UpdateStationTicketStatusDto,
  ): Promise<StationTicketResponseDto> {
    return this.updateStationTicketStatusService.execute(
      authUser,
      stationTicketId,
      dto,
    );
  }
}
