import express from 'express';
import cors from 'cors';
import { createProxyMiddleware, type RequestHandler } from 'http-proxy-middleware';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import http from 'http';
import fs from 'fs';
import {
  initDatabase,
  hashPassword,
  verifyPassword,
  createUser,
  getUserByUsername,
  getUserById,
  getAllUsers,
  updateUserStatus,
  deleteUser,
  canCreateSession,
  createUserSession,
  getUserSessions,
  deleteUserSession,
  updateUserSessionName,
  createMessage,
  getSessionMessages,
  recalcUserStorage,
  getAdminStats,
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ========== Configuration ==========
const APP_PORT = Number(process.env.PORT) || Number(process.env.APP_PORT) || 3001;
const CB_PORT = Number(process.env.CB_PORT) || 8081;
const CB_HOST = process.env.CB_HOST || '127.0.0.1';
const CB_BASE = `http://${CB_HOST}:${CB_PORT}`;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET environment variable is required');
  process.exit(1);
}

// ========== CORS ==========
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
  'http://localhost:3000',
  'http://localhost:3001',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Also allow any vercel.app subdomain
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    callback(null, true); // Allow all in development
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CodeBuddy-Request'],
}));

// ========== JWT Helpers ==========
function createToken(payload: { userId: string; username: string; role: string }): string {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const b = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const s = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
  return `${h}.${b}.${s}`;
}

interface JwtPayload {
  userId: string;
  username: string;
  role: string;
  iat: number;
}

function verifyToken(token: string): JwtPayload | null {
  try {
    const [h, b, s] = token.split('.');
    if (crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url') !== s) return null;
    return JSON.parse(Buffer.from(b, 'base64url').toString()) as JwtPayload;
  } catch { return null; }
}

async function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
  }
  const payload = verifyToken(authHeader.slice(7));
  if (!payload) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }
  // Check if user is still active
  const user = await getUserById(payload.userId);
  if (!user || user.status === 'disabled') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Account is disabled' } });
  }
  (req as any).user = payload;
  next();
}

function adminMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = (req as any).user as JwtPayload;
  if (user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
  next();
}

// ========== HTTP Helper ==========
function proxyRequest(method: string, cbPath: string, body?: any, timeout = 120000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(cbPath, CB_BASE);
    const payload = body ? JSON.stringify(body) : null;
    const headers: http.OutgoingHttpHeaders = { 'X-CodeBuddy-Request': '1' };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode!, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ========== Middleware ==========
app.use(express.json());
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ========== Auth Routes ==========

// Register
app.post('/api/v1/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Username and password are required' } });
    }
    if (username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Username must be 3-32 characters' } });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Password must be at least 6 characters' } });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Username can only contain letters, numbers, and underscores' } });
    }

    const user = await createUser(username, password);
    if (!user) {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Username already taken' } });
    }

    const token = createToken({ userId: user.id, username: user.username, role: user.role });
    res.status(201).json({
      data: {
        token,
        user: { id: user.id, username: user.username, role: user.role, storageUsed: user.storage_used, storageLimit: user.storage_limit },
      },
    });
  } catch (err: any) {
    console.error('[Register Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Registration failed' } });
  }
});

// Login
app.post('/api/v1/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Username and password are required' } });
    }

    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } });
    }

    if (user.status === 'disabled') {
      return res.status(403).json({ error: { code: 'ACCOUNT_DISABLED', message: 'Account is disabled' } });
    }

    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } });
    }

    const token = createToken({ userId: user.id, username: user.username, role: user.role });
    res.json({
      data: {
        token,
        user: { id: user.id, username: user.username, role: user.role, storageUsed: user.storage_used, storageLimit: user.storage_limit },
      },
    });
  } catch (err: any) {
    console.error('[Login Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Login failed' } });
  }
});

// Get current user
app.get('/api/v1/auth/me', authMiddleware, async (req, res) => {
  try {
    const payload = (req as any).user as JwtPayload;
    const user = await getUserById(payload.userId);
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    res.json({
      data: {
        user: { id: user.id, username: user.username, role: user.role, storageUsed: user.storage_used, storageLimit: user.storage_limit, status: user.status },
      },
    });
  } catch (err: any) {
    console.error('[Auth/Me Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch user' } });
  }
});

