import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { DeviceTokenSoundService } from './device-token-sound.service';

describe('DeviceTokenSoundService', () => {
  const updateMany = jest.fn();
  const findUnique = jest.fn();
  const service = new DeviceTokenSoundService({
    staffDeviceToken: { updateMany, findUnique },
  } as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('updates only the caller token', async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await expect(service.set('staff-1', 'fcm-1', false)).resolves.toEqual({
      soundEnabled: false,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { staffUserId: 'staff-1', fcmToken: 'fcm-1' },
      data: { soundEnabled: false },
    });
  });

  it('returns 404 when the token is not the caller own', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue(null);

    await expect(service.set('staff-1', 'x', true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.get('staff-1', 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reads the preference', async () => {
    findUnique.mockResolvedValue({ soundEnabled: false });

    await expect(service.get('staff-1', 'fcm-1')).resolves.toEqual({
      soundEnabled: false,
    });
  });
});
