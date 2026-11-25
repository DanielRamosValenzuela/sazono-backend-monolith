export type CodepageName = 'cp858' | 'cp850' | 'cp437' | 'windows1252';

export const SUPPORTED_CODEPAGES: CodepageName[] = [
  'cp858',
  'cp850',
  'cp437',
  'windows1252',
];

export const ESC_T_IDS: Record<CodepageName, number> = {
  cp437: 0,
  cp850: 2,
  windows1252: 16,
  cp858: 19,
};

const DOS_COMMON: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  ç: 0x87,
  ê: 0x88,
  ë: 0x89,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  ì: 0x8d,
  É: 0x90,
  ô: 0x93,
  ö: 0x94,
  ò: 0x95,
  û: 0x96,
  ù: 0x97,
  Ü: 0x9a,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ª: 0xa6,
  º: 0xa7,
  '¿': 0xa8,
  '¡': 0xad,
  '°': 0xf8,
};

const DOS_850_EXTRA: Record<string, number> = {
  Á: 0xb5,
  Í: 0xd6,
  Ó: 0xe0,
  Ú: 0xe9,
};

const TABLES: Record<CodepageName, Map<string, number>> = {
  cp437: new Map(Object.entries(DOS_COMMON)),
  cp850: new Map(Object.entries({ ...DOS_COMMON, ...DOS_850_EXTRA })),
  cp858: new Map(
    Object.entries({ ...DOS_COMMON, ...DOS_850_EXTRA, '€': 0xd5 }),
  ),
  windows1252: new Map(),
};

export function isCodepageName(value: string): value is CodepageName {
  return (SUPPORTED_CODEPAGES as string[]).includes(value);
}

function encodeChar(char: string, codepage: CodepageName): number {
  const code = char.codePointAt(0) ?? 0x3f;

  if (code >= 0x20 && code <= 0x7e) {
    return code;
  }

  if (codepage === 'windows1252') {
    if (char === '€') {
      return 0x80;
    }

    if (code >= 0xa0 && code <= 0xff) {
      return code;
    }
  } else {
    const mapped = TABLES[codepage].get(char);

    if (mapped !== undefined) {
      return mapped;
    }
  }

  const stripped = char.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const strippedCode = stripped.codePointAt(0) ?? 0x3f;

  return stripped.length === 1 && strippedCode >= 0x20 && strippedCode <= 0x7e
    ? strippedCode
    : 0x3f;
}

export function encodeText(text: string, codepage: CodepageName): number[] {
  return Array.from(text, (char) => encodeChar(char, codepage));
}