// Auth status
app.get('/api/v1/auth/status', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const payload = authHeader?.startsWith('Bearer ') ? verifyToken(authHeader.slice(7)) : null;
    if (payload) {
      const user = await getUserById(payload.userId);
      res.json({
        data: {
          authenticated: true,
          user: user ? { id: user.id, username: user.username, role: user.role, storageUsed: user.storage_used, storageLimit: user.storage_limit } : null,
        },
      });
    } else {
      res.json({ data: { authenticated: false, user: null } });
    }
  } catch {
    res.json({ data: { authenticated: false, user: null } });
  }
});

// ========== Health ==========
// Simple health check for Railway/monitoring (does NOT depend on CodeBuddy)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/v1/health', async (_req, res) => {
  try {
    const cb = await proxyRequest('GET', '/api/v1/health');
    const cbData = JSON.parse(cb.body);
    res.json({ data: { status: 'ok', codebuddy: cbData.data, proxyMode: true } });
  } catch {
    res.json({ data: { status: 'degraded', codebuddy: null, proxyMode: true } });
  }
});

// ========== User Sessions ==========

app.get('/api/v1/user/sessions', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const sessions = await getUserSessions(userId);
    res.json({
      data: sessions.map(s => ({
        id: s.session_id,
        name: s.session_name || '新对话',
        createdAt: new Date(s.created_at).getTime(),
        updatedAt: new Date(s.created_at).getTime(),
      })),
    });
  } catch (err: any) {
    console.error('[Get Sessions Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch sessions' } });
  }
});

app.post('/api/v1/user/sessions', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { sessionId, name } = req.body || {};

    if (!(await canCreateSession(userId))) {
      return res.status(403).json({ error: { code: 'STORAGE_FULL', message: '存储空间已满，请删除旧对话释放空间' } });
    }

    const session = await createUserSession(userId, sessionId || crypto.randomUUID(), name || '新对话');
    res.status(201).json({
      data: {
        id: session.session_id,
        name: session.session_name,
        createdAt: new Date(session.created_at).getTime(),
        updatedAt: new Date(session.created_at).getTime(),
      },
    });
  } catch (err: any) {
    console.error('[Create Session Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create session' } });
  }
});

app.delete('/api/v1/user/sessions/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { sessionId } = req.params;
    await deleteUserSession(userId, sessionId);
    res.json({ data: { deleted: true } });
  } catch (err: any) {
    console.error('[Delete Session Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete session' } });
  }
});

app.post('/api/v1/user/sessions/:sessionId/rename', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { sessionId } = req.params;
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Name is required' } });
    await updateUserSessionName(userId, sessionId, name);
    res.json({ data: { renamed: true } });
  } catch (err: any) {
    console.error('[Rename Session Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to rename session' } });
  }
});

app.get('/api/v1/user/sessions/:sessionId/messages', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { sessionId } = req.params;
    const messages = await getSessionMessages(userId, sessionId);
    res.json({
      data: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.created_at).getTime(),
      })),
    });
  } catch (err: any) {
    console.error('[Get Messages Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch messages' } });
  }
});

app.post('/api/v1/user/sessions/:sessionId/messages', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { sessionId } = req.params;
    const { role, content } = req.body || {};
    if (!role || !content) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Role and content are required' } });
    const msg = await createMessage(userId, sessionId, role, content);
    res.status(201).json({
      data: { id: msg.id, role: msg.role, content: msg.content, timestamp: new Date(msg.created_at).getTime() },
    });
  } catch (err: any) {
    console.error('[Create Message Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to save message' } });
  }
});

// ========== User Storage ==========

app.get('/api/v1/user/storage', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    const used = await recalcUserStorage(userId);
    res.json({
      data: {
        used,
        limit: user.storage_limit,
        percentage: Math.round((used / user.storage_limit) * 100),
        canCreate: used < user.storage_limit,
      },
    });
  } catch (err: any) {
    console.error('[Get Storage Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch storage' } });
  }
});

// ========== Admin Routes ==========

app.get('/api/v1/admin/users', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const users = await getAllUsers();
    res.json({
      data: users.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        storageUsed: u.storage_used,
        storageLimit: u.storage_limit,
        status: u.status,
        createdAt: u.created_at,
      })),
    });
  } catch (err: any) {
    console.error('[Admin Get Users Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch users' } });
  }
});

