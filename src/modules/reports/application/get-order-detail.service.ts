import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  ReportsPrismaRepository,
  type OrderDetailDiscountRecord,
  type OrderDetailHeaderRecord,
  type OrderDetailItemRecord,
  type OrderDetailPaymentRecord,
  type OrderDetailRefundRecord,
} from '../infrastructure/reports.prisma.repository';
import {
  buildRefundItems,
  type RefundReportItem,
} from './get-refunds-report.service';
import { UNCATEGORIZED_LABEL } from './hierarchy-tree';
import {
  ReportScopeService,
  type BranchAccessScope,
} from './report-scope.service';
import {
  CAJA_ONLINE_LABEL,
  CAJA_UNASSIGNED_LABEL,
  METHOD_LABELS,
  SOLD_ORDER_STATUSES,
  UNCLASSIFIED_METHOD,
  type MethodKey,
} from './report-types';

const SOLD_STATUSES = new Set(SOLD_ORDER_STATUSES);
const OPEN_PAYMENT_STATUSES = new Set(['PENDING', 'AUTHORIZED']);

export type OrderDetailItem = {
  id: string;
  orderId: string;
  orderStatus: string;
  name: string;
  productId: string | null;
  categoryPath: string[];
  categoryLabel: string;
  station: string;
  quantity: number;
  unitPrice: string;
  baseUnitPrice: string;
  modifiers: { name: string; priceDelta: string }[];
  modifiersTotal: string;
  lineTotal: string;
  discount: string;
  notes: string | null;
  status: string;
  cancelled: boolean;
  counted: boolean;
};

export type OrderDetailDiscount = {
  id: string;
  billItemId: string | null;
  itemName: string | null;
  type: string;
  value: string;
  amount: string;
  reasonCode: string;
  reasonText: string;
  appliedBy: string | null;
  approvedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
};

export type OrderDetailOrder = {
  id: string;
  status: string;
  source: string;
  createdAt: string;
  notes: string | null;
};

export type OrderDetailPayment = {
  id: string;
  method: MethodKey;
  methodLabel: string;
  provider: string;
  providerReference: string | null;
  amount: string;
  tip: string;
  total: string;
  status: string;
  cashier: string | null;
  cashierId: string | null;
  caja: string;
  source: string | null;
  paidAt: string | null;
  createdAt: string;
  refunded: string;
  refundedTip: string;
  refundable: { total: string; consumption: string; tip: string };
};

export type OrderDetailRefund = {
  items: RefundReportItem[];
  id: string;
  paymentId: string;
  amount: string;
  tip: string;
  net: string;
  vat: string;
  method: string;
  status: string;
  reasonCode: string;
  reasonText: string;
  requestedBy: string | null;
  requestedById: string | null;
  approvedBy: string | null;
  completedAt: string | null;
  creditNoteStatus: string;
};

export type OrderDetailResponse = {
  billId: string;
  orderNumber: string;
  billStatus: string;
  timeZone: string;
  table: { id: string; name: string };
  zone: { id: string; name: string } | null;
  waiter: { id: string; name: string | null } | null;
  openedBy: string | null;
  cashiers: string[];
  guests: number | null;
  customerLabel: string | null;
  isCounter: boolean;
  openedAt: string;
  closedAt: string | null;
  paidAt: string | null;
  sessionOpenedAt: string;
  sessionClosedAt: string | null;
  closeReason: string | null;
  orders: OrderDetailOrder[];
  items: OrderDetailItem[];
  payments: OrderDetailPayment[];
  refunds: OrderDetailRefund[];
  discounts: OrderDetailDiscount[];
  totals: {
    itemsCount: number;
    itemsTotal: string;
    discount: string;
    consumption: string;
    excludedItemsTotal: string;
    billTotal: string;
    remaining: string;
    paid: string;
    tip: string;
    collected: string;
    difference: string;
    paidPaymentsCount: number;
    refunded: string;
    refundedTip: string;
    refundedTotal: string;
    net: string;
    reconciled: boolean;
  };
  flags: {
    partiallyPaid: boolean;
    abandoned: boolean;
    voided: boolean;
    overpaid: boolean;
    hasCancelledItems: boolean;
    hasUnclassifiedPayments: boolean;
    hasRefundedPayments: boolean;
    hasOpenPayments: boolean;
    mixedMethods: boolean;
  };
};

const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal.Value): string =>
  new Prisma.Decimal(value).toFixed(0);

