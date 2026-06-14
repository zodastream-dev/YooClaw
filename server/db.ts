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

// ========== Payment Types ==========
export interface DbMembershipPlan {
  id: number;
  name: string;
  tier: 'free' | 'basic' | 'premium';
  price_yuan: number;
  duration_days: number;
  monthly_credits: number;
  features: string;
  is_active: boolean;
  created_at: string;
}

export interface DbCreditPackage {
  id: number;
  name: string;
  credits: number;
  price_yuan: number;
  is_active: boolean;
  created_at: string;
}

export interface DbUserMembership {
  id: number;
  user_id: string;
  plan_id: number;
  tier: 'free' | 'basic' | 'premium';
  started_at: string;
  expires_at: string;
  auto_renew: boolean;
  created_at: string;
}

export interface DbOrder {
  id: string;
  user_id: string;
  order_type: 'membership' | 'credit_package';
  product_id: number;
  product_name: string;
  amount_yuan: number;
  status: 'pending' | 'paid' | 'expired' | 'refunded';
  payment_method: 'wechat' | null;
  payment_url: string;
  paid_at: string | null;
  created_at: string;
  expired_at: string;
}

export interface DbPaymentRecord {
  id: number;
  order_id: string;
  user_id: string;
  method: 'wechat';
  transaction_id: string;
  amount_yuan: number;
  raw_callback: string;
  created_at: string;
}

export interface DbCreditTransaction {
  id: number;
  user_id: string;
  type: 'charge' | 'consume' | 'refund' | 'monthly_grant';
  amount: number;
  balance_after: number;
  description: string;
  related_id: string;
  created_at: string;
}

// ========== Postgres Connection ==========
export let sql: postgres.Sql<{}>;

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

