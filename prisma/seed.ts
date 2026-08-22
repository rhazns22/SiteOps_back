import bcrypt from 'bcrypt';
import { PrismaClient, Priority } from '@prisma/client';

const prisma = new PrismaClient();

const requiredSeedAdminValues = ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_ADMIN_NAME'] as const;

const getOptionalSeedAdmin = () => {
  const values = requiredSeedAdminValues.map((key) => process.env[key]?.trim() ?? '');
  if (values.every(Boolean)) {
    const [email, password, name] = values;
    return { email, password, name };
  }

  if (values.some(Boolean)) {
    throw new Error(`${requiredSeedAdminValues.join(', ')} must be provided together.`);
  }

  return null;
};

async function main() {
  await prisma.workspaceSetting.upsert({
    where: { id: 'workspace' },
    update: {},
    create: {
      id: 'workspace',
      serviceName: process.env.SEED_WORKSPACE_NAME?.trim() || 'SiteOps',
      defaultDueDays: Number(process.env.SEED_DEFAULT_DUE_DAYS || 7),
      defaultPriority: (process.env.SEED_DEFAULT_PRIORITY as Priority | undefined) || 'NORMAL',
      maxFileSizeMb: 10,
      inviteExpiresInDays: Number(process.env.SEED_INVITE_EXPIRES_IN_DAYS || 7)
    }
  });

  const admin = getOptionalSeedAdmin();
  if (admin) {
    await prisma.user.upsert({
      where: { email: admin.email },
      update: {
        name: admin.name,
        role: 'ADMIN'
      },
      create: {
        email: admin.email,
        name: admin.name,
        role: 'ADMIN',
        passwordHash: await bcrypt.hash(admin.password, 10)
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : 'Seed failed');
    await prisma.$disconnect();
    process.exit(1);
  });
