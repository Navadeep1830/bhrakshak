import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // query logging disabled — it bloated dev.log and slowed engine passes
    log: ['error', 'warn'],
  })

// Ensure SQLite WAL mode and busy timeout for safe concurrent reads/writes
if (!globalForPrisma.prisma) {
  db.$queryRawUnsafe('PRAGMA journal_mode = WAL;').catch(() => {});
  db.$executeRawUnsafe('PRAGMA busy_timeout = 30000;').catch(() => {});
  db.$executeRawUnsafe('PRAGMA synchronous = NORMAL;').catch(() => {});
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db