import prisma from './src/lib/prisma';
import ProductModel from './src/models/Product';

// Simple unit assertion framework
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[FAIL] Assertion Failed: ${message}`);
  }
  console.log(`[PASS] ${message}`);
}

async function runTests() {
  console.log('--- STARTING COMPATIBILITY TESTS ---');

  // Test 1: Check query builder chain exports
  try {
    const query = ProductModel.find({});
    assert(typeof query.sort === 'function', 'Query builder exposes sort()');
    assert(typeof query.lean === 'function', 'Query builder exposes lean()');
    assert(typeof query.skip === 'function', 'Query builder exposes skip()');
    assert(typeof query.limit === 'function', 'Query builder exposes limit()');
    assert(typeof query.then === 'function', 'Query builder exposes then()');
  } catch (err: any) {
    console.error('Test 1 failed with error:', err.message);
    process.exit(1);
  }

  // Test 2: Check model instantiation and mapping
  try {
    const rawData = {
      id: 'p1',
      name: 'Seer Fish',
      slug: 'seer-fish',
      description: 'Premium seer fish slice',
      price: 499,
      category: 'Fish',
      quantity: 15,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const instance = new ProductModel(rawData);
    assert(instance._id === 'p1', 'ProductModel sets id/_id correctly');
    assert(instance.name === 'Seer Fish', 'ProductModel sets name correctly');
    assert(instance.price === 499, 'ProductModel sets price correctly');
    assert(instance.quantity === 15, 'ProductModel sets quantity correctly');
  } catch (err: any) {
    console.error('Test 2 failed with error:', err.message);
    process.exit(1);
  }

  console.log('--- COMPATIBILITY TESTS COMPLETED SUCCESSFULLY ---');
}

runTests();
