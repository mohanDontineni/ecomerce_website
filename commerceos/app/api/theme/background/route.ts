import { authErrorResponse, requireAdmin } from '@/lib/server/auth';
import { audit, database, isoNow, objectStore } from '@/lib/server/db';
import { imageExtension, validateImageUpload } from '@/lib/server/media';

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !(await validateImageUpload(file, 15 * 1024 * 1024))) {
      return Response.json(
        { error: 'Use a JPG, PNG, WebP, or AVIF image up to 15 MB.', code: 'INVALID_FILE' },
        { status: 400 },
      );
    }
    const db = database();
    const previous = await db
      .prepare("SELECT background_image_url FROM theme_settings WHERE id = 'current'")
      .first<{ background_image_url: string | null }>();
    const key = `themes/backgrounds/${crypto.randomUUID()}.${imageExtension(file.type)}`;
    await objectStore().put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: { uploadedBy: user.id },
    });
    const url = `/api/media?key=${encodeURIComponent(key)}`;
    try {
      await db
        .prepare(
          `UPDATE theme_settings
           SET background_image_url = ?, updated_at = ?
           WHERE id = 'current'`,
        )
        .bind(url, isoNow())
        .run();
    } catch (databaseError) {
      await objectStore().delete(key);
      throw databaseError;
    }
    if (previous?.background_image_url?.startsWith('/api/media?')) {
      const previousKey = new URL(
        previous.background_image_url,
        'https://local.invalid',
      ).searchParams.get('key');
      if (previousKey && previousKey !== key) await objectStore().delete(previousKey);
    }
    await audit(user.id, 'theme.background_uploaded', 'theme', 'current', {
      contentType: file.type,
      size: file.size,
    });
    return Response.json({ url });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAdmin(request);
    const db = database();
    const current = await db
      .prepare(`SELECT background_image_url FROM theme_settings WHERE id = 'current'`)
      .first<{ background_image_url: string | null }>();
    const url = current?.background_image_url;
    await db
      .prepare(
        `UPDATE theme_settings
         SET background_image_url = NULL, updated_at = ?
         WHERE id = 'current'`,
      )
      .bind(isoNow())
      .run();
    if (url?.startsWith('/api/media?')) {
      const key = new URL(url, 'https://local.invalid').searchParams.get('key');
      if (key) await objectStore().delete(key);
    }
    await audit(user.id, 'theme.background_removed', 'theme', 'current');
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
