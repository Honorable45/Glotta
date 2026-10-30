import PDFDocument from 'pdfkit';

export interface ReceiptData {
  number: number;
  status: string;
  paidAt: Date | null;
  statusReason: string | null;
  vendor: { name: string; address: string; phone: string; email: string };
  customer: { name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null };
  description: string;
  licenseHint: string;
  majorVersion: number;
  amount: number;
  paymentMethod: string | null;
  paymentReference: string | null;
}

// pdfkit ne connaît pas l'espace fine utilisée par Intl en français.
const fcfa = (value: number) => `${new Intl.NumberFormat('fr-FR').format(value).replace(/\s/g, ' ')} FCFA`;
const day = (value: Date | null) => (value ? value.toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '');
export const receiptNumber = (number: number) => `R-${String(number).padStart(6, '0')}`;

export function buildReceipt(data: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Reçu ${receiptNumber(data.number)}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const line = (label: string, value: string | null) => {
      if (!value) return;
      doc.font('Helvetica').fillColor('#555555').text(`${label} : `, { continued: true }).fillColor('#111111').text(value);
    };

    if (data.vendor.name) doc.font('Helvetica-Bold').fontSize(14).text(data.vendor.name);
    doc.font('Helvetica').fontSize(10);
    for (const value of [data.vendor.address, data.vendor.phone, data.vendor.email]) if (value) doc.text(value);
    doc.moveDown(2);

    doc.font('Helvetica-Bold').fontSize(18).text(`Reçu ${receiptNumber(data.number)}`);
    doc.font('Helvetica').fontSize(10).text(`Date du paiement : ${day(data.paidAt)}`);
    if (data.status === 'REFUNDED') {
      doc.moveDown(0.5).font('Helvetica-Bold').fillColor('#B00020').text(`REMBOURSÉ${data.statusReason ? ` : ${data.statusReason}` : ''}`).fillColor('#111111');
    }
    doc.moveDown(1.5);

    doc.font('Helvetica-Bold').fontSize(11).text('Client');
    doc.fontSize(10);
    doc.font('Helvetica').text(data.customer.name);
    for (const value of [data.customer.contactName, data.customer.phone, data.customer.email, data.customer.address]) if (value) doc.text(value);
    doc.moveDown(1.5);

    doc.font('Helvetica-Bold').fontSize(11).text('Détail');
    doc.fontSize(10);
    line('Désignation', data.description);
    line('Licence', `se terminant par ${data.licenseHint}`);
    line('Versions couvertes', `jusqu'à la version ${data.majorVersion}.x`);
    line('Mode de paiement', data.paymentMethod);
    line('Référence', data.paymentReference);
    doc.moveDown(1.5);

    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111111').text(`Montant payé : ${fcfa(data.amount)}`);
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(9).fillColor('#555555').text("Licence perpétuelle, sans expiration. Les corrections et améliorations mineures sont gratuites ; les grandes versions peuvent être vendues séparément.");
    doc.end();
  });
}