function buildItem(record: OrderDetailItemRecord): OrderDetailItem {
  const unitPrice = new Prisma.Decimal(record.unit_price);
  const modifiersTotal = record.modifiers.reduce(
    (sum, modifier) => sum.add(modifier.price_delta),
    ZERO,
  );
  const path =
    record.category_path && record.category_path.length > 0
      ? record.category_path
      : [UNCATEGORIZED_LABEL];
  const cancelled =
    record.status === 'CANCELLED' || record.order_status === 'CANCELLED';

  return {
    id: record.id,
    orderId: record.order_id,
    orderStatus: record.order_status,
    name: record.name,
    productId: record.menu_item_id,
    categoryPath: path,
    categoryLabel: path.join(' > '),
    station: record.station_name,
    quantity: record.quantity,
    unitPrice: money(unitPrice),
    baseUnitPrice: money(unitPrice.sub(modifiersTotal)),
    modifiers: record.modifiers.map((modifier) => ({
      name: modifier.name,
      priceDelta: money(modifier.price_delta),
    })),
    modifiersTotal: money(modifiersTotal),
    lineTotal: money(unitPrice.mul(record.quantity)),
    discount: money(record.discount_amount ?? 0),
    notes: record.notes,
    status: record.status,
    cancelled,
    counted:
      record.status !== 'CANCELLED' && SOLD_STATUSES.has(record.order_status),
  };
}

function buildPayment(record: OrderDetailPaymentRecord): OrderDetailPayment {
  const tip = new Prisma.Decimal(record.tip_amount);
  const amount = new Prisma.Decimal(record.amount).sub(tip);
  const method = (record.method ?? UNCLASSIFIED_METHOD) as MethodKey;
  const refundedTotal = new Prisma.Decimal(record.refunded_amount ?? 0);
  const refundedTip = new Prisma.Decimal(record.refunded_tip_amount ?? 0);
  const refundable = record.status === 'PAID';

  return {
    id: record.id,
    method,
    methodLabel: METHOD_LABELS[method],
    provider: record.provider,
    providerReference: record.provider_reference,
    amount: money(amount),
    tip: money(tip),
    total: money(amount.add(tip)),
    status: record.status,
    cashier: record.staff_name,
    cashierId: record.staff_user_id,
    caja:
      record.staff_name ??
      (record.source === 'WEB_QR' ? CAJA_ONLINE_LABEL : CAJA_UNASSIGNED_LABEL),
    source: record.source,
    paidAt: record.paid_at?.toISOString() ?? null,
    createdAt: record.created_at.toISOString(),
    refunded: money(refundedTotal.sub(refundedTip)),
    refundedTip: money(refundedTip),
    refundable: {
      total: money(refundable ? amount.add(tip).sub(refundedTotal) : 0),
      consumption: money(
        refundable ? amount.sub(refundedTotal.sub(refundedTip)) : 0,
      ),
      tip: money(refundable ? tip.sub(refundedTip) : 0),
    },
  };
}

function buildRefund(record: OrderDetailRefundRecord): OrderDetailRefund {
  return {
    items: buildRefundItems(record.items),
    id: record.id,
    paymentId: record.payment_id,
    amount: money(record.amount),
    tip: money(record.tip_amount),
    net: money(record.net_amount),
    vat: money(record.vat_amount),
    method: record.method,
    status: record.status,
    reasonCode: record.reason_code,
    reasonText: record.reason_text,
    requestedBy: record.requested_by_name,
    requestedById: record.requested_by_staff_user_id,
    approvedBy: record.approved_by_name,
    completedAt: record.completed_at?.toISOString() ?? null,
    creditNoteStatus: record.credit_note_status,
  };
}

function cashierOwnsBillToday(
  payments: OrderDetailPaymentRecord[],
  access: BranchAccessScope,
): boolean {
  return payments.some(
    (payment) =>
      payment.status === 'PAID' &&
      payment.staff_user_id === access.staffUserId &&
      payment.paid_at !== null &&
      payment.paid_at >= access.todayStart &&
      payment.paid_at < access.todayEnd,
  );
}

