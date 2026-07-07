import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { KitchenBranchAccessService } from './application/kitchen-branch-access.service';
import { ListStationTicketsService } from './application/list-station-tickets.service';
import { UpdateStationTicketStatusService } from './application/update-station-ticket-status.service';
import { KitchenController } from './presentation/http/kitchen.controller';

@Module({
  imports: [AuthModule],
  controllers: [KitchenController],
  providers: [
    KitchenBranchAccessService,
    ListStationTicketsService,
    UpdateStationTicketStatusService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class KitchenModule {}
