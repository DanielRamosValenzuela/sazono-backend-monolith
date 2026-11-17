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

export type PaymentSqlFilter = {
  cashierId: string | null;
  methods: MethodKey[];
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
};

export type KeysetCursor = { at: Date; id: string };
