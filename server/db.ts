import postgres from 'postgres';
import crypto from 'crypto';

// ========== Types ==========
export interface DbUser {
  id: string;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
  storage_used: number;
  storage_limit: number;
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
}

export interface DbUserSession {
  id: string;
  user_id: string;
  session_id: string;
  session_name: string;
  created_at: string;
}

export interface DbUserMessage {
  id: string;
  user_id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface DbReportSite {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  company_name: string;
  html_content: string;
  type: string;
  is_published: boolean;
  view_count: number;
  created_at: string;
  updated_at: string;
}

// ========== Postgres Connection ==========
let sql: postgres.Sql<{}>;

// ========== Password Hashing ==========
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N
const SCRYPT_BLOCK_SIZE = 8; // r
const SCRYPT_PARALLELIZATION = 1; // p

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(32);
  const derivedKey = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  // Format: salt:hash (both hex encoded)
  return salt.toString('hex') + ':' + derivedKey.toString('hex');
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [saltHex, hashHex] = storedHash.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return crypto.timingSafeEqual(derivedKey, Buffer.from(hashHex, 'hex'));
}

// ========== Initialize ==========
export async function initDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  sql = postgres(databaseUrl, {
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idle_timeout: 20000,
    connect_timeout: 10,
    prepare: false,  // Required for Supabase Transaction mode pooler
    connection: {
      client_encoding: 'UTF8',  // Ensure UTF-8 encoding for Chinese characters
    },
  });

  // Create tables if not exist
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      storage_used BIGINT DEFAULT 0,
      storage_limit BIGINT DEFAULT 20971520,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      session_name TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS report_sites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      company_name TEXT NOT NULL,
      html_content TEXT NOT NULL,
      is_published BOOLEAN DEFAULT true,
      view_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // Add type column if not exists (migration for existing tables)
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='report_sites' AND column_name='type'
      ) THEN
        ALTER TABLE report_sites ADD COLUMN type TEXT DEFAULT 'report' CHECK (type IN ('report', 'game'));
      END IF;
    END $$;
  `;

  // Add 'portal' to type check constraint (migration)
  await sql`
    ALTER TABLE report_sites DROP CONSTRAINT IF EXISTS report_sites_type_check;
    ALTER TABLE report_sites ADD CONSTRAINT report_sites_type_check CHECK (type IN ('report', 'game', 'portal'));
  `;

  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_messages_user_id ON user_messages(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_messages_session_id ON user_messages(session_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_report_sites_user_id ON report_sites(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_report_sites_slug ON report_sites(slug)`;

  // Create default admin user if not exists
  const existingAdmin = await sql`
    SELECT id FROM users WHERE username = 'admin'
  `;
  if (existingAdmin.length === 0) {
    await sql`
      INSERT INTO users (username, password_hash, role, storage_used, storage_limit, status)
      VALUES ('admin', ${hashPassword('admin')}, 'admin', 0, 52428800, 'active')
    `;
    console.log('[DB] Default admin user created (username: admin, password: admin)');
  }

  console.log('[DB] Database initialized successfully (PostgreSQL)');
}

// ========== User Operations ==========

export async function createUser(username: string, password: string): Promise<DbUser | null> {
  // Check if username already exists
  const existing = await sql`
    SELECT id FROM users WHERE username = ${username}
  `;
  if (existing.length > 0) {
    return null; // Username taken
  }

  const passwordHash = hashPassword(password);

  const rows = await sql`
    INSERT INTO users (username, password_hash, role, storage_used, storage_limit, status)
    VALUES (${username}, ${passwordHash}, 'user', 0, 20971520, 'active')
    RETURNING *
  `;

  if (rows.length === 0) return null;
  return rows[0] as unknown as DbUser;
}

export async function getUserByUsername(username: string): Promise<DbUser | undefined> {
  const rows = await sql`
    SELECT * FROM users WHERE username = ${username}
  `;
  if (rows.length === 0) return undefined;
  return rows[0] as unknown as DbUser;
}

export async function getUserById(id: string): Promise<DbUser | undefined> {
  const rows = await sql`
    SELECT * FROM users WHERE id = ${id}
  `;
  if (rows.length === 0) return undefined;
  return rows[0] as unknown as DbUser;
}

export async function getAllUsers(): Promise<DbUser[]> {
  const rows = await sql`
    SELECT * FROM users ORDER BY created_at DESC
  `;
  return rows as unknown as DbUser[];
}

export async function updateUserStatus(id: string, status: 'active' | 'disabled'): Promise<boolean> {
  await sql`
    UPDATE users SET status = ${status}, updated_at = now() WHERE id = ${id}
  `;
  return true;
}

export async function updateUserPassword(id: string, newPasswordHash: string): Promise<boolean> {
  await sql`
    UPDATE users SET password_hash = ${newPasswordHash}, updated_at = now() WHERE id = ${id}
  `;
  return true;
}

export async function deleteUser(id: string): Promise<boolean> {
  // CASCADE will handle messages and sessions
  await sql`DELETE FROM users WHERE id = ${id}`;
  return true;
}

export async function updateUserStorage(id: string, bytes: number): Promise<void> {
  await sql`
    UPDATE users SET storage_used = ${bytes}, updated_at = now() WHERE id = ${id}
  `;
}

// ========== Session Operations ==========

export async function createUserSession(userId: string, sessionId: string, sessionName: string): Promise<DbUserSession> {
  const rows = await sql`
    INSERT INTO user_sessions (user_id, session_id, session_name)
    VALUES (${userId}, ${sessionId}, ${sessionName})
    RETURNING *
  `;
  return rows[0] as unknown as DbUserSession;
}

