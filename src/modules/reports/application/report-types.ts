import { PaymentMethod } from '@prisma/client';

export const UNCLASSIFIED_METHOD = 'SIN_CLASIFICAR';

export const METHOD_KEYS = [
  PaymentMethod.CASH,
  PaymentMethod.CREDIT_CARD,
  PaymentMethod.DEBIT_CARD,
  PaymentMethod.TRANSFER,
  PaymentMethod.MERCADO_PAGO,
  PaymentMethod.VOUCHER,
  PaymentMethod.MACH,
  PaymentMethod.OTHER,
  UNCLASSIFIED_METHOD,
] as const;

export type MethodKey = (typeof METHOD_KEYS)[number];

export const METHOD_LABELS: Record<MethodKey, string> = {
  CASH: 'Efectivo',
  CREDIT_CARD: 'Tarjeta de crédito',
  DEBIT_CARD: 'Tarjeta de débito',
  TRANSFER: 'Transferencia',
  MERCADO_PAGO: 'Mercado Pago',
  VOUCHER: 'Vale',
  MACH: 'MACH',
  OTHER: 'Otro',
  SIN_CLASIFICAR: 'Sin clasificar',
};

export const CAJA_ONLINE_LABEL = 'QR/Online';
export const CAJA_UNASSIGNED_LABEL = 'Sin asignar';

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;
export const CSV_BATCH_SIZE = 2000;
export const MAX_RANGE_DAYS = 366;
export const MAX_CSV_RANGE_DAYS = 92;

export type MethodAmount = { method: MethodKey; amount: string };

export const PAYMENT_SOURCES = ['WEB_QR', 'CASHIER', 'WAITER'] as const;
export const BILL_PAYMENT_STATUSES = ['PAID_FULL', 'MIXED'] as const;
export const SALES_ORDER_BY = [
  'closedAt',
  'total',
  'tip',
  'orderNumber',
] as const;
export const PAYMENTS_ORDER_BY = ['eventAt', 'amount', 'tip'] as const;
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export const SOLD_ORDER_STATUSES = [
  'CONFIRMED',
  'ROUTED',
  'IN_PREPARATION',
  'PARTIALLY_READY',
  'READY',
  'DELIVERED',
];
export const MAX_FILTER_AMOUNT = 1_000_000_000;
export const MAX_SEARCH_LENGTH = 100;
export const MAX_CATEGORY_PATH_DEPTH = 4;
export const MAX_PATH_SEGMENT_LENGTH = 200;
export const FILTER_OPTIONS_WINDOW_DAYS = 90;

export type PaymentSource = (typeof PAYMENT_SOURCES)[number];
export type BillPaymentStatus = (typeof BILL_PAYMENT_STATUSES)[number];
export type SalesOrderBy = (typeof SALES_ORDER_BY)[number];
export type PaymentsOrderBy = (typeof PAYMENTS_ORDER_BY)[number];
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export type PaymentSqlFilter = {
  cashierId: string | null;
  methods: MethodKey[];
  sources: PaymentSource[];
};

export type ReportFilters = {
  waiterId: string | null;
  tableId: string | null;
  zoneId: string | null;
  sources: PaymentSource[];
  billStatuses: BillPaymentStatus[];
  minAmount: number | null;
  maxAmount: number | null;
  hasTip: boolean | null;
  minTip: number | null;
  timeFromMinute: number | null;
  timeToMinute: number | null;
  weekdays: number[];
  q: string | null;
  productId: string | null;
  productName: string | null;
  categoryPath: string[] | null;
};

export const EMPTY_FILTERS: ReportFilters = {
  waiterId: null,
  tableId: null,
  zoneId: null,
  sources: [],
  billStatuses: [],
  minAmount: null,
  maxAmount: null,
  hasTip: null,
  minTip: null,
  timeFromMinute: null,
  timeToMinute: null,
  weekdays: [],
  q: null,
  productId: null,
  productName: null,
  categoryPath: null,
};

export type ReportScope = {
  branchId: string;
  timeZone: string;
  from: string;
  to: string;
  start: Date;
  end: Date;
  cashierId: string | null;
  methods: MethodKey[];
  cashierScoped: boolean;
  filters: ReportFilters;
};

export type KeysetCursor = { value: string; id: string };
