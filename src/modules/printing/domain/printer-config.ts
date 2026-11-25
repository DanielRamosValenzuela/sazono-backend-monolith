import { isIP } from 'node:net';
import { PrinterTransport } from '@prisma/client';
import { SUPPORTED_CODEPAGES } from '../render/codepages';
import {
  isAllowedTcpAddress,
  isAmbiguousNumericHost,
  isAllowedTcpPort,
  isLocalHostname,
  parseTcpConnection,
} from './tcp-target';

const BLUETOOTH_ADDRESS = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const MAX_HOST_LENGTH = 253;

export type ConnectionResult =
  | { ok: true; connection: Record<string, unknown> }
  | { ok: false; message: string };

function fail(message: string): ConnectionResult {
  return { ok: false, message };
}

export function validateConnection(
  transport: PrinterTransport,
  value: Record<string, unknown> | undefined,
  allowLocal: boolean,
): ConnectionResult {
  switch (transport) {
    case PrinterTransport.SIMULATED:
    case PrinterTransport.BROWSER:
      return { ok: true, connection: {} };

    case PrinterTransport.TCP: {
      const parsed = parseTcpConnection(value);

      if (!parsed || parsed.host.length > MAX_HOST_LENGTH) {
        return fail('La conexion TCP requiere host y port.');
      }

      if (!isAllowedTcpPort(parsed.port)) {
        return fail('El puerto TCP debe estar entre 9100 y 9110.');
      }

      const literal = isIP(parsed.host) !== 0;

      if (
        (literal && !isAllowedTcpAddress(parsed.host, allowLocal)) ||
        (!literal && isLocalHostname(parsed.host) && !allowLocal) ||
        isAmbiguousNumericHost(parsed.host)
      ) {
        return fail('El host TCP no esta permitido.');
      }

      return {
        ok: true,
        connection: { host: parsed.host, port: parsed.port },
      };
    }

    case PrinterTransport.APP_BRIDGE: {
      const via = value?.via;

      if (via === 'bluetooth') {
        const address = value?.address;

        return typeof address === 'string' && BLUETOOTH_ADDRESS.test(address)
          ? {
              ok: true,
              connection: { via: 'bluetooth', address: address.toUpperCase() },
            }
          : fail(
              'La direccion Bluetooth debe tener el formato AA:BB:CC:DD:EE:FF.',
            );
      }

      const parsed = parseTcpConnection(value);

      if (via !== 'tcp' || !parsed || parsed.host.length > MAX_HOST_LENGTH) {
        return fail(
          'La conexion de la app requiere via "tcp" con host y port, o via "bluetooth" con address.',
        );
      }

      if (!isAllowedTcpPort(parsed.port)) {
        return fail('El puerto TCP debe estar entre 9100 y 9110.');
      }

      const allowedHost =
        isIP(parsed.host) !== 0
          ? isAllowedTcpAddress(parsed.host, allowLocal)
          : isLocalHostname(parsed.host) && allowLocal;

      return allowedHost
        ? {
            ok: true,
            connection: { via: 'tcp', host: parsed.host, port: parsed.port },
          }
        : fail(
            'El host de la app debe ser una IP privada (10.x, 172.16-31.x, 192.168.x).',
          );
    }

    case PrinterTransport.AGENT:
      return { ok: true, connection: {} };

    default:
      return fail('El transporte indicado no esta disponible todavia.');
  }
}

export function isSupportedCodepage(value: string): boolean {
  return (SUPPORTED_CODEPAGES as string[]).includes(value);
}
