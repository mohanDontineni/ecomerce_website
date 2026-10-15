import { env } from 'cloudflare:workers';

export function database(): D1Database {
  if (!env.DB) {
    throw new Error('The DB binding is unavailable.');
  }
  return env.DB;
}

export function objectStore(): R2Bucket {
  if (!env.FILES) {
    throw new Error('The FILES binding is unavailable.');
  }
  return env.FILES;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export async function audit(
  actorUserId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const db = database();
  await db
    .prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('evt'),
      actorUserId,
      action,
      entityType,
      entityId,
      JSON.stringify(metadata),
      isoNow(),
    )
    .run();
}
