import { authErrorResponse, requireAdmin } from '@/lib/server/auth';
import { audit, database, isoNow, newId } from '@/lib/server/db';
import { ensureSeedData } from '@/lib/server/seed';

type ThemeRow = {
  palette: string;
  mood: string;
  shape: string;
  primary_color: string;
  accent_color: string;
  surface_color: string;
  background_image_url: string | null;
  background_overlay: number;
  published_version: number;
};

const colorPattern = /^#[0-9a-f]{6}$/i;

function serialize(row: ThemeRow) {
  return {
    palette: row.palette,
    mood: row.mood,
    shape: row.shape,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
    surfaceColor: row.surface_color,
    backgroundImageUrl: row.background_image_url,
    backgroundOverlay: row.background_overlay,
    publishedVersion: row.published_version,
  };
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    await ensureSeedData();
    const db = database();
    const [theme, versions] = await Promise.all([
      db
        .prepare(
          `SELECT palette, mood, shape, primary_color, accent_color, surface_color,
                  background_image_url, background_overlay, published_version
           FROM theme_settings WHERE id = 'current'`,
        )
        .first<ThemeRow>(),
      db
        .prepare(
          `SELECT version, created_at FROM theme_versions
           ORDER BY version DESC LIMIT 20`,
        )
        .all(),
    ]);
    return Response.json({ theme: theme ? serialize(theme) : null, versions: versions.results });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAdmin(request);
    await ensureSeedData();
    const body = (await request.json()) as {
      palette?: string;
      mood?: string;
      shape?: string;
      primaryColor?: string;
      accentColor?: string;
      surfaceColor?: string;
      backgroundOverlay?: number;
      restoreVersion?: number;
    };
    const db = database();
    const current = await db
      .prepare(
        `SELECT palette, mood, shape, primary_color, accent_color, surface_color,
                background_image_url, background_overlay, published_version
         FROM theme_settings WHERE id = 'current'`,
      )
      .first<ThemeRow>();
    if (!current) throw new Error('Theme settings are unavailable.');

    let next = { ...serialize(current), ...body };
    if (body.restoreVersion) {
      const version = await db
        .prepare('SELECT snapshot_json FROM theme_versions WHERE version = ? LIMIT 1')
        .bind(body.restoreVersion)
        .first<{ snapshot_json: string }>();
      if (!version) {
        return Response.json(
          { error: 'Theme version not found.', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }
      next = { ...next, ...(JSON.parse(version.snapshot_json) as typeof next) };
    }

    if (
      !next.palette ||
      !next.mood ||
      !next.shape ||
      !colorPattern.test(next.primaryColor) ||
      !colorPattern.test(next.accentColor) ||
      !colorPattern.test(next.surfaceColor) ||
      !Number.isFinite(next.backgroundOverlay) ||
      next.backgroundOverlay < 0 ||
      next.backgroundOverlay > 95
    ) {
      return Response.json(
        { error: 'Theme settings are invalid.', code: 'INVALID_THEME' },
        { status: 400 },
      );
    }
    const publishedVersion = current.published_version + 1;
    const now = isoNow();
    const snapshot = {
      palette: next.palette,
      mood: next.mood,
      shape: next.shape,
      primaryColor: next.primaryColor,
      accentColor: next.accentColor,
      surfaceColor: next.surfaceColor,
      backgroundImageUrl: next.backgroundImageUrl,
      backgroundOverlay: Math.round(next.backgroundOverlay),
      publishedVersion,
    };
    await db.batch([
      db
        .prepare(
          `UPDATE theme_settings
           SET palette = ?, mood = ?, shape = ?, primary_color = ?,
               accent_color = ?, surface_color = ?, background_overlay = ?,
               published_version = ?, updated_at = ?
           WHERE id = 'current'`,
        )
        .bind(
          snapshot.palette,
          snapshot.mood,
          snapshot.shape,
          snapshot.primaryColor,
          snapshot.accentColor,
          snapshot.surfaceColor,
          snapshot.backgroundOverlay,
          publishedVersion,
          now,
        ),
      db
        .prepare(
          `INSERT INTO theme_versions
            (id, version, snapshot_json, created_by, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(newId('thv'), publishedVersion, JSON.stringify(snapshot), user.id, now),
    ]);
    await audit(user.id, 'theme.published', 'theme', 'current', {
      version: publishedVersion,
      restoredFrom: body.restoreVersion ?? null,
    });
    return Response.json({ theme: snapshot });
  } catch (error) {
    return authErrorResponse(error);
  }
}
