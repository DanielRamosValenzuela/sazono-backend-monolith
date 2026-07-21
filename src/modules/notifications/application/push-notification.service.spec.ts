import { Role } from '@prisma/client';
import type { FirebaseAdminService } from '../../../common/firebase/firebase-admin.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { PushNotificationService } from './push-notification.service';

describe('PushNotificationService', () => {
  const staffDeviceTokenFindManyMock = jest.fn();
  const staffDeviceTokenDeleteManyMock = jest.fn();
  const staffUserBranchRoleFindManyMock = jest.fn();
  const prisma = {
    staffDeviceToken: {
      findMany: staffDeviceTokenFindManyMock,
      deleteMany: staffDeviceTokenDeleteManyMock,
    },
    staffUserBranchRole: {
      findMany: staffUserBranchRoleFindManyMock,
    },
  } as unknown as PrismaService;

  const sendEachForMulticastMock = jest.fn();

  let service: PushNotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does nothing when Firebase Admin is not configured', async () => {
    const firebaseAdminService = {
      isEnabled: false,
      messaging: { sendEachForMulticast: sendEachForMulticastMock },
    } as unknown as FirebaseAdminService;
    service = new PushNotificationService(prisma, firebaseAdminService);

    await service.sendToStaffUsers(['staff-1'], {
      title: 'Nueva orden',
      body: 'Hay una nueva orden en el salon.',
    });

    expect(staffDeviceTokenFindManyMock).not.toHaveBeenCalled();
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it('does nothing when there are no staff user ids to notify', async () => {
    const firebaseAdminService = {
      isEnabled: true,
      messaging: { sendEachForMulticast: sendEachForMulticastMock },
    } as unknown as FirebaseAdminService;
    service = new PushNotificationService(prisma, firebaseAdminService);

    await service.sendToStaffUsers([], {
      title: 'Nueva orden',
      body: 'Hay una nueva orden en el salon.',
    });

    expect(staffDeviceTokenFindManyMock).not.toHaveBeenCalled();
  });

  it('sends a multicast push and cleans up invalid tokens', async () => {
    const firebaseAdminService = {
      isEnabled: true,
      messaging: { sendEachForMulticast: sendEachForMulticastMock },
    } as unknown as FirebaseAdminService;
    service = new PushNotificationService(prisma, firebaseAdminService);

    staffDeviceTokenFindManyMock.mockResolvedValue([
      { id: 'token-1', fcmToken: 'fcm-1' },
      { id: 'token-2', fcmToken: 'fcm-2' },
    ]);
    sendEachForMulticastMock.mockResolvedValue({
      responses: [
        { success: true, messageId: 'msg-1' },
        {
          success: false,
          error: { code: 'messaging/registration-token-not-registered' },
        },
      ],
      successCount: 1,
      failureCount: 1,
    });

    await service.sendToStaffUsers(['staff-1'], {
      title: 'Pedido listo',
      body: 'Tu pedido esta listo para servir.',
    });

    expect(sendEachForMulticastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['fcm-1', 'fcm-2'],
      }),
    );
    expect(staffDeviceTokenDeleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: ['token-2'] } },
    });
  });

  it('resolves branch roles before notifying', async () => {
    const firebaseAdminService = {
      isEnabled: true,
      messaging: { sendEachForMulticast: sendEachForMulticastMock },
    } as unknown as FirebaseAdminService;
    service = new PushNotificationService(prisma, firebaseAdminService);

    staffUserBranchRoleFindManyMock.mockResolvedValue([
      { staffUserId: 'staff-kitchen-1' },
      { staffUserId: 'staff-bar-1' },
    ]);
    staffDeviceTokenFindManyMock.mockResolvedValue([]);

    await service.notifyBranchRoles('branch-1', [Role.KITCHEN, Role.BAR], {
      title: 'Nueva orden',
      body: 'Hay una nueva orden en el salon.',
    });

    expect(staffUserBranchRoleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ branchId: 'branch-1' }),
      }),
    );
    expect(staffDeviceTokenFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          staffUserId: { in: ['staff-kitchen-1', 'staff-bar-1'] },
        },
      }),
    );
  });
});
