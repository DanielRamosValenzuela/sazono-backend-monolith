import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import type { ListPaymentRefundsService } from '../../application/list-payment-refunds.service';
import type { RefundPaymentService } from '../../application/refund-payment.service';
import type { CreateRefundDto } from './dto/refunds.dto';
import { RefundsController } from './refunds.controller';

const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: 'staff-1',
  restaurantId: 'restaurant-1',
};

const BRANCH = '11111111-1111-4111-8111-111111111111';
const PAYMENT = '22222222-2222-4222-8222-222222222222';

describe('RefundsController', () => {
  const execute = jest.fn().mockResolvedValue({ ok: true });
  const list = jest.fn().mockResolvedValue({ listed: true });
  const controller = new RefundsController(
    { execute } as unknown as RefundPaymentService,
    { execute: list } as unknown as ListPaymentRefundsService,
  );
  const dto = {
    amount: '3000',
    reasonCode: 'OTHER',
    reasonText: 'Plato frio',
  } as CreateRefundDto;
  const request = (headers: Record<string, string>, ip = '::1') =>
    ({ headers, ip }) as unknown as Request;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const bodyOf = (error: unknown) =>
    (error as BadRequestException).getResponse() as { code: string };

  it('rejects a missing Idempotency-Key', () => {
    let thrown: unknown;

    try {
      void controller.create(
        authUser,
        BRANCH,
        PAYMENT,
        undefined,
        dto,
        request({}),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect(bodyOf(thrown).code).toBe('REFUND_IDEMPOTENCY_KEY_REQUIRED');
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['short', 'has spaces here', 'x'.repeat(101), 'bad/char/key-1'])(
    'rejects the invalid key "%s"',
    (key) => {
      let thrown: unknown;

      try {
        void controller.create(
          authUser,
          BRANCH,
          PAYMENT,
          key,
          dto,
          request({}),
        );
      } catch (error) {
        thrown = error;
      }

      expect(bodyOf(thrown).code).toBe('REFUND_IDEMPOTENCY_KEY_INVALID');
    },
  );

  it('ignores a client supplied x-forwarded-for and uses the request ip', async () => {
    await controller.create(
      authUser,
      BRANCH,
      PAYMENT,
      'key-12345678',
      dto,
      request(
        {
          'x-forwarded-for': '203.0.113.9, 10.0.0.1',
          'user-agent': 'Mozilla',
        },
        '192.168.0.4',
      ),
    );

    expect(execute).toHaveBeenCalledWith(
      authUser,
      BRANCH,
      PAYMENT,
      'key-12345678',
      dto,
      { ip: '192.168.0.4', userAgent: 'Mozilla' },
    );
  });

  it('falls back to the request ip', async () => {
    await controller.create(
      authUser,
      BRANCH,
      PAYMENT,
      'key-12345678',
      dto,
      request({}, '192.168.0.4'),
    );

    expect(execute).toHaveBeenCalledWith(
      authUser,
      BRANCH,
      PAYMENT,
      'key-12345678',
      dto,
      { ip: '192.168.0.4', userAgent: null },
    );
  });

  it('delegates the listing', async () => {
    await expect(controller.list(authUser, BRANCH, PAYMENT)).resolves.toEqual({
      listed: true,
    });
    expect(list).toHaveBeenCalledWith(authUser, BRANCH, PAYMENT);
  });
});
