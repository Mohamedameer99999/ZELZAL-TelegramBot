const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const products = require('./products.json');

const INVOICE_DIR = path.join(__dirname, 'invoices');

function ensureDir() {
  if (!fs.existsSync(INVOICE_DIR)) fs.mkdirSync(INVOICE_DIR, { recursive: true });
}

function generateInvoiceNumber(payment) {
  return 'INV-' + (payment.id || Date.now()) + '-' + (payment.payment_ref || '').substring(0, 8);
}

function createInvoice(payment, licenseKey) {
  ensureDir();
  const prod = products.find(p => p.id === payment.product_id);
  const invoiceNum = generateInvoiceNumber(payment);
  const filePath = path.join(INVOICE_DIR, invoiceNum + '.pdf');
  const amount = payment.amount || 0;
  const date = new Date(payment.created_at || Date.now());

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Brand color
      const primary = '#00f5a0';
      const dark = '#1a1a2e';
      const gray = '#666';

      // Header
      doc.rect(0, 0, doc.page.width, 120).fill(dark);
      doc.fontSize(28).fillColor(primary).font('Helvetica-Bold').text('ZELZAL SECURITY', { align: 'center' });
      doc.fontSize(10).fillColor('#fff').text('Cyber Security Solutions', { align: 'center' });

      // Invoice title
      doc.y = 145;
      doc.fontSize(20).fillColor(dark).font('Helvetica-Bold').text('فاتورة / Invoice', { align: 'center' });
      doc.fontSize(10).fillColor(gray).font('Helvetica').text(`رقم الفاتورة: ${invoiceNum}`, { align: 'center' });
      doc.text(`التاريخ: ${date.toLocaleDateString('ar-EG')}`, { align: 'center' });

      // Customer info
      doc.y += 30;
      doc.fontSize(12).fillColor(dark).font('Helvetica-Bold').text('معلومات العميل');
      doc.fontSize(10).fillColor(gray).font('Helvetica');
      doc.text(`👤 ${payment.customer_name || payment.phone || 'N/A'}`);
      if (payment.phone) doc.text(`📞 ${payment.phone}`);
      if (payment.email) doc.text(`✉️ ${payment.email}`);
      doc.text(`🆔 مرجع الدفع: ${payment.payment_ref || 'N/A'}`);

      // Table header
      doc.y += 20;
      const tableTop = doc.y;
      doc.rect(50, tableTop, doc.page.width - 100, 25).fill('#f0f0f0');
      doc.fillColor(dark).font('Helvetica-Bold').fontSize(11);
      doc.text('المنتج', 60, tableTop + 7);
      doc.text('الخطة', 250, tableTop + 7);
      doc.text('المبلغ', 400, tableTop + 7, { width: 100, align: 'right' });

      // Table row
      doc.fillColor('#333').font('Helvetica').fontSize(10);
      const rowY = tableTop + 30;
      doc.text(prod ? prod.name : payment.product_id, 60, rowY);
      const plan = payment.notes && payment.notes.includes('yearly') ? 'سنوي' : 'شهري';
      doc.text(plan, 250, rowY);
      doc.text(`${amount} ج`, 400, rowY, { width: 100, align: 'right' });

      // Total
      const totalY = rowY + 30;
      doc.rect(50, totalY - 5, doc.page.width - 100, 1).fill('#ddd');
      doc.font('Helvetica-Bold').fontSize(12).fillColor(dark);
      doc.text('الإجمالي', 60, totalY + 5);
      doc.text(`${amount} ج`, 400, totalY + 5, { width: 100, align: 'right' });

      // License
      if (licenseKey) {
        doc.y = totalY + 40;
        doc.fontSize(11).fillColor(dark).font('Helvetica-Bold').text('مفتاح الترخيص:');
        doc.fontSize(9).fillColor(gray).font('Helvetica');
        doc.text(licenseKey, { width: doc.page.width - 100 });
      }

      // Footer
      doc.y = doc.page.height - 100;
      doc.fontSize(8).fillColor(gray).font('Helvetica');
      doc.text('ZELZAL Security - جميع الحقوق محفوظة', 50, doc.y, { align: 'center' });
      doc.text('للتواصل: support@zelzal-security.com', { align: 'center' });
      doc.text('هذه فاتورة إلكترونية معتمدة', { align: 'center' });

      doc.end();

      stream.on('finish', () => resolve({ filePath, invoiceNum }));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

function getInvoicePath(invoiceNum) {
  return path.join(INVOICE_DIR, invoiceNum + '.pdf');
}

module.exports = { createInvoice, getInvoicePath, generateInvoiceNumber };
