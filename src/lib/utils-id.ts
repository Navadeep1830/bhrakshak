import { randomUUID } from 'crypto';

/** Prisma-cuid-style id for filenames etc. */
export function createId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 24);
}
