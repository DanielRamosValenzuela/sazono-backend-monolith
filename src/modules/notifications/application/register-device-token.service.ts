import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { RegisterDeviceTokenDto } from '../presentation/http/dto/device-token.dto';

@Injectable()
export class RegisterDeviceTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    staffUserId: string,
    dto: RegisterDeviceTokenDto,
  ): Promise<void> {
    await this.prisma.staffDeviceToken.upsert({
      where: {
        staffUserId_fcmToken: {
          staffUserId,
          fcmToken: dto.fcmToken,
        },
      },
      create: {
        staffUserId,
        fcmToken: dto.fcmToken,
        platform: dto.platform,
      },
      update: {
        platform: dto.platform,
      },
    });
  }
}