// ========== Payment Tables ==========
  // Membership plans
  await sql`
    CREATE TABLE IF NOT EXISTS membership_plans (
      id SERIAL PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      tier VARCHAR(16) NOT NULL CHECK (tier IN ('free', 'basic', 'premium')),
      price_yuan INTEGER NOT NULL DEFAULT 0,
      duration_days INTEGER NOT NULL,
      monthly_credits INTEGER NOT NULL DEFAULT 0,
      features TEXT NOT NULL DEFAULT '[]',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // Credit packages
  await sql`
    CREATE TABLE IF NOT EXISTS credit_packages (
      id SERIAL PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      credits INTEGER NOT NULL,
      price_yuan INTEGER NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // User memberships
  await sql`
    CREATE TABLE IF NOT EXISTS user_memberships (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL,
      tier VARCHAR(16) NOT NULL CHECK (tier IN ('free', 'basic', 'premium')),
      started_at TIMESTAMPTZ DEFAULT now(),
      expires_at TIMESTAMPTZ,
      auto_renew BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // User credits (one row per user)
  await sql`
    CREATE TABLE IF NOT EXISTS user_credits (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance INTEGER NOT NULL DEFAULT 0,
      total_earned INTEGER NOT NULL DEFAULT 0,
      total_spent INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // Orders
  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_type VARCHAR(16) NOT NULL CHECK (order_type IN ('membership', 'credit_package')),
      product_id INTEGER NOT NULL,
      product_name VARCHAR(128) NOT NULL,
      amount_yuan INTEGER NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'refunded')),
      payment_method VARCHAR(16) DEFAULT NULL,
      payment_url TEXT DEFAULT '',
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      expired_at TIMESTAMPTZ DEFAULT (now() + interval '15 minutes')
    )
  `;

  // Payment records
  await sql`
    CREATE TABLE IF NOT EXISTS payment_records (
      id SERIAL PRIMARY KEY,
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      method VARCHAR(16) NOT NULL,
      transaction_id VARCHAR(128) NOT NULL,
      amount_yuan INTEGER NOT NULL,
      raw_callback TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // Credit transactions
  await sql`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(16) NOT NULL CHECK (type IN ('charge', 'consume', 'refund', 'monthly_grant')),
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL DEFAULT 0,
      description VARCHAR(256) DEFAULT '',
      related_id VARCHAR(128) DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // Seed default plans
  const existingPlans = await sql`SELECT COUNT(*)::int as cnt FROM membership_plans`;
  if (existingPlans[0].cnt === 0) {
    await sql`
      INSERT INTO membership_plans (name, tier, price_yuan, duration_days, monthly_credits, features) VALUES
      ('免费版', 'free', 0, 99999, 0, '["基础AI对话","每日10次","1个分析门户"]'),
      ('基础会员（月付）', 'basic', 29, 30, 500, '["无限AI对话","每日简报","每月500积分","3个分析门户","视频生成8折"]'),
      ('基础会员（年付）', 'basic', 199, 365, 500, '["无限AI对话","每日简报","每月500积分","5个分析门户","视频生成8折"]'),
      ('高级会员（月付）', 'premium', 69, 30, 2000, '["无限AI对话","每日简报","每月2000积分","10个分析门户","视频生成5折","专属功能"]'),
      ('高级会员（年付）', 'premium', 499, 365, 2000, '["无限AI对话","每日简报","每月2000积分","无限分析门户","视频生成5折","专属功能"]')
    `;
  }

  // Seed default credit packages
  const existingPkgs = await sql`SELECT COUNT(*)::int as cnt FROM credit_packages`;
  if (existingPkgs[0].cnt === 0) {
    await sql`
      INSERT INTO credit_packages (name, credits, price_yuan) VALUES
      ('100积分', 100, 10),
      ('500积分', 500, 40),
      ('2000积分', 2000, 120),
      ('5000积分', 5000, 250)
    `;
  }

  // Payment indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_user_memberships_user_id ON user_memberships(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_payment_records_order_id ON payment_records(order_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id)`;

  // Invoice records
  await sql`
    CREATE TABLE IF NOT EXISTS fapiao_records (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL REFERENCES orders(id),
      fpqqlsh VARCHAR(128) NOT NULL UNIQUE,
      buyer_title VARCHAR(256) NOT NULL,
      buyer_tax_id VARCHAR(64) DEFAULT '',
      buyer_email VARCHAR(256) DEFAULT '',
      total_amount INTEGER NOT NULL,
      tax_amount INTEGER DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'reversed', 'failed')),
      remark TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_fapiao_records_user_id ON fapiao_records(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fapiao_records_order_id ON fapiao_records(order_id)`;

  console.log('[DB] Payment tables initialized');

  // Migration: orders.id TEXT (was UUID)
  await sql`
    DO $$ BEGIN
      ALTER TABLE orders ALTER COLUMN id TYPE TEXT;
    EXCEPTION WHEN others THEN null;
    END $$;
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
  referenceImages?: string[];
}): Promise<DbVideo> {
  const refs = video.referenceImages?.length ? JSON.stringify(video.referenceImages) : '[]';
  const rows = await sql`
    INSERT INTO videos (user_id, title, prompt, duration, resolution, ratio, input_type, video_url, video_path, submit_id, reference_images)
    VALUES (${video.userId}, ${video.title}, ${video.prompt}, ${video.duration}, ${video.resolution}, ${video.ratio}, ${video.inputType}, ${video.videoUrl}, ${video.videoPath}, ${video.submitId}, ${refs}::jsonb)
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

// ======================== Payment Operations ========================

// --- Membership Plans ---
export async function getMembershipPlans(activeOnly = true): Promise<DbMembershipPlan[]> {
  if (activeOnly) {
    const rows = await sql`SELECT * FROM membership_plans WHERE is_active = true ORDER BY price_yuan ASC`;
    return rows as unknown as DbMembershipPlan[];
  }
  const rows = await sql`SELECT * FROM membership_plans ORDER BY price_yuan ASC`;
  return rows as unknown as DbMembershipPlan[];
}

export async function getMembershipPlanById(id: number): Promise<DbMembershipPlan | undefined> {
  const rows = await sql`SELECT * FROM membership_plans WHERE id = ${id}`;
  if (rows.length === 0) return undefined;
  return rows[0] as unknown as DbMembershipPlan;
}

// --- Credit Packages ---
export async function getCreditPackages(activeOnly = true): Promise<DbCreditPackage[]> {
  if (activeOnly) {
    const rows = await sql`SELECT * FROM credit_packages WHERE is_active = true ORDER BY price_yuan ASC`;
    return rows as unknown as DbCreditPackage[];
  }
  const rows = await sql`SELECT * FROM credit_packages ORDER BY price_yuan ASC`;
  return rows as unknown as DbCreditPackage[];
}

export async function getCreditPackageById(id: number): Promise<DbCreditPackage | undefined> {
  const rows = await sql`SELECT * FROM credit_packages WHERE id = ${id}`;
  if (rows.length === 0) return undefined;
  return rows[0] as unknown as DbCreditPackage;
}

// --- User Membership ---
export async function getUserMembership(userId: string): Promise<DbUserMembership | undefined> {
  const rows = await sql`
    SELECT * FROM user_memberships
    WHERE user_id = ${userId} AND expires_at > now()
    ORDER BY expires_at DESC LIMIT 1
  `;
  if (rows.length === 0) return undefined;
  return rows[0] as unknown as DbUserMembership;
}

export async function activateMembership(
  userId: string,
  planId: number,
  tier: string,
  durationDays: number,
  monthlyCredits: number
): Promise<DbUserMembership> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 86400000);

  const rows = await sql`
    INSERT INTO user_memberships (user_id, plan_id, tier, started_at, expires_at)
    VALUES (${userId}, ${planId}, ${tier}, now(), ${expiresAt.toISOString()})
    RETURNING *
  `;

  // Grant first month credits immediately
  if (monthlyCredits > 0) {
    const balance = await addCredits(userId, monthlyCredits, 'monthly_grant', '月度赠送积分', `membership_${rows[0].id}`);
    console.log(`[Payment] Monthly grant: ${monthlyCredits} credits to user ${userId}, balance=${balance}`);
  }

  return rows[0] as unknown as DbUserMembership;
}

