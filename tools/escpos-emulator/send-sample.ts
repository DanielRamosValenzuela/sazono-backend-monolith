import * as net from 'node:net';
import { parseArgs } from 'node:util';
import { startEmulator } from './emulator';
import { buildSampleTicket, SAMPLE_EXPECTED } from './sample';

function send(host: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host, () => socket.end(data));
    socket.on('error', reject);
    socket.on('close', () => resolve());
  });
}

async function lastText(httpBase: string, since: number): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await fetch(`${httpBase}/jobs.json`);
    const jobs = (await res.json()) as { id: number; text: string }[];
    if (jobs.length > since) {
      return jobs[jobs.length - 1].text;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('emulator did not report the job');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      'http-port': { type: 'string' },
    },
  });
  const external = values.host !== undefined || values.port !== undefined;
  const embedded = external
    ? null
    : await startEmulator({ port: 0, httpPort: 0, columns: 32, quiet: true });
  const host = values.host ?? '127.0.0.1';
  const port = embedded?.port ?? Number(values.port ?? 9100);
  const httpPort = embedded?.httpPort ?? Number(values['http-port'] ?? 9101);
  const httpBase = `http://127.0.0.1:${httpPort}`;
  try {
    const before = (
      (await (await fetch(`${httpBase}/jobs.json`)).json()) as unknown[]
    ).length;
    await send(host, port, buildSampleTicket());
    const text = await lastText(httpBase, before);
    if (text !== SAMPLE_EXPECTED) {
      console.error(
        `MISMATCH\n--- expected\n${SAMPLE_EXPECTED}\n--- got\n${text}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`OK: sample ticket parsed as expected\n${text}`);
  } finally {
    await embedded?.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
