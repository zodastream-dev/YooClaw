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

  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_messages_user_id ON user_messages(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_messages_session_id ON user_messages(session_id)`;

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
  return user.storage_used < user.storage_limit;
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
