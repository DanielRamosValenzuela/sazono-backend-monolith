import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { UnregisterDeviceTokenDto } from '../presentation/http/dto/device-token.dto';

@Injectable()
export class UnregisterDeviceTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    staffUserId: string,
    dto: UnregisterDeviceTokenDto,
  ): Promise<void> {
    await this.prisma.staffDeviceToken.deleteMany({
      where: {
        staffUserId,
        fcmToken: dto.fcmToken,
      },
    });
  }
}
