import type { Company, SaleDetail } from '@gestion/contracts';
import { formatAmount, formatQuantity } from '@gestion/domain';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);

export function buildReceiptHtml({ sale, company, format }: { sale: SaleDetail; company: Company; format: 'thermal' | 'a4' }): string {
  const money = (value: bigint) => escapeHtml(formatAmount(value, company.currency));
  const row = (label: string, value: string, strong = false) =>
    `<tr${strong ? ' class="strong"' : ''}><td>${escapeHtml(label)}</td><td class="r">${value}</td></tr>`;
  const lines = sale.lines
    .map((line) => {
      const name = [line.productName, line.variantLabel].filter(Boolean).join(' ');
      const serials = line.serials.length ? `<div class="s">${escapeHtml(line.serials.map((item) => item.serial).join(', '))}</div>` : '';
      return `<tr><td>${escapeHtml(name)}${serials}<div class="s">${escapeHtml(formatQuantity(line.quantity))} × ${money(line.unitPrice)}</div></td><td class="r">${money(line.lineTotal)}</td></tr>`;
    })
    .join('');
  const payments = sale.payments
    .map((payment) => row(`${payment.kind === 'REFUND' ? 'Remboursement' : 'Paiement'} ${payment.methodName}`, money(payment.amount)))
    .join('');
  const remaining = sale.netTotal - sale.netPaid;
  const width = format === 'thermal' ? '72mm' : '180mm';
  const page = format === 'thermal' ? '80mm auto' : 'A4';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(sale.number)}</title><style>
@page{size:${page};margin:${format === 'thermal' ? '3mm' : '15mm'}}
body{font:${format === 'thermal' ? '11px' : '13px'}/1.35 Arial,sans-serif;color:#000;width:${width};margin:0}
h1{font-size:1.3em;margin:0}img{max-height:60px;max-width:60%;display:block;margin-bottom:4px}
.c{text-align:${format === 'thermal' ? 'center' : 'left'}}.c img{${format === 'thermal' ? 'margin-inline:auto' : ''}}
table{width:100%;border-collapse:collapse;margin-top:8px}td{padding:2px 0;vertical-align:top}.r{text-align:right;white-space:nowrap;padding-left:8px}
.s{font-size:.88em;color:#333}.strong td{font-weight:bold;font-size:1.1em;border-top:1px solid #000;padding-top:4px}
hr{border:0;border-top:1px dashed #000;margin:8px 0}
</style></head><body><div class="c">${company.logoData ? `<img src="${company.logoData}" alt="">` : ''}<h1>${escapeHtml(company.name)}</h1>
<div>${escapeHtml(company.address)}</div><div>${escapeHtml(company.phone)}</div>${company.email ? `<div>${escapeHtml(company.email)}</div>` : ''}${company.taxInfo ? `<div class="s">${escapeHtml(company.taxInfo)}</div>` : ''}</div><hr>
<div>${format === 'thermal' ? 'Reçu' : 'Facture'} ${escapeHtml(sale.number)}</div><div>${escapeHtml(new Date(sale.occurredAt).toLocaleString('fr-FR'))}</div>
${sale.customerName ? `<div>Client : ${escapeHtml(sale.customerName)}</div>` : ''}${sale.status === 'CANCELLED' ? '<div><strong>VENTE ANNULÉE</strong></div>' : ''}
<table>${lines}</table><table>${sale.discount > 0n ? row('Sous-total', money(sale.subtotal)) + row('Remise', money(sale.discount)) : ''}${sale.returns.length ? row('Retours', money(sale.total - sale.netTotal)) : ''}${row('Total', money(sale.netTotal), true)}${sale.tax > 0n ? row('Dont taxes', money(sale.tax)) : ''}${payments}${remaining > 0n ? row('Reste à payer', money(remaining), true) : ''}</table>
<hr><div class="c">Merci de votre confiance.</div></body></html>`;
}
