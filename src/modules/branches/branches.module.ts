import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateBranchService } from './application/create-branch.service';
import { BranchesController } from './presentation/http/branches.controller';

@Module({
  imports: [AuthModule],
  controllers: [BranchesController],
  providers: [CreateBranchService, JwtAuthGuard, ProfileTypeGuard],
})
export class BranchesModule {}
