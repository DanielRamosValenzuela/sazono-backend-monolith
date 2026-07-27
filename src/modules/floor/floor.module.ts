import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbandonTableSessionService } from './application/abandon-table-session.service';
import { AssignTableSessionService } from './application/assign-table-session.service';
import { CreateTableService } from './application/create-table.service';
import { CreateTableZoneService } from './application/create-table-zone.service';
import { CloseTableSessionService } from './application/close-table-session.service';
import { DeleteTableZoneService } from './application/delete-table-zone.service';
import { GetCurrentTableSessionService } from './application/get-current-table-session.service';
import { ListBranchStaffService } from './application/list-branch-staff.service';
import { ListTablesService } from './application/list-tables.service';
import { ListTableZonesService } from './application/list-table-zones.service';
import { OpenTableSessionService } from './application/open-table-session.service';
import { RenameTableZoneService } from './application/rename-table-zone.service';
import { SetTableZoneService } from './application/set-table-zone.service';
import { SetZoneStaffService } from './application/set-zone-staff.service';
import { FloorController } from './presentation/http/floor.controller';

@Module({
  imports: [AuthModule],
  controllers: [FloorController],
  providers: [
    CreateTableService,
    ListTablesService,
    OpenTableSessionService,
    GetCurrentTableSessionService,
    CloseTableSessionService,
    AbandonTableSessionService,
    AssignTableSessionService,
    CreateTableZoneService,
    ListTableZonesService,
    RenameTableZoneService,
    DeleteTableZoneService,
    SetTableZoneService,
    SetZoneStaffService,
    ListBranchStaffService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class FloorModule {}
