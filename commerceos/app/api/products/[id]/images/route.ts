import { authErrorResponse, requireAdmin } from '@/lib/server/auth';
import { audit, database, isoNow, newId, objectStore } from '@/lib/server/db';
import { imageExtension, validateImageUpload } from '@/lib/server/media';

const maxBytes = 10 * 1024 * 1024;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAdmin(request, ['owner', 'admin', 'catalog']);
    const { id: productId } = await context.params;
    const form = await request.formData();
    const file = form.get('file');
    const altValue = form.get('alt');
    const alt = (typeof altValue === 'string' ? altValue : '').trim();
    if (!(file instanceof File)) {
      return Response.json(
        { error: 'Choose an image to upload.', code: 'INVALID_FILE' },
        { status: 400 },
      );
    }
    if (!(await validateImageUpload(file, maxBytes)) || alt.length > 300) {
      return Response.json(
        {
          error: 'Use a JPG, PNG, WebP, or AVIF image up to 10 MB.',
          code: 'INVALID_FILE',
        },
        { status: 400 },
      );
    }
    const db = database();
    const product = await db
      .prepare('SELECT name FROM products WHERE id = ? LIMIT 1')
      .bind(productId)
      .first<{ name: string }>();
    if (!product) {
      return Response.json(
        { error: 'Product not found.', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    const current = await db
      .prepare(
        'SELECT COUNT(*) AS count, COALESCE(MAX(sort_order), -1) AS last_order FROM product_images WHERE product_id = ?',
      )
      .bind(productId)
      .first<{ count: number; last_order: number }>();
    if ((current?.count ?? 0) >= 12) {
      return Response.json(
        { error: 'A product can have up to 12 images.', code: 'IMAGE_LIMIT' },
        { status: 400 },
      );
    }

    const key = `products/${productId}/${crypto.randomUUID()}.${imageExtension(file.type)}`;
    await objectStore().put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        originalName: file.name.slice(0, 180),
        uploadedBy: user.id,
      },
    });
    const imageId = newId('img');
    const url = `/api/media?key=${encodeURIComponent(key)}`;
    try {
      await db
        .prepare(
          `INSERT INTO product_images
            (id, product_id, url, object_key, alt, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          imageId,
          productId,
          url,
          key,
          alt || product.name,
          (current?.last_order ?? -1) + 1,
          isoNow(),
        )
        .run();
    } catch (databaseError) {
      await objectStore().delete(key);
      throw databaseError;
    }
    await audit(user.id, 'product.image_uploaded', 'product', productId, {
      imageId,
      contentType: file.type,
      size: file.size,
    });
    return Response.json({ image: { id: imageId, url, alt: alt || product.name } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAdmin(request, ['owner', 'admin', 'catalog']);
    const { id: productId } = await context.params;
    const imageId = new URL(request.url).searchParams.get('imageId');
    if (!imageId) {
      return Response.json(
        { error: 'imageId is required.', code: 'INVALID_INPUT' },
        { status: 400 },
      );
    }
    const db = database();
    const image = await db
      .prepare(
        'SELECT object_key FROM product_images WHERE id = ? AND product_id = ? LIMIT 1',
      )
      .bind(imageId, productId)
      .first<{ object_key: string | null }>();
    if (!image) {
      return Response.json(
        { error: 'Image not found.', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    await db
      .prepare('DELETE FROM product_images WHERE id = ? AND product_id = ?')
      .bind(imageId, productId)
      .run();
    if (image.object_key) await objectStore().delete(image.object_key);
    await audit(user.id, 'product.image_removed', 'product', productId, { imageId });
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
