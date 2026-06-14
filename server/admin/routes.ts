/**
 * Admin API Routes — YooClaw 管理后台
 * All routes are protected by authMiddleware + adminMiddleware (applied in index.ts)
 * Login is handled directly in index.ts (no auth required)
 */
import { Router, Request, Response } from 'express';
import { sql } from '../db.js';

const router = Router();

// ==================== Dashboard ====================

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const monthStart = now.toISOString().slice(0, 7) + '-01';

    const [totalUsers, todayUsers, monthUsers, paidOrders, monthOrders,
      memberships, creditsTotal, portals, videos, storageTotal] = await Promise.all([
      sql`SELECT COUNT(*)::int as cnt FROM users`.then(r => r[0].cnt),
      sql`SELECT COUNT(*)::int as cnt FROM users WHERE created_at::date = ${today}`.then(r => r[0].cnt),
      sql`SELECT COUNT(*)::int as cnt FROM users WHERE created_at >= ${monthStart}`.then(r => r[0].cnt),
      sql`SELECT COUNT(*)::int as cnt, COALESCE(SUM(amount_yuan), 0)::int as total FROM orders WHERE status = 'paid'`.then(r => r[0]),
      sql`SELECT COALESCE(SUM(amount_yuan), 0)::int as total FROM orders WHERE status = 'paid' AND created_at >= ${monthStart}`.then(r => r[0].total),
      sql`SELECT tier, COUNT(*)::int as cnt FROM user_memberships WHERE status = 'active' GROUP BY tier`.then(r => r),
      sql`SELECT COALESCE(SUM(balance_after), 0)::int as total FROM (SELECT DISTINCT ON (user_id) balance_after FROM credit_transactions ORDER BY user_id, created_at DESC) t`.then(r => r[0].total),
      sql`SELECT COUNT(*)::int as cnt FROM report_sites WHERE type = 'portal'`.then(r => r[0].cnt),
      sql`SELECT COUNT(*)::int as cnt FROM videos`.then(r => r[0].cnt),
      sql`SELECT COALESCE(SUM(size_bytes), 0)::bigint as total FROM report_sites`.then(r => Number(r[0].total)),
    ]);

    const memberDist: Record<string, number> = {};
    for (const m of (memberships as any[])) memberDist[m.tier || 'free'] = m.cnt;

    res.json({ data: {
      users: { total: totalUsers, today: todayUsers, month: monthUsers },
      payments: { totalOrders: paidOrders.cnt, totalAmount: paidOrders.total, monthAmount: monthOrders },
      memberships: memberDist,
      creditsTotal,
      portals,
      videos,
      storageTotal,
    }});
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ==================== Users ====================

