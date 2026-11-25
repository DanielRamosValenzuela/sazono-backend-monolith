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

const SOUND_CHANNEL_ID = 'sazono_alerts';
const SILENT_CHANNEL_ID = 'sazono_silent';
const INVALID_TOKEN_ERROR_CODE = 'messaging/registration-token-not-registered';

interface TokenSendResult {
  id: string;
  response?: SendResponse;
}

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
    extraStaffUserIds: string[] = [],
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
      [
        ...branchRoles.map((branchRole) => branchRole.staffUserId),
        ...extraStaffUserIds,
      ],
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
        soundEnabled: true,
      },
    });

    if (deviceTokens.length === 0) {
      return;
    }

    const withSound = deviceTokens.filter((token) => token.soundEnabled);
    const silent = deviceTokens.filter((token) => !token.soundEnabled);
    const base = {
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
    };
    const { messaging } = this.firebaseAdminService;

    const [soundResponse, silentResponse] = await Promise.all([
      withSound.length > 0
        ? messaging.sendEachForMulticast({
            ...base,
            tokens: withSound.map((token) => token.fcmToken),
            android: {
              notification: { sound: 'default', channelId: SOUND_CHANNEL_ID },
            },
            apns: { payload: { aps: { sound: 'default' } } },
          })
        : null,
      silent.length > 0
        ? messaging.sendEachForMulticast({
            ...base,
            tokens: silent.map((token) => token.fcmToken),
            android: { notification: { channelId: SILENT_CHANNEL_ID } },
          })
        : null,
    ]);

    await this.cleanUpInvalidTokens([
      ...this.pairResponses(withSound, soundResponse?.responses),
      ...this.pairResponses(silent, silentResponse?.responses),
    ]);
  }

  async sendDataToBranchRoles(
    branchId: string,
    roles: Role[],
    data: Record<string, string>,
  ): Promise<void> {
    if (!this.firebaseAdminService.isEnabled) {
      return;
    }

    const branchRoles = await this.prisma.staffUserBranchRole.findMany({
      where: { branchId, role: { in: roles }, status: 'ACTIVE' },
      select: { staffUserId: true },
    });
    const staffUserIds = Array.from(
      new Set(branchRoles.map((branchRole) => branchRole.staffUserId)),
    );

    if (staffUserIds.length === 0) {
      return;
    }

    const deviceTokens = await this.prisma.staffDeviceToken.findMany({
      where: { staffUserId: { in: staffUserIds } },
      select: { id: true, fcmToken: true },
    });

    if (deviceTokens.length === 0) {
      return;
    }

    const response =
      await this.firebaseAdminService.messaging.sendEachForMulticast({
        tokens: deviceTokens.map((token) => token.fcmToken),
        data,
        android: { priority: 'high' },
      });

    await this.cleanUpInvalidTokens(
      this.pairResponses(deviceTokens, response.responses),
    );
  }

  private pairResponses(
    tokens: Array<{ id: string }>,
    responses: SendResponse[] = [],
  ): TokenSendResult[] {
    return tokens.map((token, index) => ({
      id: token.id,
      response: responses[index],
    }));
  }

  private async cleanUpInvalidTokens(
    results: TokenSendResult[],
  ): Promise<void> {
    const invalidTokenIds = results
      .filter(
        (result) => result.response?.error?.code === INVALID_TOKEN_ERROR_CODE,
      )
      .map((result) => result.id);

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