app.patch('/api/v1/admin/users/:userId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body || {};
    if (status && !['active', 'disabled'].includes(status)) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid status' } });
    }
    // Don't allow disabling self
    const adminUser = (req as any).user as JwtPayload;
    if (userId === adminUser.userId) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Cannot modify your own account' } });
    }
    if (status) await updateUserStatus(userId, status);
    const user = await getUserById(userId);
    res.json({
      data: user ? { id: user.id, username: user.username, role: user.role, status: user.status } : null,
    });
  } catch (err: any) {
    console.error('[Admin Update User Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update user' } });
  }
});

app.delete('/api/v1/admin/users/:userId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const adminUser = (req as any).user as JwtPayload;
    if (userId === adminUser.userId) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Cannot delete your own account' } });
    }
    await deleteUser(userId);
    res.json({ data: { deleted: true } });
  } catch (err: any) {
    console.error('[Admin Delete User Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete user' } });
  }
});

app.get('/api/v1/admin/stats', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const stats = await getAdminStats();
    res.json({ data: stats });
  } catch (err: any) {
    console.error('[Admin Stats Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch stats' } });
  }
});

// ========== POST /api/v1/runs — Transform & Forward ==========
app.post('/api/v1/runs', authMiddleware, async (req, res) => {
  try {
    const { text, sender, sessionId } = req.body || {};
    const userPayload = (req as any).user as JwtPayload;
    if (!text) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Text is required' } });
    }

    // Check storage quota
    if (!(await canCreateSession(userPayload.userId))) {
      return res.status(403).json({ error: { code: 'STORAGE_FULL', message: '存储空间已满，请删除旧对话释放空间' } });
    }

    // Save user message to DB
    const activeSessionId = sessionId || crypto.randomUUID();
    // Ensure session exists in our DB
    const existingSessions = await getUserSessions(userPayload.userId);
    if (!existingSessions.find(s => s.session_id === activeSessionId)) {
      await createUserSession(userPayload.userId, activeSessionId, text.slice(0, 30) + (text.length > 30 ? '...' : ''));
    }
    await createMessage(userPayload.userId, activeSessionId, 'user', text);

    // Transform: add id, type, timestamp for CodeBuddy's generic message format
    const cbBody = {
      id: crypto.randomUUID(),
      type: 'message',
      text,
      sender: sender || { id: userPayload.userId, name: userPayload.username },
      timestamp: new Date().toISOString(),
    };

    console.log(`  [Runs] User:${userPayload.username} Forwarding: "${text.slice(0, 50)}..."`);
    const result = await proxyRequest('POST', '/api/v1/runs', cbBody);
    const resultJson = JSON.parse(result.body);

    if (result.status === 202 && resultJson.data?.runId) {
      res.json({
        data: {
          runId: resultJson.data.runId,
          status: 'accepted',
          sessionId: activeSessionId,
        },
      });
    } else {
      res.status(result.status).json(resultJson);
    }
  } catch (err: any) {
    console.error('[Runs Error]', err.message);
    res.status(502).json({ error: { code: 'PROXY_ERROR', message: `CodeBuddy error: ${err.message}` } });
  }
});