// --- Credits ---
export async function getUserCredits(userId: string): Promise<number> {
  const rows = await sql`SELECT balance FROM user_credits WHERE user_id = ${userId}`;
  if (rows.length === 0) return 0;
  return Number(rows[0].balance);
}

export async function ensureUserCredits(userId: string): Promise<void> {
  await sql`
    INSERT INTO user_credits (user_id, balance, total_earned, total_spent)
    VALUES (${userId}, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING
  `;
}

export async function addCredits(
  userId: string,
  amount: number,
  type: 'charge' | 'refund' | 'monthly_grant',
  description: string,
  relatedId: string = ''
): Promise<number> {
  await ensureUserCredits(userId);

  const rows = await sql`
    UPDATE user_credits
    SET balance = balance + ${amount},
        total_earned = total_earned + ${amount},
        updated_at = now()
    WHERE user_id = ${userId}
    RETURNING balance
  `;
  const newBalance = Number(rows[0].balance);

  await sql`
    INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, related_id)
    VALUES (${userId}, ${type}, ${amount}, ${newBalance}, ${description}, ${relatedId})
  `;

  return newBalance;
}

export async function consumeCredits(
  userId: string,
  amount: number,
  description: string,
  relatedId: string = ''
): Promise<{ success: boolean; balance: number; message: string }> {
  await ensureUserCredits(userId);

  const current = await sql`SELECT balance FROM user_credits WHERE user_id = ${userId}`;
  const balance = Number(current[0]?.balance || 0);

  if (balance < amount) {
    return { success: false, balance, message: `积分不足（需要 ${amount}，当前 ${balance}）` };
  }

  const rows = await sql`
    UPDATE user_credits
    SET balance = balance - ${amount},
        total_spent = total_spent + ${amount},
        updated_at = now()
    WHERE user_id = ${userId}
    RETURNING balance
  `;
  const newBalance = Number(rows[0].balance);

  await sql`
    INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, related_id)
    VALUES (${userId}, 'consume', ${-amount}, ${newBalance}, ${description}, ${relatedId})
  `;

  return { success: true, balance: newBalance, message: '' };
}

export async function getCreditTransactions(
  userId: string,
  limit = 50
): Promise<DbCreditTransaction[]> {
  const rows = await sql`
    SELECT * FROM credit_transactions
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as unknown as DbCreditTransaction[];
}

// --- Orders ---
let _orderSerial = 0;
function generateOrderId(): string {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  _orderSerial = (_orderSerial + 1) % 10000;
  return `${y}${m}${d}${h}${min}${String(_orderSerial).padStart(4, '0')}`;
}

export async function createOrder(
  userId: string,
  orderType: 'membership' | 'credit_package',
  productId: number,
  productName: string,
  amountYuan: number
): Promise<DbOrder> {
  const orderId = generateOrderId();
  const rows = await sql`
    INSERT INTO orders (id, user_id, order_type, product_id, product_name, amount_yuan, status)
    VALUES (${orderId}, ${userId}, ${orderType}, ${productId}, ${productName}, ${amountYuan}, 'pending')
    RETURNING *
  `;
  return rows[0] as unknown as DbOrder;
}

export async function getOrderById(orderId: string): Promise<DbOrder | undefined> {
  const rows = await sql`SELECT * FROM orders WHERE id = ${orderId}`;
  if (rows.length === 0) return undefined;
  return rows[0] as unknown as DbOrder;
}

export async function getUserOrders(userId: string, limit = 20): Promise<DbOrder[]> {
  const rows = await sql`
    SELECT * FROM orders WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows as unknown as DbOrder[];
}

