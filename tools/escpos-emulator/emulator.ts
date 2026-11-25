import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { parseEscpos, renderText } from './parser';
import type { ParsedJob } from './parser';
import { escapeHtml, renderPageHtml, renderPaperHtml } from './render';

export interface EmulatorOptions {
  host?: string;
  port?: number;
  httpPort?: number;
  columns?: number;
  outDir?: string;
  idleMs?: number;
  quiet?: boolean;
}

export interface Job {
  id: number;
  receivedAt: string;
  bytes: number;
  text: string;
  parsed: ParsedJob;
}

export interface Emulator {
  port: number;
  httpPort: number;
  jobs: Job[];
  close: () => Promise<void>;
}

const MAX_JOBS = 200;
const MAX_JOB_BYTES = 1024 * 1024;

function listen(server: net.Server | http.Server, port: number, host: string) {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

function frame(text: string, columns: number): string {
  const bar = `+${'-'.repeat(columns)}+`;
  const body = text
    .split('\n')
    .map((l) => `|${l.padEnd(columns)}|`)
    .join('\n');
  return `${bar}\n${body}\n${bar}`;
}

export async function startEmulator(
  options: EmulatorOptions = {},
): Promise<Emulator> {
  const host = options.host ?? '0.0.0.0';
  const columns = options.columns ?? 48;
  const idleMs = options.idleMs ?? 1500;
  const outDir = options.outDir ?? path.join(__dirname, 'out');
  const log = (msg: string): void => {
    if (!options.quiet) {
      console.log(msg);
    }
  };
  const jobs: Job[] = [];
  let nextId = 1;
  fs.mkdirSync(outDir, { recursive: true });

  const finish = (chunks: Buffer[]): void => {
    const data = Buffer.concat(chunks);
    if (data.length === 0) {
      return;
    }
    const parsed = parseEscpos(data, columns);
    const id = nextId++;
    const receivedAt = new Date().toISOString();
    const text = renderText(parsed);
    jobs.push({ id, receivedAt, bytes: data.length, text, parsed });
    if (jobs.length > MAX_JOBS) {
      jobs.shift();
    }
    const base = `${String(id).padStart(4, '0')}-${receivedAt.replace(/[:.]/g, '-')}`;
    fs.writeFileSync(path.join(outDir, `${base}.bin`), data);
    fs.writeFileSync(
      path.join(outDir, `${base}.html`),
      renderPageHtml(
        `Job ${id}`,
        `<div class="meta">job ${id} - ${receivedAt} - ${data.length} bytes</div>${renderPaperHtml(parsed)}`,
      ),
    );
    log(`\njob #${id}  ${receivedAt}  ${data.length} bytes`);
    log(frame(text, columns));
    for (const w of parsed.warnings) {
      log(`warning: ${w}`);
    }
  };

  const sockets = new Set<net.Socket>();
  const tcp = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let chunks: Buffer[] = [];
    let size = 0;
    const flush = (): void => {
      const pending = chunks;
      chunks = [];
      size = 0;
      finish(pending);
    };
    socket.setTimeout(idleMs);
    socket.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_JOB_BYTES) {
        socket.destroy();
        return;
      }
      chunks.push(chunk);
    });
    socket.on('timeout', flush);
    socket.on('end', flush);
    socket.on('close', flush);
    socket.on('error', () => undefined);
  });

  const web = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (req.method === 'DELETE' && url === '/jobs') {
      jobs.length = 0;
      res.writeHead(204).end();
      return;
    }
    if (url === '/jobs.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify(
          jobs.map((j) => ({
            id: j.id,
            receivedAt: j.receivedAt,
            bytes: j.bytes,
            text: j.text,
          })),
        ),
      );
      return;
    }
    if (url === '/jobs/last.txt') {
      const last = jobs[jobs.length - 1];
      res.writeHead(last ? 200 : 404, {
        'content-type': 'text/plain; charset=utf-8',
      });
      res.end(last?.text ?? '');
      return;
    }
    if (url !== '/') {
      res.writeHead(404).end();
      return;
    }
    const body = jobs.length
      ? [...jobs]
          .reverse()
          .map(
            (j) =>
              `<div class="job"><div class="meta">#${j.id} - ${escapeHtml(j.receivedAt)} - ${j.bytes} bytes</div>${renderPaperHtml(j.parsed)}</div>`,
          )
          .join('')
      : '<p>No jobs received yet.</p>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      renderPageHtml(
        'ESC/POS emulator',
        `<h1>ESC/POS emulator - ${jobs.length} job(s)</h1>${body}`,
        '<meta http-equiv="refresh" content="3">',
      ),
    );
  });

  const port = await listen(tcp, options.port ?? 9100, host);
  const httpPort = await listen(web, options.httpPort ?? 9101, '127.0.0.1');
  log(`ESC/POS emulator: tcp ${host}:${port}, http://127.0.0.1:${httpPort}`);
  log(`columns ${columns}, output ${outDir}`);

  return {
    port,
    httpPort,
    jobs,
    close: () =>
      new Promise<void>((resolve) => {
        tcp.close();
        web.closeAllConnections();
        web.close(() => resolve());
        sockets.forEach((s) => s.destroy());
      }),
  };
}

if (require.main === module) {
  const { values } = parseArgs({
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      'http-port': { type: 'string' },
      columns: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const env = process.env;
  startEmulator({
    host: values.host ?? env.ESCPOS_EMULATOR_HOST,
    port: Number(values.port ?? env.ESCPOS_EMULATOR_PORT ?? 9100),
    httpPort: Number(
      values['http-port'] ?? env.ESCPOS_EMULATOR_HTTP_PORT ?? 9101,
    ),
    columns: Number(values.columns ?? env.ESCPOS_EMULATOR_COLUMNS ?? 48),
    outDir: values.out ?? env.ESCPOS_EMULATOR_OUT,
  }).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
