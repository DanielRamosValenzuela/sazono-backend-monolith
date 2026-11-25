import { lookup } from 'node:dns/promises';
import { Socket } from 'node:net';
import { Injectable } from '@nestjs/common';
import { PrinterTransport, type Printer } from '@prisma/client';
import { PrintingConfigService } from '../application/printing-config.service';
import type {
  DeliverOutcome,
  PrintTransport,
} from '../application/ports/print-transport.port';
import {
  isAllowedTcpAddress,
  isAllowedTcpPort,
  isAmbiguousNumericHost,
  isLocalHostname,
  parseTcpConnection,
} from '../domain/tcp-target';

const failed = (
  retryable: boolean,
  code: string,
  message: string,
): DeliverOutcome => ({ kind: 'FAILED', retryable, code, message });

@Injectable()
export class Tcp9100Transport implements PrintTransport {
  readonly kind = PrinterTransport.TCP;

  constructor(private readonly config: PrintingConfigService) {}

  async deliver(
    printer: Printer,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<DeliverOutcome> {
    const target = parseTcpConnection(printer.connection);

    if (!target) {
      return failed(false, 'TCP_BAD_CONNECTION', 'Falta host o puerto.');
    }

    if (!isAllowedTcpPort(target.port)) {
      return failed(false, 'TCP_PORT_FORBIDDEN', 'Puerto no permitido.');
    }

    if (isAmbiguousNumericHost(target.host)) {
      return failed(false, 'TCP_HOST_FORBIDDEN', 'Host no permitido.');
    }

    let addresses: string[];

    try {
      addresses = isLocalHostname(target.host)
        ? ['127.0.0.1']
        : (await lookup(target.host, { family: 4, all: true })).map(
            (entry) => entry.address,
          );
    } catch {
      return failed(true, 'TCP_DNS', 'No se pudo resolver el host.');
    }

    const address = addresses[0];

    if (
      !address ||
      !addresses.every((entry) =>
        isAllowedTcpAddress(entry, this.config.tcpAllowLocal),
      )
    ) {
      return failed(false, 'TCP_HOST_FORBIDDEN', 'Host no permitido.');
    }

    return this.send(address, target.port, bytes, signal);
  }

  private send(
    host: string,
    port: number,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<DeliverOutcome> {
    return new Promise((resolve) => {
      const socket = new Socket();
      let settled = false;
      let connected = false;

      const finish = (outcome: DeliverOutcome) => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();
        resolve(outcome);
      };

      socket.setTimeout(this.config.tcpConnectTimeoutMs);
      socket.once('timeout', () =>
        finish(
          failed(
            true,
            connected ? 'TCP_WRITE_TIMEOUT' : 'TCP_CONNECT_TIMEOUT',
            'La impresora no respondio a tiempo.',
          ),
        ),
      );
      socket.once('error', (error: NodeJS.ErrnoException) =>
        finish(
          failed(
            true,
            error.code ?? 'TCP_ERROR',
            error.message || 'Error de conexion.',
          ),
        ),
      );
      socket.once('close', () => {
        if (connected) {
          finish({ kind: 'OK' });
        } else {
          finish(failed(true, 'TCP_CLOSED', 'Conexion cerrada.'));
        }
      });
      signal.addEventListener('abort', () =>
        finish(failed(true, 'TCP_ABORTED', 'Envio cancelado.')),
      );

      socket.connect(port, host, () => {
        connected = true;
        socket.setTimeout(this.config.tcpWriteTimeoutMs);
        socket.end(Buffer.from(bytes));
      });
    });
  }
}
