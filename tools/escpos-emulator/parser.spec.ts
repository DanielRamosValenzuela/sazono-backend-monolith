import { parseEscpos, renderText } from './parser';
import { buildSampleTicket, SAMPLE_EXPECTED } from './sample';
import { startEmulator } from './emulator';
import * as net from 'node:net';
import * as os from 'node:os';

const text = (bytes: number[], columns = 32) =>
  renderText(parseEscpos(Uint8Array.from(bytes), columns));

describe('escpos parser', () => {
  it('decodes CP858 accents', () => {
    expect(text([0xa4, 0xa5, 0xa8, 0xad, 0xa0, 0x82, 0xd5, 0x81])).toBe(
      'ñÑ¿¡aé€ü'.replace('a', 'á'),
    );
  });

  it('decodes windows-1252 when ESC t 16 is selected', () => {
    expect(text([0x1b, 0x74, 16, 0xf1, 0xd1])).toBe('ñÑ');
  });

  it('centers double size text by display width', () => {
    const bytes = [0x1b, 0x61, 1, 0x1d, 0x21, 0x11, 0x41, 0x42, 0x0a];
    const job = parseEscpos(Uint8Array.from(bytes), 10);
    expect(renderText(job)).toBe('   AB');
    const row = job.rows[0];
    expect(row.kind === 'text' && row.cells[0]).toMatchObject({ w: 2, h: 2 });
  });

  it('tracks bold and resets on ESC @', () => {
    const job = parseEscpos(
      Uint8Array.from([0x1b, 0x45, 1, 0x41, 0x1b, 0x40, 0x42, 0x0a]),
    );
    const row = job.rows[0];
    expect(row.kind === 'text' && row.cells.map((c) => c.bold)).toEqual([
      true,
      false,
    ]);
  });

  it('right aligns and wraps past the column count', () => {
    expect(text([0x1b, 0x61, 2, 0x41, 0x42, 0x0a], 4)).toBe('  AB');
    expect(text([0x41, 0x42, 0x43, 0x44, 0x45], 4)).toBe('ABCD\nE');
  });

  it('does not add a blank row for a full line followed by LF', () => {
    expect(text([0x41, 0x42, 0x0a], 2)).toBe('AB');
  });

  it('handles cut variants and the drawer pulse', () => {
    const job = parseEscpos(
      Uint8Array.from([
        0x1d, 0x56, 0, 0x1d, 0x56, 66, 3, 0x1b, 0x70, 0, 25, 250, 0x41, 0x0a,
      ]),
    );
    expect(job.rows).toEqual([
      { kind: 'cut', partial: false },
      { kind: 'cut', partial: true },
      { kind: 'drawer' },
      expect.objectContaining({ kind: 'text' }),
    ]);
    expect(job.warnings).toEqual([]);
  });

  it('reports unknown commands without throwing', () => {
    const job = parseEscpos(Uint8Array.from([0x1b, 0x99, 0x41, 0x0a]));
    expect(job.warnings).toHaveLength(1);
    expect(renderText(job)).toBe('A');
  });

  it('parses the owner reference ticket', () => {
    expect(renderText(parseEscpos(buildSampleTicket(), 32))).toBe(
      SAMPLE_EXPECTED,
    );
  });
});

describe('emulator server', () => {
  it('receives a job over TCP and lists it over HTTP', async () => {
    const emu = await startEmulator({
      port: 0,
      httpPort: 0,
      columns: 32,
      quiet: true,
      outDir: os.tmpdir() + '/escpos-emulator-spec',
    });
    try {
      await new Promise<void>((resolve) => {
        const s = net.connect(emu.port, '127.0.0.1', () =>
          s.end(buildSampleTicket()),
        );
        s.on('close', () => resolve());
      });
      const res = await fetch(`http://127.0.0.1:${emu.httpPort}/jobs/last.txt`);
      expect(await res.text()).toBe(SAMPLE_EXPECTED);
    } finally {
      await emu.close();
    }
  });
});
