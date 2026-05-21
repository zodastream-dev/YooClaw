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
  custom_domain?: string;
  created_at: string;
  updated_at: string;
}
// ========== MP Subscription Types ==========
export interface DbUserMpSubscription {
  id: number;
  user_id: string;
  mp_id: string;
  mp_name: string;
  mp_cover: string;
  created_at: string;
}

export interface DbWereadAccount {
  id: number;
  vid: string;
  name: string;
  feed_count: number;
  max_feeds: number;
  status: string;
  last_refresh: string;
  created_at: string;
}

export interface DbVideo {
  id: string;
  user_id: string;
  title: string;
  prompt: string;
  duration: string;
  resolution: string;
  ratio: string;
  input_type: string;
  video_url: string;
  video_path: string;
  submit_id: string;
  created_at: string;
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
    max_lifetime: 0,
    connect_timeout: 30,
    query_timeout: 60000,
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

    // ========== MP Subscription Tables ==========

  await sql`
    CREATE TABLE IF NOT EXISTS user_mp_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mp_id VARCHAR(64) NOT NULL,
      mp_name VARCHAR(128) NOT NULL,
      mp_cover VARCHAR(512) DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(user_id, mp_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS weread_account_pool (
      id SERIAL PRIMARY KEY,
      vid VARCHAR(64) UNIQUE NOT NULL,
      name VARCHAR(128) DEFAULT '',
      feed_count INTEGER DEFAULT 0,
      max_feeds INTEGER DEFAULT 10,
      status VARCHAR(16) DEFAULT 'active',
      last_refresh TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // ========== Videos Table ==========
  await sql`
    CREATE TABLE IF NOT EXISTS videos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      duration TEXT NOT NULL,
      resolution TEXT NOT NULL,
      ratio TEXT NOT NULL,
      input_type TEXT DEFAULT 'text',
      video_url TEXT NOT NULL,
      video_path TEXT DEFAULT '',
      submit_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
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
  // Use DO block with exception handling for Supabase Pooler compatibility
  await sql`
    DO $$ BEGIN
      ALTER TABLE report_sites DROP CONSTRAINT IF EXISTS report_sites_type_check;
      ALTER TABLE report_sites ADD CONSTRAINT report_sites_type_check CHECK (type IN ('report', 'game', 'portal'));
    EXCEPTION WHEN OTHERS THEN
      -- Ignore errors (e.g. Pooler doesn't support DDL)
    END $$;
  `;

