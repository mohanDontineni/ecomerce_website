import { ADMIN_SESSION_COOKIE } from '@/lib/branding';
import { env } from 'cloudflare:workers';
import { audit, database, isoNow, newId } from './db';

const COOKIE_NAME = ADMIN_SESSION_COOKIE;
const SESSION_SECONDS = 60 * 60 * 24 * 7;
// Cloudflare Workers Web Crypto currently accepts up to 100,000 PBKDF2 rounds.
const PASSWORD_ITERATIONS = 100_000;

type UserRow = {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  role: string;
  status: string;
  email_verified: number;
  must_change_password: number;
  password_hash?: string;
};

export type AdminIdentity = {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  role: string;
  emailVerified: boolean;
  mustChangePassword: boolean;
};

export class AuthFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function decode(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return encode(new Uint8Array(digest));
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const width = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < width; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: bufferSource(salt),
      iterations: PASSWORD_ITERATIONS,
    },
    key,
    256,
  );
  return `pbkdf2:${PASSWORD_ITERATIONS}:${encode(salt)}:${encode(new Uint8Array(derived))}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, iterationText, saltText, expectedText] = stored.split(':');
  const iterations = Number(iterationText);
  if (
    scheme !== 'pbkdf2' ||
    !Number.isSafeInteger(iterations) ||
    iterations < 100_000 ||
    !saltText ||
    !expectedText
  ) {
    return false;
  }

  const salt = decode(saltText);
  const expected = decode(expectedText);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  let derived: Uint8Array;
  try {
    derived = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          hash: 'SHA-256',
          salt: bufferSource(salt),
          iterations,
        },
        key,
        expected.byteLength * 8,
      ),
    );
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < derived.length; index += 1) {
    difference |= derived[index] ^ expected[index];
  }
  return difference === 0;
}

function toIdentity(user: UserRow): AdminIdentity {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    emailVerified: Boolean(user.email_verified),
    mustChangePassword: Boolean(user.must_change_password),
  };
}

function cookieToken(request: Request): string | null {
  const cookies = request.headers.get('cookie') ?? '';
  for (const pair of cookies.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function identityFromRequest(
  request: Request,
): Promise<AdminIdentity | null> {
  const token = cookieToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await database()
    .prepare(
      `SELECT u.id, u.username, u.email, u.display_name, u.role, u.status,
              u.email_verified, u.must_change_password
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'
       LIMIT 1`,
    )
    .bind(tokenHash, isoNow())
    .first<UserRow>();
  return row ? toIdentity(row) : null;
}

export async function requireAdmin(
  request: Request,
  allowedRoles: readonly string[] = ['owner', 'admin'],
): Promise<AdminIdentity> {
  const user = await identityFromRequest(request);
  if (!user)
    throw new AuthFailure(401, 'UNAUTHENTICATED', 'Sign in is required.');
  if (user.mustChangePassword) {
    throw new AuthFailure(
      428,
      'PASSWORD_RESET_REQUIRED',
      'Change the bootstrap password before continuing.',
    );
  }
  if (!user.emailVerified) {
    throw new AuthFailure(
      428,
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify the owner email before continuing.',
    );
  }
  if (!allowedRoles.includes(user.role)) {
    throw new AuthFailure(
      403,
      'FORBIDDEN',
      'Your role does not have permission to perform this action.',
    );
  }
  return user;
}

export async function login(
  username: string,
  password: string,
  request: Request,
): Promise<{ user: AdminIdentity; cookie: string }> {
  const db = database();
  const cleanUsername = username.trim().toLowerCase();
  const hostname = new URL(request.url).hostname.toLowerCase();
  const localDemoEnabled =
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname) &&
    env.MDCART_ALLOW_DEMO_BOOTSTRAP === 'true';
  const bootstrapSecret = env.MDCART_BOOTSTRAP_PASSWORD ?? '';
  const secretEnabled =
    new TextEncoder().encode(bootstrapSecret).byteLength >= 32;
  const environmentBootstrap =
    secretEnabled && constantTimeTextEqual(password, bootstrapSecret);
  let row = await db
    .prepare(
      `SELECT id, username, email, display_name, role, status, email_verified,
              must_change_password, password_hash
       FROM users WHERE username = ? LIMIT 1`,
    )
    .bind(cleanUsername)
    .first<UserRow>();

  if (!row && cleanUsername === 'admin') {
    const localDemo =
      localDemoEnabled &&
      constantTimeTextEqual(password, 'admin');
    if (!localDemo && !environmentBootstrap) {
      throw new AuthFailure(
        401,
        'INVALID_CREDENTIALS',
        'Username or password is incorrect.',
      );
    }
    const now = isoNow();
    const id = newId('usr');
    const passwordHash = await hashPassword(password);
    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO users
          (id, username, email, display_name, password_hash, role, status,
           email_verified, must_change_password, created_at, updated_at)
         VALUES (?, 'admin', NULL, 'Store owner', ?, 'owner', 'active', 0, 1, ?, ?)`,
      )
      .bind(id, passwordHash, now, now)
      .run();
    row = await db
      .prepare(
        `SELECT id, username, email, display_name, role, status, email_verified,
                must_change_password, password_hash
         FROM users WHERE username = 'admin' LIMIT 1`,
      )
      .first<UserRow>();
    if (inserted.meta.changes && row) {
      await audit(row.id, 'bootstrap.owner_created', 'user', row.id, {
        source: localDemo
          ? 'local_demo_credentials'
          : 'environment_bootstrap_secret',
      });
    }
  }

  if (
    row &&
    cleanUsername === 'admin' &&
    row.must_change_password === 1 &&
    row.password_hash &&
    !localDemoEnabled &&
    (await verifyPassword('admin', row.password_hash))
  ) {
    if (!environmentBootstrap) {
      throw new AuthFailure(
        401,
        'INVALID_CREDENTIALS',
        'Username or password is incorrect.',
      );
    }
    const legacyHash = row.password_hash;
    const passwordHash = await hashPassword(password);
    const now = isoNow();
    const rotated = await db
      .prepare(
        `UPDATE users
         SET password_hash = ?, updated_at = ?
         WHERE id = ? AND must_change_password = 1 AND password_hash = ?`,
      )
      .bind(passwordHash, now, row.id, legacyHash)
      .run();
    row = await db
      .prepare(
        `SELECT id, username, email, display_name, role, status, email_verified,
                must_change_password, password_hash
         FROM users WHERE id = ? LIMIT 1`,
      )
      .bind(row.id)
      .first<UserRow>();
    if (rotated.meta.changes && row) {
      await audit(row.id, 'bootstrap.legacy_owner_rotated', 'user', row.id, {
        source: 'environment_bootstrap_secret',
      });
    }
  }

  if (
    !row ||
    row.status !== 'active' ||
    !row.password_hash ||
    !(await verifyPassword(password, row.password_hash))
  ) {
    throw new AuthFailure(
      401,
      'INVALID_CREDENTIALS',
      'Username or password is incorrect.',
    );
  }

  const rawToken = encode(randomBytes(32));
  const tokenHash = await sha256(rawToken);
  const createdAt = isoNow();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(newId('ses'), row.id, tokenHash, expiresAt, createdAt)
    .run();
  await audit(row.id, 'auth.login', 'session', null);

  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`;
  return { user: toIdentity(row), cookie };
}

export async function resetPasswordAndStartVerification(
  request: Request,
  newPassword: string,
  email: string,
): Promise<{ user: AdminIdentity; demoVerificationCode: string }> {
  const user = await identityFromRequest(request);
  if (!user)
    throw new AuthFailure(401, 'UNAUTHENTICATED', 'Sign in is required.');
  if (
    newPassword.length < 10 ||
    !/[A-Z]/.test(newPassword) ||
    !/[a-z]/.test(newPassword) ||
    !/[0-9]/.test(newPassword) ||
    newPassword.toLowerCase().includes('admin')
  ) {
    throw new AuthFailure(
      400,
      'WEAK_PASSWORD',
      'Use at least 10 characters with upper case, lower case, and a number; do not include “admin”.',
    );
  }
  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new AuthFailure(400, 'INVALID_EMAIL', 'Enter a valid owner email.');
  }

  const db = database();
  const currentToken = cookieToken(request);
  if (!currentToken) {
    throw new AuthFailure(401, 'UNAUTHENTICATED', 'Sign in is required.');
  }
  const currentTokenHash = await sha256(currentToken);
  const passwordHash = await hashPassword(newPassword);
  const now = isoNow();
  const code = String(
    crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000,
  ).padStart(6, '0');
  const codeHash = await sha256(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE users
         SET password_hash = ?, email = ?, must_change_password = 0,
             email_verified = 0, updated_at = ?
         WHERE id = ?`,
      )
      .bind(passwordHash, cleanEmail, now, user.id),
    db
      .prepare(
        `DELETE FROM verification_tokens
         WHERE user_id = ? AND purpose = 'owner_email' AND consumed_at IS NULL`,
      )
      .bind(user.id),
    db
      .prepare(
        `INSERT INTO verification_tokens
          (id, user_id, purpose, token_hash, expires_at, consumed_at, created_at)
         VALUES (?, ?, 'owner_email', ?, ?, NULL, ?)`,
      )
      .bind(newId('verify'), user.id, codeHash, expiresAt, now),
    db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
      .bind(user.id, currentTokenHash),
  ]);
  await audit(user.id, 'auth.password_changed', 'user', user.id, {
    verificationPending: true,
  });
  return {
    user: { ...user, email: cleanEmail, mustChangePassword: false },
    demoVerificationCode: code,
  };
}