export async function getUserSessions(userId: string): Promise<DbUserSession[]> {
  const rows = await sql`
    SELECT * FROM user_sessions WHERE user_id = ${userId} ORDER BY created_at DESC
  `;
  return rows as unknown as DbUserSession[];
}

export async function getUserSessionBySessionId(userId: string, sessionId: string): Promise<DbUserSession | undefined> {
  const rows = await sql`
    SELECT * FROM user_sessions WHERE user_id = ${userId} AND session_id = ${sessionId}
  `;
  if (rows.length === 0) return undefined;
  return rows[0] as unknown as DbUserSession;
}

export async function deleteUserSession(userId: string, sessionId: string): Promise<boolean> {
  // Delete messages first
  await sql`
    DELETE FROM user_messages WHERE session_id = ${sessionId} AND user_id = ${userId}
  `;
  // Delete session
  await sql`
    DELETE FROM user_sessions WHERE session_id = ${sessionId} AND user_id = ${userId}
  `;
  await recalcUserStorage(userId);
  return true;
}

export async function updateUserSessionName(userId: string, sessionId: string, name: string): Promise<boolean> {
  await sql`
    UPDATE user_sessions SET session_name = ${name}
    WHERE session_id = ${sessionId} AND user_id = ${userId}
  `;
  return true;
}

// ========== Message Operations ==========

export async function createMessage(userId: string, sessionId: string, role: 'user' | 'assistant', content: string): Promise<DbUserMessage> {
  const rows = await sql`
    INSERT INTO user_messages (user_id, session_id, role, content)
    VALUES (${userId}, ${sessionId}, ${role}, ${content})
    RETURNING *
  `;

  // Update storage usage
  await recalcUserStorage(userId);

  return rows[0] as unknown as DbUserMessage;
}

export async function getSessionMessages(userId: string, sessionId: string): Promise<DbUserMessage[]> {
  const rows = await sql`
    SELECT * FROM user_messages
    WHERE user_id = ${userId} AND session_id = ${sessionId}
    ORDER BY created_at ASC
  `;
  return rows as unknown as DbUserMessage[];
}

// ========== Storage ==========

export async function recalcUserStorage(userId: string): Promise<number> {
  const result = await sql`
    SELECT COALESCE(SUM(LENGTH(content)), 0) as total FROM user_messages WHERE user_id = ${userId}
  `;
  const dbSize = Number(result[0].total);

  await updateUserStorage(userId, dbSize);
  return dbSize;
}

export async function canCreateSession(userId: string): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) return false;
  // Convert to numbers (postgres BIGINT returns strings)
  const used = Number(user.storage_used);
  const limit = Number(user.storage_limit);
  return used < limit;
}

export async function getAdminStats(): Promise<{ totalUsers: number; totalStorage: number; activeUsers: number }> {
  const [userCount] = await sql`SELECT COUNT(*)::int as count FROM users`;
  const [storageTotal] = await sql`SELECT COALESCE(SUM(storage_used), 0)::bigint as total FROM users`;
  const [activeCount] = await sql`SELECT COUNT(*)::int as count FROM users WHERE status = 'active'`;

  return {
    totalUsers: userCount.count,
    totalStorage: Number(storageTotal.total),
    activeUsers: activeCount.count,
  };
}

// ========== Report Site Operations ==========

export async function createReportSite(
  userId: string,
  slug: string,
  title: string,
  companyName: string,
  htmlContent: string,
  type: string = 'report'
): Promise<DbReportSite> {
  const rows = await sql`
    INSERT INTO report_sites (user_id, slug, title, company_name, html_content, type)
    VALUES (${userId}, ${slug}, ${title}, ${companyName}, ${htmlContent}, ${type})
    RETURNING *
  `;
  return rows[0] as unknown as DbReportSite;
}

export async function getReportSiteBySlug(slug: string, type?: string): Promise<DbReportSite | undefined> {
  if (type) {
    const rows = await sql`
      SELECT * FROM report_sites WHERE slug = ${slug} AND is_published = true AND type = ${type}
    `;
    if (rows.length === 0) return undefined;
    return rows[0] as unknown as DbReportSite;
  }
  const rows = await sql`
    SELECT * FROM report_sites WHERE slug = ${slug} AND is_published = true
  `;
  if (rows.length === 0) return undefined;
  return rows[0] as unknown as DbReportSite;
}

export async function getUserReportSites(userId: string, type?: string): Promise<DbReportSite[]> {
  if (type) {
    const rows = await sql`
      SELECT * FROM report_sites WHERE user_id = ${userId} AND type = ${type} ORDER BY created_at DESC
    `;
    return rows as unknown as DbReportSite[];
  }
  const rows = await sql`
    SELECT * FROM report_sites WHERE user_id = ${userId} ORDER BY created_at DESC
  `;
  return rows as unknown as DbReportSite[];
}

export async function getSiteCountByType(userId: string, type: string): Promise<number> {
  const [result] = await sql`
    SELECT COUNT(*)::int as count FROM report_sites WHERE user_id = ${userId} AND type = ${type}
  `;
  return result.count;
}

export async function deleteReportSite(userId: string, slug: string): Promise<boolean> {
  await sql`
    DELETE FROM report_sites WHERE slug = ${slug} AND user_id = ${userId}
  `;
  return true;
}

export async function incrementSiteViewCount(slug: string): Promise<void> {
  await sql`
    UPDATE report_sites SET view_count = view_count + 1 WHERE slug = ${slug}
  `;
}