export async function updateOrderPaymentUrl(orderId: string, paymentUrl: string, method: 'wechat' | 'alipay'): Promise<void> {
  await sql`
    UPDATE orders SET payment_url = ${paymentUrl}, payment_method = ${method}, status = 'pending'
    WHERE id = ${orderId}
  `;
}

export async function markOrderPaid(
  orderId: string,
  userId: string,
  method: 'wechat' | 'alipay',
  transactionId: string,
  amountYuan: number,
  rawCallback: string
): Promise<DbOrder | null> {
  // Check if already paid (idempotent)
  const existing = await sql`SELECT id, status FROM orders WHERE id = ${orderId}`;
  if (existing.length === 0) return null;
  if (existing[0].status === 'paid') {
    return existing[0] as unknown as DbOrder;
  }

  // Update order
  await sql`
    UPDATE orders SET status = 'paid', paid_at = now()
    WHERE id = ${orderId}
  `;

  // Record payment
  await sql`
    INSERT INTO payment_records (order_id, user_id, method, transaction_id, amount_yuan, raw_callback)
    VALUES (${orderId}, ${userId}, ${method}, ${transactionId}, ${amountYuan}, ${rawCallback})
    ON CONFLICT DO NOTHING
  `;

  const order = await sql`SELECT * FROM orders WHERE id = ${orderId}`;
  return order[0] as unknown as DbOrder;
}

export async function expirePendingOrders(): Promise<void> {
  await sql`
    UPDATE orders SET status = 'expired'
    WHERE status = 'pending' AND expired_at < now()
  `;
}

// ======================== End Payment Operations ========================

// ======================== Invoice Operations ========================

export interface DbFapiaoRecord {
  id: number;
  user_id: string;
  order_id: string;
  fpqqlsh: string;
  buyer_title: string;
  buyer_tax_id: string;
  buyer_email: string;
  total_amount: number;
  tax_amount: number;
  status: 'pending' | 'issued' | 'reversed' | 'failed';
  remark: string;
  created_at: string;
  updated_at: string;
}

export async function createFapiaoRecord(
  userId: string,
  orderId: string,
  fpqqlsh: string,
  buyerTitle: string,
  buyerTaxId: string,
  buyerEmail: string,
  totalAmount: number,
  taxAmount: number,
  remark: string,
): Promise<DbFapiaoRecord> {
  const rows = await sql`
    INSERT INTO fapiao_records (user_id, order_id, fpqqlsh, buyer_title, buyer_tax_id, buyer_email, total_amount, tax_amount, status, remark)
    VALUES (${userId}, ${orderId}, ${fpqqlsh}, ${buyerTitle}, ${buyerTaxId}, ${buyerEmail}, ${totalAmount}, ${taxAmount}, 'pending', ${remark})
    RETURNING *
  `;
  return rows[0] as unknown as DbFapiaoRecord;
}

export async function updateFapiaoStatus(
  fpqqlsh: string,
  status: 'issued' | 'reversed' | 'failed',
): Promise<void> {
  await sql`
    UPDATE fapiao_records SET status = ${status}, updated_at = now()
    WHERE fpqqlsh = ${fpqqlsh}
  `;
}

export async function getFapiaoRecord(fpqqlsh: string): Promise<DbFapiaoRecord | undefined> {
  const rows = await sql`SELECT * FROM fapiao_records WHERE fpqqlsh = ${fpqqlsh}`;
  return rows[0] as unknown as DbFapiaoRecord | undefined;
}

export async function getFapiaoRecordByOrder(orderId: string): Promise<DbFapiaoRecord | undefined> {
  const rows = await sql`SELECT * FROM fapiao_records WHERE order_id = ${orderId} ORDER BY created_at DESC LIMIT 1`;
  return rows[0] as unknown as DbFapiaoRecord | undefined;
}

export async function getUserFapiaoRecords(userId: string, limit = 20): Promise<DbFapiaoRecord[]> {
  const rows = await sql`
    SELECT * FROM fapiao_records WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows as unknown as DbFapiaoRecord[];
}
