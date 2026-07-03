import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateStaffUserService } from './application/create-staff-user.service';
import { ListStaffUsersService } from './application/list-staff-users.service';
import { StaffAdminAccessService } from './application/staff-admin-access.service';
import { StaffController } from './presentation/http/staff.controller';

@Module({
  imports: [AuthModule],
  controllers: [StaffController],
  providers: [
    StaffAdminAccessService,
    CreateStaffUserService,
    ListStaffUsersService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class StaffModule {}
