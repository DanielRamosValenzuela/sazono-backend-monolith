import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class DeviceTokenSoundService {
  constructor(private readonly prisma: PrismaService) {}

  async get(
    staffUserId: string,
    fcmToken: string,
  ): Promise<{ soundEnabled: boolean }> {
    const token = await this.prisma.staffDeviceToken.findUnique({
      where: { staffUserId_fcmToken: { staffUserId, fcmToken } },
      select: { soundEnabled: true },
    });

    if (!token) {
      throw new NotFoundException('Dispositivo no registrado.');
    }

    return { soundEnabled: token.soundEnabled };
  }

  async set(
    staffUserId: string,
    fcmToken: string,
    soundEnabled: boolean,
  ): Promise<{ soundEnabled: boolean }> {
    const { count } = await this.prisma.staffDeviceToken.updateMany({
      where: { staffUserId, fcmToken },
      data: { soundEnabled },
    });

    if (count === 0) {
      throw new NotFoundException('Dispositivo no registrado.');
    }

    return { soundEnabled };
  }
}
