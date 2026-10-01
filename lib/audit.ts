import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export interface AuditEntry {
  actorType: 'ADMIN' | 'CANDIDATE' | 'SYSTEM';
  actorId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  /** Never put DOBs, resume text, images or embeddings in here. */
  meta?: Prisma.InputJsonValue;
}

/** Best-effort: an audit write failure must never break the user's request. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        meta: entry.meta,
      },
    });
  } catch (e) {
    console.error('Audit write failed', { name: e instanceof Error ? e.name : 'UnknownError' });
  }
}
