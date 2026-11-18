import * as bcrypt from 'bcryptjs';
import {
  APPROVAL_PIN_GLOBAL_MAX_FAILED_ATTEMPTS,
  AuthService,
} from '../../modules/auth/auth.service';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ApprovalPinService } from './approval-pin.service';

type AuditRow = { actor: string; action: string };

function build() {
  const approver = {
    id: 'admin-1',
    pinHash: bcrypt.hashSync('1234', 4),
    pinFailedAttempts: 0,
    pinLockedUntil: null as Date | null,
    approvalPinFailedAttempts: 0,
    approvalPinLockedUntil: null as Date | null,
  };
  const audit: AuditRow[] = [];
  const state = { attempts: 0, lockedUntil: null as Date | null };

  const prisma = {
    auditLog: {
      count: jest.fn(({ where }: { where: { actorStaffUserId: string } }) =>
        Promise.resolve(
          audit.filter(
            (row) =>
              row.actor === where.actorStaffUserId &&
              row.action.endsWith('_APPROVAL_FAILED'),
          ).length,
        ),
      ),
    },
    staffUserBranchRole: {
      findFirst: jest.fn(() =>
        Promise.resolve({
          staffUser: {
            ...approver,
            approvalPinFailedAttempts: state.attempts,
            approvalPinLockedUntil: state.lockedUntil,
          },
        }),
      ),
    },
    staffUser: {
      update: jest.fn(() => {
        state.attempts = 0;
        state.lockedUntil = null;
        return Promise.resolve({});
      }),
    },
    $executeRaw: jest.fn((sql: { values: unknown[] }) => {
      if (state.lockedUntil && state.lockedUntil > new Date()) {
        return Promise.resolve(0);
      }

      const max = sql.values[0] as number;
      state.attempts += 1;
      if (state.attempts >= max) {
        state.attempts = 0;
        state.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }

      return Promise.resolve(1);
    }),
  } as unknown as PrismaService;

  const record = jest.fn(
    (_tx: unknown, entry: { actorStaffUserId: string }) => {
      audit.push({
        actor: entry.actorStaffUserId,
        action: 'DISCOUNT_APPROVAL_FAILED',
      });
      return Promise.resolve();
    },
  );
  const auditService = { record } as unknown as AuditService;

  const authService = new AuthService(
    prisma,
    {} as never,
    {} as never,
    {} as never,
  );
  const service = new ApprovalPinService(prisma, authService, auditService);

  const attempt = (actor: string, pin: string) =>
    service
      .verify(
        { staffUserId: actor, restaurantId: 'rest-1' },
        'branch-1',
        'admin-1',
        pin,
        { ip: null, userAgent: null },
        {
          failureAction: 'DISCOUNT_APPROVAL_FAILED',
          codePrefix: 'DISCOUNT',
          entityContext: {},
          blockedMessage: 'blocked',
        },
      )
      .then(
        () => 'OK',
        (error: { response: { code: string } }) => error.response.code,
      );

  return { attempt, audit, state, record };
}

describe('ApprovalPinService global approver lock', () => {
  it('does not lock the approver for actor B after 5 wrong PINs by actor A', async () => {
    const ctx = build();

    for (let i = 0; i < 5; i += 1) {
      expect(await ctx.attempt('cashier-a', '0000')).toBe(
        'DISCOUNT_PIN_INVALID',
      );
    }

    expect(await ctx.attempt('cashier-a', '1234')).toBe(
      'DISCOUNT_APPROVAL_BLOCKED',
    );
    expect(ctx.state.lockedUntil).toBeNull();
    expect(await ctx.attempt('cashier-b', '1234')).toBe('OK');
  });

  it('locks the approver only after the global threshold across actors', async () => {
    const ctx = build();
    const limit = APPROVAL_PIN_GLOBAL_MAX_FAILED_ATTEMPTS;

    for (let i = 0; i < limit - 1; i += 1) {
      await ctx.attempt(`cashier-${i}`, '0000');
    }
    expect(ctx.state.lockedUntil).toBeNull();

    await ctx.attempt('cashier-last', '0000');
    expect(ctx.state.lockedUntil).not.toBeNull();
    expect(await ctx.attempt('cashier-ok', '1234')).toBe('DISCOUNT_PIN_LOCKED');
  });

  it('writes no failure row for attempts refused by a locked approver', async () => {
    const ctx = build();
    ctx.state.lockedUntil = new Date(Date.now() + 60_000);

    expect(await ctx.attempt('cashier-a', '1234')).toBe('DISCOUNT_PIN_LOCKED');
    expect(await ctx.attempt('cashier-a', '0000')).toBe('DISCOUNT_PIN_LOCKED');
    expect(ctx.audit).toHaveLength(0);
    expect(ctx.record).not.toHaveBeenCalled();
  });
});
