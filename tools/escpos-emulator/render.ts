import type { ParsedJob } from './parser';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const PAPER_CSS = `
.paper{background:#fff;color:#111;font:14px/1.25 "Courier New",monospace;padding:12px 8px;box-shadow:0 1px 6px rgba(0,0,0,.35);margin:0 auto 4px}
.row{white-space:pre;min-height:1.25em;overflow:hidden}
.cut{border-top:2px dashed #888;margin:10px 0 0;text-align:center;font-size:11px;color:#666;padding-top:2px;font-family:sans-serif}
.drawer{color:#666;text-align:center;font-size:11px;font-family:sans-serif}
`;

export function renderPaperHtml(job: ParsedJob): string {
  const rows = job.rows
    .map((row) => {
      if (row.kind === 'cut') {
        return `<div class="cut">&#9988; ${row.partial ? 'partial cut' : 'cut'}</div>`;
      }
      if (row.kind === 'drawer') {
        return '<div class="drawer">[cash drawer pulse]</div>';
      }
      const size = Math.max(...row.cells.map((c) => Math.max(c.w, c.h)), 1);
      const spans = row.cells
        .map((c) =>
          c.bold || c.w > 1 || c.h > 1
            ? `<b>${escapeHtml(c.ch)}</b>`
            : escapeHtml(c.ch),
        )
        .join('');
      return `<div class="row" style="text-align:${row.align};font-size:${size}em">${spans || ' '}</div>`;
    })
    .join('');
  return `<div class="paper" style="width:${job.columns}ch">${rows}</div>`;
}

export function renderPageHtml(title: string, body: string, head = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>${head}<style>body{background:#d8d8d8;margin:0;padding:16px;font-family:sans-serif}h1{font-size:18px}.job{margin:0 auto 28px;max-width:100%;overflow-x:auto}.meta{text-align:center;font-size:12px;color:#444;margin-bottom:6px}${PAPER_CSS}</style></head><body>${body}</body></html>`;
}
