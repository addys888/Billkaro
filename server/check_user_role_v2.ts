import { prisma } from './src/db/prisma';

async function check() {
  const phone = '919452661608';
  const user = await prisma.user.findUnique({ where: { phone } });
  console.log('USER_CHECK:', JSON.stringify(user, null, 2));
}

check().catch(console.error).finally(() => prisma.$disconnect());
