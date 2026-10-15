import { authErrorResponse, requireAdmin } from '@/lib/server/auth';
import { audit, database, isoNow } from '@/lib/server/db';

const fields = {
  title: 'title',
  tagline: 'tagline',
  description: 'description',
  announcement: 'announcement',
  heroTitle: 'hero_title',
  heroAccent: 'hero_accent',
  heroSubtitle: 'hero_subtitle',
  currency: 'currency',
  contactEmail: 'contact_email',
  published: 'published',
} as const;

export async function PATCH(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = (await request.json()) as Record<string, unknown>;
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [field, column] of Object.entries(fields)) {
      if (!(field in body)) continue;
      let value = body[field];
      if (field === 'published') {
        if (typeof value !== 'boolean') {
          return Response.json(
            { error: 'Published must be true or false.', code: 'INVALID_INPUT' },
            { status: 400 },
          );
        }
        value = value ? 1 : 0;
      } else if (field === 'contactEmail') {
        if (
          value !== null &&
          (typeof value !== 'string' ||
            value.length > 254 ||
            (value !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))
        ) {
          return Response.json(
            { error: 'Enter a valid contact email.', code: 'INVALID_INPUT' },
            { status: 400 },
          );
        }
        value = value || null;
      } else if (typeof value !== 'string') {
        return Response.json(
          { error: `${field} must be text.`, code: 'INVALID_INPUT' },
          { status: 400 },
        );
      }
      if (field === 'currency' && !/^[A-Z]{3}$/.test(String(value))) {
        return Response.json(
          { error: 'Currency must be a three-letter ISO code.', code: 'INVALID_INPUT' },
          { status: 400 },
        );
      }
      if (typeof value === 'string' && value.length > 2000) {
        return Response.json(
          { error: `${field} is too long.`, code: 'INVALID_INPUT' },
          { status: 400 },
        );
      }
      assignments.push(`${column} = ?`);
      values.push(value);
    }
    if (!assignments.length) {
      return Response.json(
        { error: 'No supported settings were supplied.', code: 'INVALID_INPUT' },
        { status: 400 },
      );
    }
    assignments.push('updated_at = ?');
    values.push(isoNow());
    await database()
      .prepare(`UPDATE store_settings SET ${assignments.join(', ')} WHERE id = 'main'`)
      .bind(...values)
      .run();
    await audit(user.id, 'store.settings_updated', 'store', 'main', {
      fields: Object.keys(body),
    });
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
