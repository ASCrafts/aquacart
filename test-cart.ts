import prisma from './src/lib/prisma';
import UserModel from './src/models/User';

async function testCart() {
  console.log('--- STARTING ADDRESS SERIALIZATION DIAGNOSTIC ---');
  try {
    // 1. Fetch first user in database
    const userDb = await prisma.user.findFirst();
    if (!userDb) {
      console.log('[DIAGNOSTIC] No users found in database to test.');
      return;
    }

    // 2. Add an address to database for the user
    console.log('[DIAGNOSTIC] Simulating address creation...');
    await prisma.address.deleteMany({ where: { userId: userDb.id } });
    await prisma.address.create({
      data: {
        userId: userDb.id,
        street: '123 Marine Way',
        city: 'Charlotte',
        state: 'NC',
        zipCode: '28202',
        isDefault: true
      }
    });

    // 3. Query user
    const user = await UserModel.findById(userDb.id);
    if (!user) {
      console.log('[DIAGNOSTIC] UserModel.findById returned null.');
      return;
    }

    // 4. Serialize user.addresses and print results
    console.log('[DIAGNOSTIC] UserModel query success.');
    const serialized = JSON.stringify(user.addresses, null, 2);
    console.log('[DIAGNOSTIC] Serialized user.addresses output:\n', serialized);
    console.log('--- DIAGNOSTIC COMPLETED SUCCESSFULLY ---');
  } catch (error: any) {
    console.error('====================================================');
    console.error('[DIAGNOSTIC] CRITICAL ERROR THROWN DURING FETCH:');
    console.error(error);
    console.error('====================================================');
  }
}

testCart();
