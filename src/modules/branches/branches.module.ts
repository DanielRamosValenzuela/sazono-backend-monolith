import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BranchesStaffAccessService } from './application/branches-staff-access.service';
import { CreateBranchService } from './application/create-branch.service';
import { ListBranchesService } from './application/list-branches.service';
import { UpdateBranchService } from './application/update-branch.service';
import { BranchesController } from './presentation/http/branches.controller';

@Module({
  imports: [AuthModule],
  controllers: [BranchesController],
  providers: [
    BranchesStaffAccessService,
    CreateBranchService,
    ListBranchesService,
    UpdateBranchService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class BranchesModule {}
