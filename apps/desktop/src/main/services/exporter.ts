import type { Report } from '@gestion/contracts';
import { formatAmount, formatQuantity } from '@gestion/domain';
import { escapeHtml } from './receipt';

function display(value: string | bigint | undefined, kind: string, currency: string): string {
  if (typeof value !== 'bigint') return value ?? '';
  return kind === 'money' ? formatAmount(value, currency) : formatQuantity(value);
}

/** Une cellule commençant par = + - @ serait exécutée comme formule à l'ouverture dans un tableur. */
export function protectFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function reportToCsv(report: Report, currency: string): string {
  const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
  const cell = (value: string | bigint | undefined, kind: string) => {
    // Les nombres restent bruts pour rester exploitables ; seul le texte saisi est protégé.
    if (typeof value === 'bigint') return kind === 'money' ? formatAmount(value, currency).replace(/[  ]/g, ' ') : formatQuantity(value);
    return quote(protectFormula(value ?? ''));
  };
  const rows = [...report.rows, ...(report.totals ? [report.totals] : [])];
  const lines = [
    report.columns.map((column) => quote(column.label)).join(';'),
    ...rows.map((row) => report.columns.map((column) => cell(row[column.key], column.kind)).join(';')),
  ];
  // BOM : Excel lit alors correctement les accents.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function reportToHtml(report: Report, currency: string, companyName: string, periodLabel: string): string {
  const cells = (row: Report['rows'][number], tag: string) =>
    report.columns
      .map((column) => `<${tag}${column.kind === 'text' ? '' : ' class="r"'}>${escapeHtml(display(row[column.key], column.kind, currency))}</${tag}>`)
      .join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title><style>
body{font:11px/1.4 Arial,sans-serif;color:#111;margin:0}h1{font-size:17px;margin:0}p{margin:2px 0 12px;color:#555}
table{width:100%;border-collapse:collapse}th,td{padding:5px 6px;border-bottom:1px solid #ddd;text-align:left}th{font-size:10px;color:#555}
.r{text-align:right;white-space:nowrap}tfoot td{font-weight:bold;border-top:1.5px solid #111;border-bottom:0}
</style></head><body><h1>${escapeHtml(report.title)}</h1><p>${escapeHtml(companyName)} · ${escapeHtml(periodLabel)}</p>
<table><thead><tr>${report.columns.map((column) => `<th${column.kind === 'text' ? '' : ' class="r"'}>${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
<tbody>${report.rows.map((row) => `<tr>${cells(row, 'td')}</tr>`).join('')}</tbody>
${report.totals ? `<tfoot><tr>${cells(report.totals, 'td')}</tr></tfoot>` : ''}</table></body></html>`;
}

export async function reportToXlsx(report: Report, currency: string): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs');
  const decimals = currency === 'EUR' || currency === 'USD' ? 2 : 0;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(report.title.slice(0, 31));
  sheet.columns = report.columns.map((column) => ({ header: column.label, key: column.key, width: column.kind === 'text' ? 28 : 16 }));
  sheet.getRow(1).font = { bold: true };
  const rows = [...report.rows, ...(report.totals ? [report.totals] : [])];
  for (const row of rows) {
    const added = sheet.addRow(
      Object.fromEntries(
        report.columns.map((column) => {
          const value = row[column.key];
          if (typeof value !== 'bigint') return [column.key, protectFormula(value ?? '')];
          return [column.key, Number(value) / (column.kind === 'money' ? 10 ** decimals : 1000)];
        }),
      ),
    );
    if (row === report.totals) added.font = { bold: true };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