  // Add custom_domain column if not exists (migration)
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='report_sites' AND column_name='custom_domain'
      ) THEN
        ALTER TABLE report_sites ADD COLUMN custom_domain TEXT DEFAULT '';
      END IF;
    END $$;
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
  type: string = 'report',
  customDomain?: string
): Promise<DbReportSite> {
  const rows = await sql`
    INSERT INTO report_sites (user_id, slug, title, company_name, html_content, type, custom_domain)
    VALUES (${userId}, ${slug}, ${title}, ${companyName}, ${htmlContent}, ${type}, ${customDomain || ''})
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      company_name = EXCLUDED.company_name,
      html_content = EXCLUDED.html_content,
      type = EXCLUDED.type,
      custom_domain = EXCLUDED.custom_domain,
      updated_at = now()
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

// Get all portal-type sites (for cache warming)
export async function getAllPortalSites(): Promise<DbReportSite[]> {
  const rows = await sql`
    SELECT slug, html_content FROM report_sites WHERE type = 'portal' AND is_published = true
  `;
  return rows as unknown as DbReportSite[];
}

// ======================== MP Subscription Operations ========================

export async function subscribeMp(
  userId: string,
  mpId: string,
  mpName: string,
  mpCover: string
): Promise<{ success: boolean; message: string }> {
  // Check subscription count
  const count = await sql`
    SELECT COUNT(*)::int as count FROM user_mp_subscriptions WHERE user_id = ${userId}
  `;
  if (count[0].count >= 10) {
    return { success: false, message: '已达到订阅上限（10个公众号）' };
  }

  // Check duplicates
  const existing = await sql`
    SELECT id FROM user_mp_subscriptions WHERE user_id = ${userId} AND mp_id = ${mpId}
  `;
  if (existing.length > 0) {
    return { success: false, message: '已订阅过该公众号' };
  }

  await sql`
    INSERT INTO user_mp_subscriptions (user_id, mp_id, mp_name, mp_cover)
    VALUES (${userId}, ${mpId}, ${mpName}, ${mpCover})
  `;

  return { success: true, message: '订阅成功' };
}

export async function unsubscribeMp(
  userId: string,
  mpId: string
): Promise<{ success: boolean; deleted: boolean }> {
  await sql`
    DELETE FROM user_mp_subscriptions WHERE user_id = ${userId} AND mp_id = ${mpId}
  `;

  // Check if any other users still subscribe to this MP
  const remaining = await sql`
    SELECT COUNT(*)::int as count FROM user_mp_subscriptions WHERE mp_id = ${mpId}
  `;

  return { success: true, deleted: remaining[0].count === 0 };
}

export async function getUserMpSubscriptions(userId: string): Promise<DbUserMpSubscription[]> {
  const rows = await sql`
    SELECT * FROM user_mp_subscriptions WHERE user_id = ${userId} ORDER BY created_at DESC
  `;
  return rows as unknown as DbUserMpSubscription[];
}

export async function getUserMpSubscriptionCount(userId: string): Promise<number> {
  const result = await sql`
    SELECT COUNT(*)::int as count FROM user_mp_subscriptions WHERE user_id = ${userId}
  `;
  return result[0].count;
}

export async function getMpSubscriberCount(mpId: string): Promise<number> {
  const result = await sql`
    SELECT COUNT(*)::int as count FROM user_mp_subscriptions WHERE mp_id = ${mpId}
  `;
  return result[0].count;
}

export async function checkUserSubscribed(userId: string, mpId: string): Promise<boolean> {
  const rows = await sql`
    SELECT id FROM user_mp_subscriptions WHERE user_id = ${userId} AND mp_id = ${mpId}
  `;
  return rows.length > 0;
}

// ======================== WeRead Account Pool Operations ========================

export async function addWereadAccount(
  vid: string,
  name: string
): Promise<DbWereadAccount> {
  const rows = await sql`
    INSERT INTO weread_account_pool (vid, name, status)
    VALUES (${vid}, ${name}, 'active')
    ON CONFLICT (vid) DO UPDATE SET
      name = EXCLUDED.name,
      status = 'active'
    RETURNING *
  `;
  return rows[0] as unknown as DbWereadAccount;
}

export async function getWereadAccountByVid(vid: string): Promise<DbWereadAccount | undefined> {
  const rows = await sql`
    SELECT * FROM weread_account_pool WHERE vid = ${vid}
  `;
  if (rows.length === 0) return undefined;
  return rows[0] as unknown as DbWereadAccount;
}

export async function updateWereadAccountFeedCount(vid: string, count: number): Promise<void> {
  await sql`
    UPDATE weread_account_pool SET feed_count = ${count}, last_refresh = now()
    WHERE vid = ${vid}
  `;
}

export async function getAllActiveWereadAccounts(): Promise<DbWereadAccount[]> {
  const rows = await sql`
    SELECT * FROM weread_account_pool
    WHERE status = 'active' AND feed_count < max_feeds
    ORDER BY feed_count ASC, last_refresh ASC NULLS FIRST
  `;
  return rows as unknown as DbWereadAccount[];
}

export async function setWereadAccountStatus(
  vid: string,
  status: string
): Promise<void> {
  await sql`
    UPDATE weread_account_pool SET status = ${status}, last_refresh = now()
    WHERE vid = ${vid}
  `;
}

// ======================== Video Operations ========================

export async function saveVideo(video: {
  userId: string;
  title: string;
  prompt: string;
  duration: string;
  resolution: string;
  ratio: string;
  inputType: string;
  videoUrl: string;
  videoPath: string;
  submitId: string;
}): Promise<DbVideo> {
  const rows = await sql`
    INSERT INTO videos (user_id, title, prompt, duration, resolution, ratio, input_type, video_url, video_path, submit_id)
    VALUES (${video.userId}, ${video.title}, ${video.prompt}, ${video.duration}, ${video.resolution}, ${video.ratio}, ${video.inputType}, ${video.videoUrl}, ${video.videoPath}, ${video.submitId})
    RETURNING *
  `;
  return rows[0] as unknown as DbVideo;
}

export async function getUserVideos(userId: string): Promise<DbVideo[]> {
  const rows = await sql`
    SELECT * FROM videos
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
  return rows as unknown as DbVideo[];
}

export async function deleteVideo(id: string, userId: string): Promise<void> {
  await sql`
    DELETE FROM videos
    WHERE id = ${id} AND user_id = ${userId}
  `;
}

export async function getVideoById(id: string): Promise<DbVideo | undefined> {
  const rows = await sql`
    SELECT * FROM videos WHERE id = ${id}
  `;
  if (rows.length === 0) return undefined;
  return rows[0] as unknown as DbVideo;
}
