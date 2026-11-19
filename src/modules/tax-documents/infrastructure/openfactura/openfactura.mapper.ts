import type {
  BoletaSnapshot,
  CreditNoteSnapshot,
  SnapshotEmitter,
  SnapshotReceiver,
} from '../../domain/tax-snapshot';
import { CREDIT_NOTE_ITEM_NAME } from '../../domain/tax-snapshot';

export const TIPO_BOLETA_AFECTA = 39;
export const TIPO_NOTA_CREDITO = 61;
export const CONSUMER_RUT = '66666666-6';
export const CONSUMER_NAME = 'Consumidor final';
export const VAT_RATE_PERCENT = 19;
export const IND_SERVICIO_BOLETA = 3;
export const RESPONSE_FIELDS = ['FOLIO', 'TIMBRE', 'PDF'];

const MAX_LEGAL_NAME = 100;
const MAX_ACTIVITY = 80;
const MAX_ADDRESS = 70;
const MAX_COMMUNE = 20;
const MAX_REASON = 90;

export class TaxMappingError extends Error {
  constructor(readonly missing: string[]) {
    super(`Faltan datos tributarios del restaurante: ${missing.join(', ')}.`);
  }
}

export type OpenFacturaEmitter = SnapshotEmitter & {
  siiBranchCode?: number | null;
};

export type OpenFacturaPayload = {
  response: string[];
  dte: Record<string, unknown>;
};

export function normalizeRutForProvider(raw: string): string | null {
  const cleaned = raw.replace(/[.\s]/g, '').toUpperCase();

  return /^\d{7,8}-[\dK]$/.test(cleaned) ? cleaned : null;
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

type ResolvedEmitter = {
  rut: string;
  legalName: string;
  activity: string;
  economicActivityCode: number | null;
  address: string;
  commune: string;
  city: string | null;
  siiBranchCode: number | null;
};

function resolveEmitter(
  emitter: OpenFacturaEmitter,
  requireActivityCode: boolean,
): ResolvedEmitter {
  const missing: string[] = [];
  const rut = emitter.rut ? normalizeRutForProvider(emitter.rut) : null;

  if (!rut) {
    missing.push('taxId');
  }

  if (!emitter.legalName?.trim()) {
    missing.push('legalName');
  }

  if (!emitter.activity?.trim()) {
    missing.push('businessActivity');
  }

  if (!emitter.address?.trim()) {
    missing.push('legalAddress');
  }

  if (!emitter.commune?.trim()) {
    missing.push('legalCommune');
  }

  if (requireActivityCode && !emitter.economicActivityCode) {
    missing.push('economicActivityCode');
  }

  if (missing.length > 0) {
    throw new TaxMappingError(missing);
  }

  return {
    rut: rut as string,
    legalName: clip(emitter.legalName as string, MAX_LEGAL_NAME),
    activity: clip(emitter.activity as string, MAX_ACTIVITY),
    economicActivityCode: emitter.economicActivityCode,
    address: clip(emitter.address as string, MAX_ADDRESS),
    commune: clip(emitter.commune as string, MAX_COMMUNE),
    city: emitter.city ? clip(emitter.city, MAX_COMMUNE) : null,
    siiBranchCode: emitter.siiBranchCode ?? null,
  };
}

function resolveReceiver(receiver: SnapshotReceiver | null): {
  rut: string;
  name: string | null;
} {
  const rut = receiver ? normalizeRutForProvider(receiver.rut) : null;

  if (!rut) {
    return { rut: CONSUMER_RUT, name: null };
  }

  return {
    rut,
    name: receiver?.name ? clip(receiver.name, MAX_LEGAL_NAME) : null,
  };
}

export function mapBoletaPayload(
  snapshot: BoletaSnapshot,
  emitterOverride: OpenFacturaEmitter | null,
): OpenFacturaPayload {
  const emitter = resolveEmitter(emitterOverride ?? snapshot.emitter, false);
  const receiver = resolveReceiver(snapshot.receiver);

  return {
    response: RESPONSE_FIELDS,
    dte: {
      Encabezado: {
        IdDoc: {
          TipoDTE: TIPO_BOLETA_AFECTA,
          Folio: 0,
          FchEmis: snapshot.issueDate,
          IndServicio: IND_SERVICIO_BOLETA,
        },
        Emisor: {
          RUTEmisor: emitter.rut,
          RznSocEmisor: emitter.legalName,
          GiroEmisor: emitter.activity,
          ...(emitter.siiBranchCode
            ? { CdgSIISucur: emitter.siiBranchCode }
            : {}),
          DirOrigen: emitter.address,
          CmnaOrigen: emitter.commune,
          ...(emitter.city ? { CiudadOrigen: emitter.city } : {}),
        },
        Receptor: {
          RUTRecep: receiver.rut,
          ...(receiver.name ? { RznSocRecep: receiver.name } : {}),
        },
        Totales: {
          MntNeto: snapshot.totals.net,
          IVA: snapshot.totals.vat,
          MntTotal: snapshot.totals.gross,
        },
      },
      Detalle: snapshot.lines.map((line, index) => ({
        NroLinDet: index + 1,
        NmbItem: line.name,
        QtyItem: line.quantity,
        PrcItem: line.unitPrice,
        ...(line.discount > 0 ? { DescuentoMonto: line.discount } : {}),
        MontoItem: line.total,
      })),
    },
  };
}

export function mapCreditNotePayload(
  snapshot: CreditNoteSnapshot,
  reference: { folio: number; issueDate: string },
  emitterOverride: OpenFacturaEmitter | null,
): OpenFacturaPayload {
  const emitter = resolveEmitter(emitterOverride ?? snapshot.emitter, true);
  const receiver = resolveReceiver(snapshot.receiver);

  return {
    response: RESPONSE_FIELDS,
    dte: {
      Encabezado: {
        IdDoc: {
          TipoDTE: TIPO_NOTA_CREDITO,
          Folio: 0,
          FchEmis: snapshot.issueDate,
        },
        Emisor: {
          RUTEmisor: emitter.rut,
          RznSoc: emitter.legalName,
          GiroEmis: emitter.activity,
          Acteco: emitter.economicActivityCode,
          DirOrigen: emitter.address,
          CmnaOrigen: emitter.commune,
          ...(emitter.city ? { CiudadOrigen: emitter.city } : {}),
        },
        Receptor: {
          RUTRecep: receiver.rut,
          RznSocRecep: receiver.name ?? CONSUMER_NAME,
        },
        Totales: {
          MntNeto: snapshot.totals.net,
          TasaIVA: VAT_RATE_PERCENT,
          IVA: snapshot.totals.vat,
          MntTotal: snapshot.totals.gross,
        },
      },
      Detalle: [
        {
          NroLinDet: 1,
          NmbItem: CREDIT_NOTE_ITEM_NAME,
          QtyItem: 1,
          PrcItem: snapshot.totals.net,
          MontoItem: snapshot.totals.net,
        },
      ],
      Referencia: [
        {
          NroLinRef: 1,
          TpoDocRef: TIPO_BOLETA_AFECTA,
          FolioRef: reference.folio,
          FchRef: reference.issueDate,
          CodRef: snapshot.referenceCode,
          RazonRef: clip(snapshot.reason, MAX_REASON) || 'Devolucion',
        },
      ],
    },
  };
}
