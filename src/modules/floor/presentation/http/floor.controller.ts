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
import { CreateTableService } from '../../application/create-table.service';
import { GetCurrentTableSessionService } from '../../application/get-current-table-session.service';
import { ListTablesService } from '../../application/list-tables.service';
import { OpenTableSessionService } from '../../application/open-table-session.service';
import {
  CreateTableDto,
  ListTablesQueryDto,
  OpenTableSessionDto,
  TableResponseDto,
  TableSessionResponseDto,
} from './dto/floor.dto';

@ApiTags('floor')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('floor'))
export class FloorController {
  constructor(
    private readonly createTableService: CreateTableService,
    private readonly listTablesService: ListTablesService,
    private readonly openTableSessionService: OpenTableSessionService,
    private readonly getCurrentTableSessionService: GetCurrentTableSessionService,
  ) {}

  @Post('tables')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Crea una mesa operativa dentro de una sucursal.',
  })
  createTable(
    @CurrentAuthUser() authUser: JwtPayload,
    @Body() dto: CreateTableDto,
  ): Promise<TableResponseDto> {
    return this.createTableService.execute(authUser, dto);
  }

  @Get('tables')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Lista las mesas de una sucursal junto a la sesion activa, si existe.',
  })
  listTables(
    @CurrentAuthUser() authUser: JwtPayload,
    @Query() query: ListTablesQueryDto,
  ): Promise<TableResponseDto[]> {
    return this.listTablesService.execute(authUser, query);
  }

  @Post('table-sessions/open')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Abre una nueva TableSession manual para una mesa.',
  })
  openTableSession(
    @CurrentAuthUser() authUser: JwtPayload,
    @Body() dto: OpenTableSessionDto,
  ): Promise<TableSessionResponseDto> {
    return this.openTableSessionService.execute(authUser, dto);
  }

  @Get('tables/:tableId/current-session')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Retorna la sesion activa actual de una mesa para retomar operacion.',
  })
  getCurrentTableSession(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('tableId') tableId: string,
  ): Promise<TableSessionResponseDto> {
    return this.getCurrentTableSessionService.execute(authUser, tableId);
  }
}
