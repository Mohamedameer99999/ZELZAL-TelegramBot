const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function testInvoiceGeneration() {
  const invoice = require('../invoice.js');
  const payment = {
    id: 999,
    payment_ref: 'TEST_REF_001',
    product_id: 'zelzal-pro',
    amount: 300,
    created_at: new Date().toISOString(),
    customer_name: 'مستخدم اختبار',
    phone: '01000000000',
    email: 'test@example.com'
  };
  const licenseKey = 'TEST-KEY-12345-VALID-SIG';
  const result = await invoice.createInvoice(payment, licenseKey);
  assert(result.filePath, 'should return file path');
  assert(fs.existsSync(result.filePath), 'invoice file should exist');
  assert(result.invoiceNum, 'should return invoice number');
  const stats = fs.statSync(result.filePath);
  assert(stats.size > 1000, 'invoice PDF should be larger than 1KB');
  console.log(`  ✓ Invoice PDF created: ${result.invoiceNum} (${(stats.size / 1024).toFixed(1)} KB)`);
  // Cleanup
  fs.unlinkSync(result.filePath);
}

testInvoiceGeneration().catch(e => { console.error('  ✗', e.message); process.exit(1); });
