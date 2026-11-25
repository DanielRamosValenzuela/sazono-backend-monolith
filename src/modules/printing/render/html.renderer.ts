import type { ReceiptDocument } from '../domain/receipt-document';
import { layoutReceipt } from './receipt-layout';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

export type HtmlRenderOptions = {
  columns: number;
  paperWidthMm: number;
  copies?: number;
};

const MONOSPACE_ADVANCE = 0.6;

export function pageWidthPx(paperWidthMm: number): number {
  return Math.round((paperWidthMm * 96) / 25.4);
}

export function receiptFontPx(options: {
  columns: number;
  paperWidthMm: number;
}): number {
  return Math.max(
    Math.floor(
      pageWidthPx(options.paperWidthMm) /
        (Math.max(options.columns, 1) * MONOSPACE_ADVANCE),
    ),
    6,
  );
}

export function receiptCss(options: {
  columns: number;
  paperWidthMm: number;
}): string {
  return [
    `@page{size:${options.paperWidthMm}mm auto;margin:0}`,
    'html,body{margin:0;padding:0;background:#fff;color:#000}',
    `.receipt{width:100%;max-width:${pageWidthPx(options.paperWidthMm)}px;box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,"Courier New",monospace;font-size:${receiptFontPx(options)}px;line-height:1.25;page-break-after:always}`,
    '.row{white-space:pre;overflow:visible}',
    '.center{text-align:center}',
    '.bold{font-weight:700}',
    '.big{font-size:200%;line-height:1.1}',
    '.cut{border-top:1px dashed #000;margin-top:1.5em;height:0}',
  ].join('');
}

export function renderHtmlFragment(
  doc: ReceiptDocument,
  options: HtmlRenderOptions,
): string {
  const copies = Math.max(options.copies ?? doc.copies, 1);
  const rows = layoutReceipt(doc, options.columns)
    .map((line) => {
      if (line.kind === 'cut') {
        return '<div class="cut"></div>';
      }

      const classes = [
        'row',
        line.align === 'center' ? 'center' : '',
        line.bold ? 'bold' : '',
        line.size === 2 ? 'big' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const text = line.kind === 'qr' ? `[QR] ${line.text}` : line.text;

      return `<div class="${classes}">${escapeHtml(text) || '&nbsp;'}</div>`;
    })
    .join('');

  return Array.from(
    { length: copies },
    () => `<div class="receipt">${rows}</div>`,
  ).join('');
}

export function renderHtmlDocument(
  doc: ReceiptDocument,
  options: HtmlRenderOptions,
): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(doc.header.number)}</title>`,
    `<style>${receiptCss(options)}</style>`,
    `</head><body>${renderHtmlFragment(doc, options)}</body></html>`,
  ].join('');
}
