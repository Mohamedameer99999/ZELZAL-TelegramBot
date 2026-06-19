const path = require('path');
const fs = require('fs');

const testsDir = __dirname;
const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.js')).sort();
let passed = 0;
let failed = 0;

console.log('='.repeat(50));
console.log('  ZELZAL Unit Tests');
console.log('='.repeat(50));
console.log();

for (const file of files) {
  console.log(`📋 ${file}...`);
  try {
    require(path.join(testsDir, file));
    console.log(`  ✅ PASS`);
    passed++;
  } catch (e) {
    console.log(`  ❌ FAIL: ${e.message}`);
    failed++;
  }
  console.log();
}

console.log('='.repeat(50));
console.log(`  نتائج: ${passed} نجاح | ${failed} فشل | ${files.length} إجمالي`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