export async function verifyOwnerEmail(
  request: Request,
  code: string,
): Promise<AdminIdentity> {
  const user = await identityFromRequest(request);
  if (!user)
    throw new AuthFailure(401, 'UNAUTHENTICATED', 'Sign in is required.');
  const codeHash = await sha256(code.trim());
  const db = database();
  const token = await db
    .prepare(
      `SELECT id FROM verification_tokens
       WHERE user_id = ? AND purpose = 'owner_email' AND token_hash = ?
         AND consumed_at IS NULL AND expires_at > ?
       LIMIT 1`,
    )
    .bind(user.id, codeHash, isoNow())
    .first<{ id: string }>();
  if (!token) {
    throw new AuthFailure(
      400,
      'INVALID_CODE',
      'The verification code is invalid or expired.',
    );
  }
  const now = isoNow();
  await db.batch([
    db
      .prepare('UPDATE verification_tokens SET consumed_at = ? WHERE id = ?')
      .bind(now, token.id),
    db
      .prepare(
        'UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?',
      )
      .bind(now, user.id),
  ]);
  await audit(user.id, 'auth.email_verified', 'user', user.id);
  return { ...user, emailVerified: true };
}

export async function resendOwnerVerification(
  request: Request,
): Promise<{ demoVerificationCode: string }> {
  const user = await identityFromRequest(request);
  if (!user)
    throw new AuthFailure(401, 'UNAUTHENTICATED', 'Sign in is required.');
  if (!user.email) {
    throw new AuthFailure(
      400,
      'EMAIL_REQUIRED',
      'Set the owner email while changing the bootstrap password first.',
    );
  }
  if (user.emailVerified) {
    throw new AuthFailure(
      400,
      'ALREADY_VERIFIED',
      'The owner email is already verified.',
    );
  }
  const code = String(
    crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000,
  ).padStart(6, '0');
  const db = database();
  const now = isoNow();
  await db.batch([
    db
      .prepare(
        `DELETE FROM verification_tokens
         WHERE user_id = ? AND purpose = 'owner_email' AND consumed_at IS NULL`,
      )
      .bind(user.id),
    db
      .prepare(
        `INSERT INTO verification_tokens
          (id, user_id, purpose, token_hash, expires_at, consumed_at, created_at)
         VALUES (?, ?, 'owner_email', ?, ?, NULL, ?)`,
      )
      .bind(
        newId('verify'),
        user.id,
        await sha256(code),
        new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        now,
      ),
  ]);
  await audit(user.id, 'auth.verification_resent', 'user', user.id);
  return { demoVerificationCode: code };
}

export async function logout(request: Request): Promise<string> {
  const token = cookieToken(request);
  if (token) {
    await database()
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256(token))
      .run();
  }
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthFailure) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error(error);
  return Response.json(
    { error: 'Something went wrong.', code: 'INTERNAL_ERROR' },
    { status: 500 },
  );
}