export function buildOrderDetail(
  header: OrderDetailHeaderRecord,
  itemRecords: OrderDetailItemRecord[],
  paymentRecords: OrderDetailPaymentRecord[],
  timeZone: string,
  refundRecords: OrderDetailRefundRecord[] = [],
  discountRecords: OrderDetailDiscountRecord[] = [],
): OrderDetailResponse {
  const items = itemRecords.map(buildItem);
  const payments = paymentRecords.map(buildPayment);
  const paid = payments.filter((payment) => payment.status === 'PAID');
  const sum = (values: string[]): Prisma.Decimal =>
    values.reduce((total, value) => total.add(value), ZERO);
  const refundedConsumption = sum(paid.map((payment) => payment.refunded));
  const refundedTip = sum(paid.map((payment) => payment.refundedTip));
  const refundedTotal = new Prisma.Decimal(header.refunded_amount ?? 0);
  const paidAmount = sum(paid.map((payment) => payment.amount));
  const paidTip = sum(paid.map((payment) => payment.tip));
  const itemsTotal = sum(
    items.filter((item) => item.counted).map((item) => item.lineTotal),
  );
  const excludedTotal = sum(
    items.filter((item) => !item.counted).map((item) => item.lineTotal),
  );
  const discountTotal = new Prisma.Decimal(header.discount_amount ?? 0);
  const difference = itemsTotal.sub(discountTotal).sub(paidAmount);
  const orders = new Map<string, OrderDetailOrder>();

  for (const record of itemRecords) {
    if (!orders.has(record.order_id)) {
      orders.set(record.order_id, {
        id: record.order_id,
        status: record.order_status,
        source: record.order_source,
        createdAt: record.order_created_at.toISOString(),
        notes: record.order_notes,
      });
    }
  }

  const cashiers = [
    ...new Set(
      paid
        .map((payment) => payment.cashier)
        .filter((name): name is string => name !== null),
    ),
  ];
  const paidMethods = new Set(paid.map((payment) => payment.method));

  return {
    billId: header.id,
    orderNumber:
      header.ticket_number?.toString() ?? header.id.slice(-6).toUpperCase(),
    billStatus: header.status,
    timeZone,
    table: { id: header.table_id, name: header.table_name },
    zone: header.zone_id
      ? { id: header.zone_id, name: header.zone_name ?? '' }
      : null,
    waiter: header.waiter_id
      ? { id: header.waiter_id, name: header.waiter_name }
      : null,
    openedBy: header.opened_by_name,
    cashiers,
    guests: header.guest_count,
    customerLabel: header.customer_label,
    isCounter: header.is_counter,
    openedAt: header.opened_at.toISOString(),
    closedAt: header.closed_at?.toISOString() ?? null,
    paidAt: header.last_paid_at?.toISOString() ?? null,
    sessionOpenedAt: header.session_opened_at.toISOString(),
    sessionClosedAt: header.session_closed_at?.toISOString() ?? null,
    closeReason: header.close_reason ?? header.session_close_reason,
    orders: [...orders.values()],
    items,
    payments,
    refunds: refundRecords.map(buildRefund),
    discounts: discountRecords.map((record) => ({
      id: record.id,
      billItemId: record.bill_item_id,
      itemName: record.item_name,
      type: record.type,
      value: new Prisma.Decimal(record.value).toString(),
      amount: money(record.amount),
      reasonCode: record.reason_code,
      reasonText: record.reason_text,
      appliedBy: record.applied_by_name,
      approvedBy: record.approved_by_name,
      voidedAt: record.voided_at?.toISOString() ?? null,
      voidReason: record.void_reason,
      createdAt: record.created_at.toISOString(),
    })),
    totals: {
      itemsCount: items
        .filter((item) => item.counted)
        .reduce((total, item) => total + item.quantity, 0),
      itemsTotal: money(itemsTotal),
      discount: money(discountTotal),
      consumption: money(itemsTotal.sub(discountTotal)),
      excludedItemsTotal: money(excludedTotal),
      billTotal: money(header.total_amount),
      remaining: money(header.remaining_amount),
      paid: money(paidAmount),
      tip: money(paidTip),
      collected: money(paidAmount.add(paidTip)),
      difference: money(difference),
      paidPaymentsCount: paid.length,
      refunded: money(refundedConsumption),
      refundedTip: money(refundedTip),
      refundedTotal: money(refundedTotal),
      net: money(paidAmount.sub(refundedConsumption)),
      reconciled: difference.isZero(),
    },
    flags: {
      partiallyPaid:
        header.status === 'PARTIALLY_PAID' ||
        (paid.length > 0 && difference.gt(0)),
      abandoned: header.status === 'ABANDONED',
      voided: header.status === 'VOID',
      overpaid: difference.lt(0),
      hasCancelledItems: items.some((item) => item.cancelled),
      hasUnclassifiedPayments: paid.some(
        (payment) => payment.method === UNCLASSIFIED_METHOD,
      ),
      hasRefundedPayments:
        refundedTotal.gt(0) ||
        payments.some((payment) => payment.status === 'REFUNDED'),
      hasOpenPayments: payments.some((payment) =>
        OPEN_PAYMENT_STATUSES.has(payment.status),
      ),
      mixedMethods: paidMethods.size > 1,
    },
  };
}

@Injectable()
export class GetOrderDetailService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly reportsRepository: ReportsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    billId: string,
  ): Promise<OrderDetailResponse> {
    const access = await this.scopeService.resolveAccess(authUser, branchId);
    const records = await this.reportsRepository.findOrderDetail(
      branchId,
      billId,
      access.cashierScoped ? access.staffUserId : null,
    );

    if (
      !records.header ||
      (access.cashierScoped && !cashierOwnsBillToday(records.payments, access))
    ) {
      throw new NotFoundException(
        'La comanda no existe o no esta disponible para tu perfil.',
      );
    }

    return buildOrderDetail(
      records.header,
      records.items,
      records.payments,
      access.timeZone,
      records.refunds,
      records.discounts,
    );
  }
}
