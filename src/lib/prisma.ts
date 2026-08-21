import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { siteopsPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.siteopsPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn']
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.siteopsPrisma = prisma;
}

export default prisma;
