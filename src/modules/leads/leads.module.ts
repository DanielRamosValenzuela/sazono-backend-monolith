import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { CreateLeadService } from './application/create-lead.service';
import { ListLeadsService } from './application/list-leads.service';
import { LeadsController } from './presentation/http/leads.controller';

@Module({
  imports: [AuthModule],
  controllers: [LeadsController],
  providers: [
    CreateLeadService,
    ListLeadsService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class LeadsModule {}
