import { isIP } from 'node:net';

export const TCP_MIN_PORT = 9100;
export const TCP_MAX_PORT = 9110;

export type TcpConnection = { host: string; port: number };

export function parseTcpConnection(value: unknown): TcpConnection | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const { host, port } = value as { host?: unknown; port?: unknown };
  const numericPort = typeof port === 'string' ? Number(port) : port;

  if (
    typeof host !== 'string' ||
    host.trim().length === 0 ||
    typeof numericPort !== 'number' ||
    !Number.isInteger(numericPort)
  ) {
    return null;
  }

  return { host: host.trim(), port: numericPort };
}

export function isAllowedTcpPort(port: number): boolean {
  return port >= TCP_MIN_PORT && port <= TCP_MAX_PORT;
}

function isPrivateV4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);

  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}

export function isAllowedTcpAddress(
  address: string,
  allowLocal: boolean,
): boolean {
  if (address === '::1') {
    return allowLocal;
  }

  if (isIP(address) !== 4) {
    return false;
  }

  const [a] = address.split('.').map(Number);

  if (a === 127) {
    return allowLocal;
  }

  return isPrivateV4(address);
}

export function isAmbiguousNumericHost(host: string): boolean {
  return isIP(host) === 0 && /^(0x[0-9a-f.x]+|[0-9.]+)$/i.test(host);
}

export function isLocalHostname(host: string): boolean {
  return host.toLowerCase() === 'localhost';
}
