/**
 * Quick test: Generate a sample PDF invoice and open it
 */
const path = require('path');
const fs = require('fs');

async function main() {
  const { generateInvoicePDF } = require('./dist/services/pdf.service');

  const testData = {
    invoiceNo: 'BK-TEST-COMPACT',
    createdAt: new Date(),
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    businessName: 'Mindzvue Technology LLP',
    businessAddress: 'B12, Hemanth Square Building, IT Park, Nagpur, MH, India, 223123',
    businessGstin: 'AHAHEIE8SHO8SKS',
    businessPhone: '919452661608',
    businessUpiId: '9452661608@ybl',
    clientName: 'Rahuuu',
    clientPhone: '919888888888',
    lineItems: [
      { name: 'AC Fix', quantity: 1, rate: 567, amount: 567 },
    ],
    subtotal: 567,
    gstRate: 18,
    gstAmount: 102.06,
    totalAmount: 669.06,
    notes: 'Test invoice — compact layout',
    status: 'PENDING',
  };

  console.log('Generating PDF...');
  const buffer = await generateInvoicePDF(testData);
  
  const outPath = path.join(__dirname, 'tmp', 'test-compact.pdf');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);
  
  console.log(`✅ PDF generated: ${outPath} (${(buffer.length / 1024).toFixed(1)}KB)`);
  console.log(`Pages: Should be exactly 1 page for this single-item invoice`);
}

main().catch(console.error);
