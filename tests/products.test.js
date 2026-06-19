const assert = require('assert');
const products = require('../products.json');

function testProductsStructure() {
  assert(Array.isArray(products), 'products should be an array');
  assert(products.length > 0, 'should have at least one product');

  for (const p of products) {
    assert(p.id, `product ${p.name} should have an id`);
    assert(p.name, `product ${p.id} should have a name`);
    assert(p.desc, `product ${p.id} should have a description`);
    assert(p.prefix, `product ${p.id} should have a prefix`);
    assert(p.type, `product ${p.id} should have a type`);
    assert(['main', 'tool'].includes(p.type), `product ${p.id} type should be main or tool`);

    if (p.type === 'main') {
      assert(p.monthly, `product ${p.id} should have monthly price`);
      assert(p.yearly, `product ${p.id} should have yearly price`);
    } else {
      assert(p.price, `product ${p.id} should have a price`);
    }
  }
  console.log(`  ✓ ${products.length} products all valid`);
}

function testProductIdsUnique() {
  const ids = products.map(p => p.id);
  const unique = new Set(ids);
  assert(unique.size === ids.length, 'product ids must be unique');
  console.log('  ✓ All product IDs unique');
}

function testProductPrefixesUnique() {
  const prefixes = products.map(p => p.prefix);
  const unique = new Set(prefixes);
  assert(unique.size === prefixes.length, 'product prefixes must be unique');
  console.log('  ✓ All product prefixes unique');
}

testProductsStructure();
testProductIdsUnique();
testProductPrefixesUnique();
