import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
import { AbandonTableSessionService } from '../../application/abandon-table-session.service';
import { AssignTableSessionService } from '../../application/assign-table-session.service';
import { CreateTableService } from '../../application/create-table.service';
import { CreateTableZoneService } from '../../application/create-table-zone.service';
import { CloseTableSessionService } from '../../application/close-table-session.service';
import { DeleteTableZoneService } from '../../application/delete-table-zone.service';
import { GetCurrentTableSessionService } from '../../application/get-current-table-session.service';
import { ListBranchStaffService } from '../../application/list-branch-staff.service';
import { ListTablesService } from '../../application/list-tables.service';
import { ListTableZonesService } from '../../application/list-table-zones.service';
import { OpenTableSessionService } from '../../application/open-table-session.service';
import { RenameTableZoneService } from '../../application/rename-table-zone.service';
import { SetTableZoneService } from '../../application/set-table-zone.service';
import { SetZoneStaffService } from '../../application/set-zone-staff.service';
import {
  AbandonTableSessionDto,
  AssignTableSessionDto,
  BranchStaffMemberResponseDto,
  CloseTableSessionDto,
  CreateTableDto,
  CreateTableZoneDto,
  ListTablesQueryDto,
  OpenTableSessionDto,
  RenameTableZoneDto,
  SetTableZoneDto,
  SetZoneStaffDto,
  TableResponseDto,
  TableSessionResponseDto,
  TableZoneResponseDto,
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
    private readonly closeTableSessionService: CloseTableSessionService,
    private readonly abandonTableSessionService: AbandonTableSessionService,
    private readonly assignTableSessionService: AssignTableSessionService,
    private readonly createTableZoneService: CreateTableZoneService,
    private readonly listTableZonesService: ListTableZonesService,
    private readonly renameTableZoneService: RenameTableZoneService,
    private readonly deleteTableZoneService: DeleteTableZoneService,
    private readonly setTableZoneService: SetTableZoneService,
    private readonly setZoneStaffService: SetZoneStaffService,
    private readonly listBranchStaffService: ListBranchStaffService,
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

  @Post('table-sessions/:tableSessionId/close')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Cierra manualmente una mesa cuando la cuenta activa ya no tiene saldo pendiente.',
  })
  closeTableSession(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('tableSessionId') tableSessionId: string,
    @Body() dto: CloseTableSessionDto,
  ): Promise<TableSessionResponseDto> {
    return this.closeTableSessionService.execute(authUser, tableSessionId, dto);
  }

  @Post('table-sessions/:tableSessionId/abandon')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Marca una sesion como abandonada por deuda o retiro sin pago. Solo caja, supervisor o admin.',
  })
  abandonTableSession(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('tableSessionId') tableSessionId: string,
    @Body() dto: AbandonTableSessionDto,
  ): Promise<TableSessionResponseDto> {
    return this.abandonTableSessionService.execute(
      authUser,
      tableSessionId,
      dto,
    );
  }

  @Post('table-sessions/:tableSessionId/assign')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Asigna o reasigna la mesa a un miembro del staff. Requiere la asignacion formal activada en la sucursal. Mesero/cajero solo pueden autoasignarse; admin/supervisor puede asignar a cualquiera.',
  })
  assignTableSession(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('tableSessionId') tableSessionId: string,
    @Body() dto: AssignTableSessionDto,
  ): Promise<TableSessionResponseDto> {
    return this.assignTableSessionService.execute(
      authUser,
      tableSessionId,
      dto,
    );
  }

  @Get('zones')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Lista las zonas de mesas de una sucursal.',
  })
  listTableZones(
    @CurrentAuthUser() authUser: JwtPayload,
    @Query() query: ListTablesQueryDto,
  ): Promise<TableZoneResponseDto[]> {
    return this.listTableZonesService.execute(authUser, query);
  }

  @Post('zones')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Crea una zona de mesas dentro de una sucursal.',
  })
  createTableZone(
    @CurrentAuthUser() authUser: JwtPayload,
    @Body() dto: CreateTableZoneDto,
  ): Promise<TableZoneResponseDto> {
    return this.createTableZoneService.execute(authUser, dto);
  }

  @Patch('zones/:zoneId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Renombra una zona de mesas existente.',
  })
  renameTableZone(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('zoneId') zoneId: string,
    @Body() dto: RenameTableZoneDto,
  ): Promise<TableZoneResponseDto> {
    return this.renameTableZoneService.execute(authUser, zoneId, dto);
  }

  @Delete('zones/:zoneId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Elimina una zona de mesas.',
  })
  deleteTableZone(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('zoneId') zoneId: string,
  ): Promise<void> {
    return this.deleteTableZoneService.execute(authUser, zoneId);
  }

  @Patch('tables/:tableId/zone')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Asigna o quita la zona de una mesa.',
  })
  setTableZone(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('tableId') tableId: string,
    @Body() dto: SetTableZoneDto,
  ): Promise<TableResponseDto> {
    return this.setTableZoneService.execute(authUser, tableId, dto);
  }

  @Put('zones/:zoneId/staff')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Reemplaza el equipo asignado a una zona de mesas.',
  })
  setZoneStaff(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('zoneId') zoneId: string,
    @Body() dto: SetZoneStaffDto,
  ): Promise<TableZoneResponseDto> {
    return this.setZoneStaffService.execute(authUser, zoneId, dto);
  }

  @Get('branch-staff')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Lista el equipo con rol operativo activo en una sucursal, para gestionar zonas.',
  })
  listBranchStaff(
    @CurrentAuthUser() authUser: JwtPayload,
    @Query() query: ListTablesQueryDto,
  ): Promise<BranchStaffMemberResponseDto[]> {
    return this.listBranchStaffService.execute(authUser, query);
  }
}
