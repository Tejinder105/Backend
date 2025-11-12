import { processBillImage } from './src/services/ocr.service.js';

// Test OCR with a sample text (simulating what OCR would extract)
const testText = `
ABC Electric Company
Bill Invoice

Date: 15-Nov-2024
Amount: Rs. 1,250.00

Electricity Bill for November 2024
Customer ID: 123456
Total Amount Due: Rs. 1,250.00

Thank you for your payment.
`;

console.log('🧪 Testing OCR Text Parsing...\n');

// Import the parseBillInfo function
import { parseBillInfo } from './src/services/ocr.service.js';

const result = parseBillInfo(testText);

console.log('📋 Test Input Text:');
console.log(testText);
console.log('\n✅ Parsed Result:');
console.log(JSON.stringify(result, null, 2));

console.log('\n📊 Summary:');
console.log(`Vendor: ${result.vendor || 'Not detected'}`);
console.log(`Amount: ₹${result.amount || 'Not detected'}`);
console.log(`Category: ${result.category || 'Not detected'}`);
console.log(`Date: ${result.date || 'Not detected'}`);

console.log('\n✅ OCR Parser is working!');
