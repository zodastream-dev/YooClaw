-- ============================================================
-- YooClaw - Supabase 建表 SQL
--
-- 说明：应用启动时 initDatabase() 会自动建表和创建 admin 用户
-- 此文件供手动初始化或故障恢复使用，可选择性执行
-- ============================================================

-- 1. 用户表
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  storage_used BIGINT DEFAULT 0,
  storage_limit BIGINT DEFAULT 20971520,  -- 20MB
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 用户会话表
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  session_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 用户消息表
CREATE TABLE IF NOT EXISTS user_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. 索引
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_messages_user_id ON user_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_user_messages_session_id ON user_messages(session_id);

-- 5. Payment: 会员套餐
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
);

-- 6. Payment: 积分包
CREATE TABLE IF NOT EXISTS credit_packages (
  id SERIAL PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  credits INTEGER NOT NULL,
  price_yuan INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Payment: 用户会员状态
CREATE TABLE IF NOT EXISTS user_memberships (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL,
  tier VARCHAR(16) NOT NULL CHECK (tier IN ('free', 'basic', 'premium')),
  started_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  auto_renew BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Payment: 用户积分
CREATE TABLE IF NOT EXISTS user_credits (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  total_earned INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 9. Payment: 订单
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_type VARCHAR(16) NOT NULL CHECK (order_type IN ('membership', 'credit_package')),
  product_id INTEGER NOT NULL,
  product_name VARCHAR(128) NOT NULL,
  amount_yuan INTEGER NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'refunded')),
  payment_method VARCHAR(16) CHECK (payment_method IN ('wechat', 'alipay')),
  payment_url TEXT DEFAULT '',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  expired_at TIMESTAMPTZ DEFAULT (now() + interval '15 minutes')
);

-- 10. Payment: 支付记录
CREATE TABLE IF NOT EXISTS payment_records (
  id SERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method VARCHAR(16) NOT NULL CHECK (method IN ('wechat', 'alipay')),
  transaction_id VARCHAR(128) NOT NULL,
  amount_yuan INTEGER NOT NULL,
  raw_callback TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 11. Payment: 积分交易流水
CREATE TABLE IF NOT EXISTS credit_transactions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(16) NOT NULL CHECK (type IN ('charge', 'consume', 'refund', 'monthly_grant')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL DEFAULT 0,
  description VARCHAR(256) DEFAULT '',
  related_id VARCHAR(128) DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Payment indexes
CREATE INDEX IF NOT EXISTS idx_user_memberships_user_id ON user_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_payment_records_order_id ON payment_records(order_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);

-- Seed data: membership plans
INSERT INTO membership_plans (name, tier, price_yuan, duration_days, monthly_credits, features) VALUES
('免费版', 'free', 0, 99999, 0, '["基础AI对话","每日10次","1个分析门户"]'),
('基础会员（月付）', 'basic', 29, 30, 500, '["无限AI对话","每日简报","每月500积分","3个分析门户","视频生成8折"]'),
('基础会员（年付）', 'basic', 199, 365, 500, '["无限AI对话","每日简报","每月500积分","5个分析门户","视频生成8折"]'),
('高级会员（月付）', 'premium', 69, 30, 2000, '["无限AI对话","每日简报","每月2000积分","10个分析门户","视频生成5折","专属功能"]'),
('高级会员（年付）', 'premium', 499, 365, 2000, '["无限AI对话","每日简报","每月2000积分","无限分析门户","视频生成5折","专属功能"]')
ON CONFLICT DO NOTHING;

-- Seed data: credit packages
INSERT INTO credit_packages (name, credits, price_yuan) VALUES
('100积分', 100, 10),
('500积分', 500, 40),
('2000积分', 2000, 120),
('5000积分', 5000, 250)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Supabase 连接字符串获取方式：
-- Settings → Database → Connection string → URI
-- 格式: postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
--
-- ⚠️ admin 用户会在应用首次启动时自动创建（用户名: admin, 密码: admin）
-- ============================================================
