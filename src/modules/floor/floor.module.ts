import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbandonTableSessionService } from './application/abandon-table-session.service';
import { CreateTableService } from './application/create-table.service';
import { CloseTableSessionService } from './application/close-table-session.service';
import { FloorBranchAccessService } from './application/floor-branch-access.service';
import { GetCurrentTableSessionService } from './application/get-current-table-session.service';
import { ListTablesService } from './application/list-tables.service';
import { OpenTableSessionService } from './application/open-table-session.service';
import { FloorController } from './presentation/http/floor.controller';

@Module({
  imports: [AuthModule],
  controllers: [FloorController],
  providers: [
    FloorBranchAccessService,
    CreateTableService,
    ListTablesService,
    OpenTableSessionService,
    GetCurrentTableSessionService,
    CloseTableSessionService,
    AbandonTableSessionService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class FloorModule {}
