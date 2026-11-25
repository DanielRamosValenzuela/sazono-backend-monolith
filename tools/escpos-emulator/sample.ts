export const SAMPLE_COLUMNS = 32;

const LF = 0x0a;
const dots = '.'.repeat(SAMPLE_COLUMNS);

export const SAMPLE_EXPECTED = [
  '   *** pizza ***',
  '         #01-023',
  '25/11/2026 14:32          MESA 7',
  'CAJERO, JUANITA',
  'Cliente: Pedro',
  dots,
  'NOTA PEDIDO: sin sal en todo',
  dots,
  '1 x Pizza 3 quesos',
  '     Masa > Delgada',
  '     * sin oregano',
  '2 x pizza hawaiana',
  '     Extra > Queso',
  dots,
  '',
  '',
  '',
  '-------- corte parcial ---------',
].join('\n');

export function buildSampleTicket(): Buffer {
  const out: number[] = [];
  const raw = (...b: number[]): void => {
    out.push(...b);
  };
  const line = (s: string): void => {
    out.push(...Buffer.from(s, 'latin1'), LF);
  };
  raw(0x1b, 0x40, 0x1b, 0x74, 19);
  raw(0x1b, 0x61, 1, 0x1d, 0x21, 0x11, 0x1b, 0x45, 1);
  line('*** pizza ***');
  line('#01-023');
  raw(0x1d, 0x21, 0x00, 0x1b, 0x45, 0, 0x1b, 0x61, 0);
  line('25/11/2026 14:32          MESA 7');
  line('CAJERO, JUANITA');
  line('Cliente: Pedro');
  line(dots);
  raw(0x1b, 0x45, 1);
  line('NOTA PEDIDO: sin sal en todo');
  raw(0x1b, 0x45, 0);
  line(dots);
  line('1 x Pizza 3 quesos');
  line('     Masa > Delgada');
  line('     * sin oregano');
  line('2 x pizza hawaiana');
  line('     Extra > Queso');
  line(dots);
  raw(LF, LF, LF, 0x1d, 0x56, 1);
  return Buffer.from(out);
}
