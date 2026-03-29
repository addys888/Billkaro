import { createInvoice } from './src/services/invoice.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function test() {
  try {
    const user = await prisma.user.findFirst({ where: { phone: '917905355538' } });
    if (!user) return console.error('User not found');
    
    console.log('Testing createInvoice for user:', user.id);
    
    const result = await createInvoice({
      userId: user.id,
      clientName: 'Rahul',
      amount: 500,
      items: [{ name: 'TV fix', quantity: 1, rate: 500 }]
    });
    
    console.log('Success:', result);
  } catch (error: any) {
    console.error('FAILED TO CREATE INVOICE:');
    console.error(error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

test();
