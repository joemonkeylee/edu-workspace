import 'dotenv/config';
import prisma from './prisma.js';
import { hashPassword } from './services/auth.js';

async function main() {
  const phone = '18937900499';
  const password = '123456';

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    console.log('User already exists, updating password...');
    await prisma.user.update({
      where: { phone },
      data: { password: await hashPassword(password), isAdmin: true },
    });
  } else {
    await prisma.user.create({
      data: {
        phone,
        password: await hashPassword(password),
        isAdmin: true,
        nickName: 'Admin',
        maxDevices: 3,
      },
    });
  }

  console.log('Seed complete: admin user', phone);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
