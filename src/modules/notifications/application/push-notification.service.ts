import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { SendResponse } from 'firebase-admin/messaging';
import { FirebaseAdminService } from '../../../common/firebase/firebase-admin.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

const INVALID_TOKEN_ERROR_CODE = 'messaging/registration-token-not-registered';

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseAdminService: FirebaseAdminService,
  ) {}

  async notifyBranchRoles(
    branchId: string,
    roles: Role[],
    payload: PushNotificationPayload,
  ): Promise<void> {
    const branchRoles = await this.prisma.staffUserBranchRole.findMany({
      where: {
        branchId,
        role: { in: roles },
        status: 'ACTIVE',
      },
      select: {
        staffUserId: true,
      },
    });

    await this.sendToStaffUsers(
      branchRoles.map((branchRole) => branchRole.staffUserId),
      payload,
    );
  }

  async sendToStaffUsers(
    staffUserIds: string[],
    payload: PushNotificationPayload,
  ): Promise<void> {
    const uniqueStaffUserIds = Array.from(new Set(staffUserIds));

    if (
      uniqueStaffUserIds.length === 0 ||
      !this.firebaseAdminService.isEnabled
    ) {
      return;
    }

    const deviceTokens = await this.prisma.staffDeviceToken.findMany({
      where: {
        staffUserId: { in: uniqueStaffUserIds },
      },
      select: {
        id: true,
        fcmToken: true,
      },
    });

    if (deviceTokens.length === 0) {
      return;
    }

    const response =
      await this.firebaseAdminService.messaging.sendEachForMulticast({
        tokens: deviceTokens.map((deviceToken) => deviceToken.fcmToken),
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
      });

    await this.cleanUpInvalidTokens(deviceTokens, response.responses);
  }

  private async cleanUpInvalidTokens(
    deviceTokens: Array<{ id: string; fcmToken: string }>,
    responses: SendResponse[],
  ): Promise<void> {
    const invalidTokenIds = deviceTokens
      .filter(
        (_, index) =>
          responses[index]?.error?.code === INVALID_TOKEN_ERROR_CODE,
      )
      .map((deviceToken) => deviceToken.id);

    if (invalidTokenIds.length === 0) {
      return;
    }

    await this.prisma.staffDeviceToken.deleteMany({
      where: {
        id: { in: invalidTokenIds },
      },
    });

    this.logger.log(
      `Se limpiaron ${invalidTokenIds.length} token(s) de dispositivo invalido(s).`,
    );
  }
}