// ========== GET /api/v1/runs/:runId/stream — Transform SSE ==========
app.get('/api/v1/runs/:runId/stream', (req, res) => {
  const { runId } = req.params;

  // Set SSE headers with CORS
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  // CORS headers for SSE
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.flushHeaders();

  console.log(`  [Stream] Connecting to CodeBuddy stream for run ${runId}`);

  // Connect to CodeBuddy SSE
  const cbReq = http.request({
    hostname: CB_HOST,
    port: CB_PORT,
    path: `/api/v1/runs/${runId}/stream`,
    method: 'GET',
    headers: { 'X-CodeBuddy-Request': '1' },
  }, (cbRes) => {
    let buffer = '';
    let fullMarkdown = '';

    cbRes.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '{}') continue;

        try {
          const parsed = JSON.parse(jsonStr);

          if (parsed.content?.markdown) {
            const markdown = parsed.content.markdown;
            fullMarkdown += markdown;

            res.write(`data: ${JSON.stringify({
              type: 'agent_message_chunk',
              content: { text: markdown },
            })}\n\n`);
          }

          if (parsed.agent?.toolCalls?.length > 0) {
            for (const tc of parsed.agent.toolCalls) {
              res.write(`data: ${JSON.stringify({
                type: 'agent_message_chunk',
                content: { text: '' },
                toolCalls: [{
                  id: tc.id || crypto.randomUUID(),
                  name: tc.name,
                  status: tc.status || 'completed',
                  args: tc.args,
                  result: tc.result,
                }],
              })}\n\n`);
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    });

    cbRes.on('end', () => {
      // Try to save assistant message to DB
      if (fullMarkdown) {
        try {
          // Get sessionId from query parameter
          const url = new URL(req.url, `http://${req.headers.host}`);
          const sessionId = url.searchParams.get('sessionId');
          const authHeader = req.headers.authorization;
          const token = authHeader?.startsWith('Bearer ') ? verifyToken(authHeader.slice(7)) : null;
          if (token && sessionId) {
            createMessage(token.userId, sessionId, 'assistant', fullMarkdown).catch(e => {
              console.error('[Stream] Failed to save assistant message:', e.message);
            });
          }
        } catch (e: any) {
          console.error('[Stream] Failed to save assistant message:', e.message);
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'run_status', status: 'completed' })}\n\n`);
      res.end();
      console.log(`  [Stream] Run ${runId} completed`);
    });

    cbRes.on('error', (err) => {
      console.error(`  [Stream] CodeBuddy error:`, err.message);
      res.write(`data: ${JSON.stringify({ type: 'run_status', status: 'failed' })}\n\n`);
      res.end();
    });
  });

  cbReq.setTimeout(120000, () => {
    console.log(`  [Stream] Timeout for run ${runId}`);
    res.write(`data: ${JSON.stringify({ type: 'run_status', status: 'failed' })}\n\n`);
    res.end();
    cbReq.destroy();
  });

  cbReq.on('error', (err) => {
    console.error(`  [Stream] Connection error:`, err.message);
    res.write(`data: ${JSON.stringify({ type: 'run_status', status: 'failed' })}\n\n`);
    res.end();
  });

  cbReq.end();

  // Handle client disconnect
  req.on('close', () => {
    cbReq.destroy();
  });
});

// ========== POST /api/v1/runs/:runId/cancel — Proxy ==========
app.post('/api/v1/runs/:runId/cancel', authMiddleware, async (req, res) => {
  try {
    const result = await proxyRequest('POST', `/api/v1/runs/${req.params.runId}/cancel`);
    res.status(result.status).send(result.body);
  } catch (err: any) {
    res.status(502).json({ error: { code: 'PROXY_ERROR', message: err.message } });
  }
});

// ========== Generic Proxy for other /api/v1/* routes ==========
const genericProxy: RequestHandler = createProxyMiddleware({
  target: CB_BASE,
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq, _req) => {
      if (!proxyReq.getHeader('X-CodeBuddy-Request')) {
        proxyReq.setHeader('X-CodeBuddy-Request', '1');
      }
    },
    error: (err, _req, res) => {
      if (res && 'writeHead' in res) {
        (res as express.Response).status(502).json({
          error: { code: 'PROXY_ERROR', message: `CodeBuddy unavailable: ${err.message}` }
        });
      }
    },
  },
});

app.use('/api/v1', (req, res, next) => {
  // Skip routes handled above
  const skipPaths = ['/auth/login', '/auth/register', '/auth/status', '/auth/me', '/health'];
  if (req.method === 'GET' && skipPaths.includes(req.path)) return next();
  if (req.method === 'POST' && skipPaths.includes(req.path)) return next();
  if (req.path.startsWith('/runs')) return next();
  if (req.path.startsWith('/user/')) return next();
  if (req.path.startsWith('/admin/')) return next();
  return (genericProxy as any)(req, res, next);
});

// ========== Serve Frontend (only in local dev mode) ==========
if (process.env.NODE_ENV !== 'production' || process.env.SERVE_FRONTEND === 'true') {
  const distPath = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(distPath, 'index.html'));
      }
    });
    console.log('[Static] Serving frontend from', distPath);
  } else {
    console.log('[Static] No dist/ directory found. Run "npm run build".');
  }
}

// ========== Auto-start CodeBuddy HTTP Server ==========
let cbProcess: ChildProcess | null = null;

function getCliPath(): string {
  // Linux (Railway/Docker): global install path
  const linuxPath = '/usr/local/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy';
  // Windows (local dev): %APPDATA% path
  const winPath = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@tencent-ai', 'codebuddy-code', 'bin', 'codebuddy');
  // Local node_modules
  const localPath = path.join(__dirname, '..', 'node_modules', '@tencent-ai', 'codebuddy-code', 'bin', 'codebuddy');

  try { if (fs.existsSync(linuxPath)) return linuxPath; } catch {}
  try { if (fs.existsSync(winPath)) return winPath; } catch {}
  try { if (fs.existsSync(localPath)) return localPath; } catch {}

  // Fallback: rely on PATH
  return 'codebuddy';
}

function isCliInstalled(): boolean {
  const cliPath = getCliPath();
  if (cliPath === 'codebuddy') {
    // Check if codebuddy is in PATH
    try {
      const result = spawnSync('which', ['codebuddy'], { timeout: 3000 });
      return result.status === 0;
    } catch {
      return false;
    }
  }
  return fs.existsSync(cliPath);
}

function installCli(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('[CodeBuddy] Installing @tencent-ai/codebuddy-code globally...');
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const install = spawn(npmCmd, ['install', '-g', '@tencent-ai/codebuddy-code'], {
      stdio: 'pipe',
      shell: true,
    });

    install.stdout.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[CodeBuddy:install] ${msg}`);
    });

    install.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[CodeBuddy:install] ${msg}`);
    });

    install.on('close', (code) => {
      if (code === 0) {
        console.log('[CodeBuddy] CLI installed successfully');
        resolve();
      } else {
        reject(new Error(`npm install -g failed with code ${code}`));
      }
    });

    install.on('error', (err) => {
      reject(new Error(`npm install -g error: ${err.message}`));
    });
  });
}

function startCodeBuddy() {
  const cliPath = getCliPath();

  console.log(`[CodeBuddy] Starting HTTP server on port ${CB_PORT}...`);
  console.log(`[CodeBuddy] CLI path: ${cliPath}`);

  cbProcess = spawn(process.execPath, [cliPath, '--serve', '--port', String(CB_PORT)], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CODEBUDDY_DISABLE_REQUEST_VALIDATION: '1',
    },
  });

  cbProcess.stdout.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[CodeBuddy] ${msg}`);
  });

  cbProcess.stderr.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[CodeBuddy:err] ${msg}`);
  });

  cbProcess.on('close', (code) => {
    console.log(`[CodeBuddy] Process exited with code ${code}`);
    cbProcess = null;
  });

  cbProcess.on('error', (err) => {
    console.error(`[CodeBuddy] Failed to start:`, err.message);
  });
}

async function ensureCodeBuddy() {
  // Only start CodeBuddy CLI if not connecting to external host
  if (CB_HOST !== '127.0.0.1' && CB_HOST !== 'localhost') {
    console.log(`[CodeBuddy] Connecting to external host: ${CB_BASE}`);
    return;
  }

  // Install CLI if not found
  if (!isCliInstalled()) {
    try {
      await installCli();
    } catch (err: any) {
      console.error(`[CodeBuddy] CLI installation failed: ${err.message}`);
      console.error('[CodeBuddy] Will try to start anyway...');
    }
  }

  startCodeBuddy();

  // Wait briefly and verify
  await new Promise(resolve => setTimeout(resolve, 3000));

  try {
    const health = await proxyRequest('GET', '/api/v1/health', undefined, 5000);
    if (health.status === 200) {
      console.log('[CodeBuddy] HTTP Server is up');
    } else {
      console.warn(`[CodeBuddy] Health check returned ${health.status}`);
    }
  } catch (e: any) {
    console.warn(`[CodeBuddy] Health check failed: ${e.message}`);
    console.warn('[CodeBuddy] Will retry on first request...');
  }
}

// ========== Start ==========
async function start() {
  // Initialize database first
  await initDatabase();

  // Start Express server FIRST (so Railway health check passes)
  app.listen(APP_PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  =======================================');
    console.log('');
    console.log('   YooClaw - Cloud Deployment');
    console.log('');
    console.log(`   URL:      http://localhost:${APP_PORT}`);
    console.log(`   Backend:  ${CB_BASE}`);
    console.log(`   DB:       PostgreSQL (Supabase)`);
    console.log('');
    console.log('  =======================================');
    console.log('');
  });

  // Then install & start CodeBuddy CLI in the background
  ensureCodeBuddy().catch(err => {
    console.error('[CodeBuddy] Background setup failed:', err.message);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n[Shutdown] Stopping...');
  if (cbProcess) cbProcess.kill('SIGTERM');
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (cbProcess) cbProcess.kill('SIGTERM');
  process.exit(0);
});