router.get('/users', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const search = (req.query.search as string) || '';
    const offset = (page - 1) * limit;

    let where = '';
    if (search) {
      where = ` WHERE u.username ILIKE '%${search.replace(/'/g, "''")}%'`;
    }

    const countRow = await sql.unsafe(`SELECT COUNT(*)::int as cnt FROM users u${where}`);
    const total = countRow[0].cnt;

    const rows = await sql.unsafe(`
      SELECT u.id, u.username, u.role, u.status, u.created_at,
        COALESCE(um.tier, 'free') as tier,
        COALESCE(um.expires_at, NULL) as member_expires,
        (SELECT COALESCE(balance_after, 0) FROM credit_transactions WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as credits,
        (SELECT COUNT(*) FROM report_sites WHERE user_id = u.id) as portal_count,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM report_sites WHERE user_id = u.id) as storage_used
      FROM users u
      LEFT JOIN user_memberships um ON um.user_id = u.id AND um.status = 'active'
      ${where}
      ORDER BY u.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    res.json({ data: { users: rows, total, page, limit } });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

router.get('/users/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;
    const [user, membership, credits, portals, videos, orders, transactions] = await Promise.all([
      sql`SELECT id, username, role, status, created_at FROM users WHERE id = ${userId}`.then(r => r[0]),
      sql`SELECT tier, status, expires_at, created_at FROM user_memberships WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1`.then(r => r[0]),
      sql`SELECT balance_after as credits FROM credit_transactions WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1`.then(r => r[0]?.credits || 0),
      sql`SELECT id, title, slug, type, is_published, view_count, size_bytes, created_at FROM report_sites WHERE user_id = ${userId} ORDER BY created_at DESC`.then(r => r),
      sql`SELECT id, title, duration, created_at FROM videos WHERE user_id = ${userId} ORDER BY created_at DESC`.then(r => r),
      sql`SELECT id, order_type, product_name, amount_yuan, status, payment_method, paid_at, created_at FROM orders WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50`.then(r => r),
      sql`SELECT id, type, amount, description, related_id, created_at FROM credit_transactions WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50`.then(r => r),
    ]);

    if (!user) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } }); return; }

    res.json({ data: { user, membership, credits, portals, videos, orders, transactions } });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

router.post('/users/:id/status', async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;
    const { status } = req.body as { status: 'active' | 'disabled' };
    if (!['active', 'disabled'].includes(status)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'status must be active or disabled' } });
      return;
    }
    await sql`UPDATE users SET status = ${status} WHERE id = ${userId}`;
    res.json({ data: { ok: true } });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

router.post('/users/:id/credits', async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;
    const { amount, description } = req.body as { amount: number; description: string };
    if (!amount || amount === 0) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'amount required' } });
      return;
    }

    const current = await sql`SELECT COALESCE(balance_after, 0) as bal FROM credit_transactions WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1`.then(r => r[0]?.bal || 0);
    const newBalance = current + amount;

    await sql`
      INSERT INTO credit_transactions (user_id, type, amount, balance_after, description)
      VALUES (${userId}, ${amount > 0 ? 'charge' : 'consume'}, ${amount}, ${newBalance}, ${description || '管理员操作'})
    `;
    res.json({ data: { ok: true, balance: newBalance } });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ==================== Payments ====================

router.get('/payments', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const status = req.query.status as string;
    const offset = (page - 1) * limit;

    let where = '';
    if (status && ['pending', 'paid', 'expired', 'refunded'].includes(status)) {
      where = ` WHERE o.status = '${status}'`;
    }

    const countRow = await sql.unsafe(`SELECT COUNT(*)::int as cnt FROM orders o${where}`);
    const total = countRow[0].cnt;

    const rows = await sql.unsafe(`
      SELECT o.id, o.user_id, u.username, o.order_type, o.product_name, o.amount_yuan, o.status,
        o.payment_method, o.paid_at, o.created_at
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      ${where}
      ORDER BY o.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    res.json({ data: { payments: rows, total, page, limit } });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ==================== Portals ====================

router.get('/portals', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const countRow = await sql`SELECT COUNT(*)::int as cnt FROM report_sites WHERE type = 'portal'`;
    const total = countRow[0].cnt;

    const rows = await sql`
      SELECT r.id, r.user_id, u.username, r.title, r.slug, r.is_published, r.view_count,
        r.size_bytes, r.created_at, r.url
      FROM report_sites r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.type = 'portal'
      ORDER BY r.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    res.json({ data: { portals: rows, total, page, limit } });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ==================== Videos ====================

router.get('/videos', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const countRow = await sql`SELECT COUNT(*)::int as cnt FROM videos`;
    const total = countRow[0].cnt;

    const rows = await sql`
      SELECT v.id, v.user_id, u.username, v.title, v.duration, v.created_at
      FROM videos v
      LEFT JOIN users u ON u.id = v.user_id
      ORDER BY v.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    res.json({ data: { videos: rows, total, page, limit } });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ==================== Settings ====================

router.get('/config', async (_req: Request, res: Response) => {
  try {
    const [membershipPlans, creditPackages] = await Promise.all([
      sql`SELECT * FROM membership_plans ORDER BY price_yuan`,
      sql`SELECT * FROM credit_packages ORDER BY price_yuan`,
    ]);
    res.json({ data: { membershipPlans, creditPackages } });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

router.put('/config/membership/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { price_yuan, monthly_credits, duration_days, features } = req.body as any;
    await sql`
      UPDATE membership_plans SET price_yuan = ${price_yuan}, monthly_credits = ${monthly_credits},
        duration_days = ${duration_days}, features = ${JSON.stringify(features || [])}
      WHERE id = ${id}
    `;
    res.json({ data: { ok: true } });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

router.put('/config/credits/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { credits, price_yuan } = req.body as any;
    await sql`UPDATE credit_packages SET credits = ${credits}, price_yuan = ${price_yuan} WHERE id = ${id}`;
    res.json({ data: { ok: true } });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

export default router;
