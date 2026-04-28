# YooClaw 云端部署指南

## 架构概览

```
[用户浏览器]
    ↓ HTTPS
[Vercel] ← 静态前端 (React SPA)
    ↓ API 请求 (VITE_API_BASE)
[Railway] ← Express 后端 + CodeBuddy CLI
    ↓ SQL
[Supabase] ← PostgreSQL 数据库
```

---

## 一、Supabase 配置

### 1.1 获取连接字符串

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)
2. 选择你的项目
3. 进入 **Settings → Database**
4. 找到 **Connection string → URI**
5. 选择 **Transaction pooler** 模式（端口 6543）
6. 复制连接字符串，格式类似：
   ```
   postgresql://postgres.xxxxx:YOUR-PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
   ```

### 1.2 建表（可选）

> 应用启动时会自动建表（`initDatabase()`），此步骤仅在需要手动初始化时执行。

打开 **SQL Editor**，粘贴 `supabase-init.sql` 的内容并执行。

### 1.3 记录 DATABASE_URL

将上一步获取的连接字符串保存好，后面 Railway 会用到。

---

## 二、Railway 部署（后端）

### 2.1 创建项目

1. 登录 [Railway](https://railway.app)
2. 点击 **New Project**
3. 选择 **Deploy from GitHub Repo**（需先关联 Gitee → GitHub 镜像）
   
   **或者** 选择 **Empty Project**，然后手动连接仓库。

> ⚠️ Railway 不直接支持 Gitee。你有两个选择：
> - **方案 A**：在 GitHub 上创建同名镜像仓库，设置 Gitee → GitHub 自动同步
> - **方案 B**：使用 Railway CLI 从本地推送

### 2.2 方案 A：GitHub 镜像（推荐）

1. 在 GitHub 创建 `YooClaw` 仓库
2. 在 Gitee 仓库设置中开启 **推送同步到 GitHub**
3. 或手动添加 GitHub remote：
   ```bash
   git remote add github https://github.com/zodastream-dev/YooClaw.git
   git push github master
   ```
4. 在 Railway 中选择 GitHub 仓库部署

### 2.3 方案 B：Railway CLI 推送

```bash
# 安装 Railway CLI
npm install -g @railway/cli

# 登录
railway login

# 在 codebuddy-web 目录下
railway init

# 推送部署
railway up
```

### 2.4 配置环境变量

在 Railway 项目 → **Variables** 中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DATABASE_URL` | `postgresql://postgres.xxxxx:...@...supabase.com:6543/postgres` | Supabase 连接字符串 |
| `JWT_SECRET` | 自定义强密码，如 `yK9mR2pL8xN4vB7wQ3jF6hC1` | JWT 签名密钥（必须设置！） |
| `CB_HOST` | `127.0.0.1` | CodeBuddy CLI 在本地启动 |
| `NODE_ENV` | `production` | 生产模式 |
| `FRONTEND_URL` | `https://your-app.vercel.app` | Vercel 前端 URL（CORS） |

### 2.5 确认部署配置

Railway 会自动读取 `railway.toml`：
- **构建器**: NIXPACKS
- **启动命令**: `npm install -g @tencent-ai/codebuddy-code && npx tsx server/index.ts`
- **健康检查**: `/api/health`

### 2.6 获取 Railway URL

部署成功后，Railway 会分配一个域名，格式如：
```
https://yooclaw-production.up.railway.app
```

记录这个 URL，Vercel 前端会连接它。

### 2.7 验证

```bash
# 健康检查
curl https://your-railway-app.up.railway.app/api/health

# 测试登录
curl -X POST https://your-railway-app.up.railway.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

---

## 三、Vercel 部署（前端）

### 3.1 导入项目

1. 登录 [Vercel](https://vercel.com)
2. 点击 **Add New → Project**
3. 选择 GitHub 上的 `YooClaw` 仓库
4. 配置：
   - **Framework Preset**: Vite
   - **Root Directory**: `codebuddy-web`（如果仓库根目录就是项目，留空）
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

### 3.2 配置环境变量

在 Vercel 项目 → **Settings → Environment Variables** 中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `VITE_API_BASE` | `https://your-railway-app.up.railway.app` | Railway 后端地址（不含尾部斜杠） |

### 3.3 部署

点击 **Deploy**，Vercel 会自动构建并部署。

### 3.4 验证

1. 访问 Vercel 分配的域名
2. 尝试登录（admin / admin）
3. 创建新对话测试

---

## 四、完整环境变量清单

### Railway（后端）

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | ✅ | Supabase PostgreSQL 连接字符串 |
| `JWT_SECRET` | ✅ | JWT 签名密钥，无默认值 |
| `CB_HOST` | ❌ | 默认 `127.0.0.1`，Railway 上保持默认 |
| `NODE_ENV` | ❌ | 默认 `production` |
| `FRONTEND_URL` | ❌ | CORS 白名单，填 Vercel 域名 |
| `PORT` | ❌ | Railway 自动设置 |

### Vercel（前端）

| 变量 | 必填 | 说明 |
|------|------|------|
| `VITE_API_BASE` | ✅ | Railway 后端完整 URL |

---

## 五、部署检查清单

- [ ] Supabase 项目已创建，连接字符串已获取
- [ ] GitHub 镜像仓库已创建（或使用 Railway CLI）
- [ ] Railway 项目已创建并部署成功
- [ ] Railway 环境变量已配置（DATABASE_URL, JWT_SECRET, FRONTEND_URL）
- [ ] Railway 健康检查 `/api/health` 返回 200
- [ ] Vercel 项目已创建并部署成功
- [ ] Vercel 环境变量已配置（VITE_API_BASE）
- [ ] 前端可正常登录
- [ ] 前端可创建对话并发送消息
- [ ] SSE 流式响应正常工作
