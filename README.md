# CodeBuddy Web - HTTP Proxy 模式

这是一个基于 CodeBuddy HTTP API 的 Web 代理前端，使用用户自己的 WorkBuddy API Key 提供 AI 对话服务。

## 架构

### 核心组件
1. **CodeBuddy CLI HTTP Server** (端口 8081)
   - 使用用户配置的 API Key
   - 提供完整的 ACP 协议接口

2. **Express 代理服务器** (端口 3001)
   - 前端身份验证 (JWT)
   - API 格式转换：CodeBuddy 格式 ↔ 前端格式
   - 自动启动/管理 CodeBuddy 进程
   - 静态前端文件服务

3. **React 前端** (Vite + TypeScript + Tailwind)
   - 仿 CodeBuddy 桌面端 UI
   - SSE 流式响应
   - 会话管理

### 数据流
```
前端 → Express (3001) → 格式转换 → CodeBuddy (8081) → WorkBuddy API
前端 ← Express (3001) ← 格式转换 ← CodeBuddy (8081) ← WorkBuddy API
```

## 配置

### 1. 安装 CodeBuddy CLI
```bash
npm install -g @tencent-ai/codebuddy-code
```

### 2. 配置 API Key
编辑 `~/.codebuddy/models.json`:
```json
{
  "models": [{
    "id": "glm-5.0",
    "name": "GLM 5.0",
    "vendor": "Tencent Cloud",
    "apiKey": "你的API Key",
    "url": "https://api.lkeap.cloud.tencent.com/plan/v3"
  }],
  "availableModels": ["glm-5.0"]
}
```

### 3. 环境变量
```bash
APP_PORT=3001        # Express 端口
CB_PORT=8081         # CodeBuddy 端口
APP_PASSWORD=admin   # 前端登录密码
JWT_SECRET=...       # JWT 密钥
```

## 启动

### 开发模式
```bash
npm run dev
```

### 生产模式
1. 构建前端：
   ```bash
   npm run build
   ```

2. 启动服务器：
   ```bash
   npm run server
   ```

### 访问
1. 打开 http://localhost:3001
2. 使用密码 `admin` 登录

## 文件结构

```
codebuddy-web/
├── server/
│   └── index.ts         # Express 代理服务器 (v3 代理模式)
├── src/
│   ├── components/      # React 组件
│   ├── lib/            # API 客户端、状态管理
│   ├── pages/          # 页面组件
│   └── App.tsx         # 主应用
├── dist/               # 构建后的前端文件
├── public/             # 静态资源
└── package.json        # 项目依赖
```

## 已移除的组件

- **@tencent-ai/agent-sdk**: 改为 HTTP 代理模式
- **sql.js 数据库**: 使用 CodeBuddy 的会话管理
- **各种测试脚本**: 简化开发流程

## 故障排除

### CodeBuddy 未启动
1. 检查是否安装 CLI: `codebuddy --version`
2. 检查 API Key 配置: `~/.codebuddy/models.json`
3. 查看 Express 日志中的 CodeBuddy 输出

### 代理错误
1. 检查端口占用: `netstat -ano | findstr :8081`
2. 重启 Express 服务器
3. 确保 CodeBuddy 进程已启动

### 格式转换问题
代理服务器会自动转换格式：
- CodeBuddy `{content:{markdown:...}}` → 前端 `{type:'agent_message_chunk',content:{text:...}}`
- 添加必需字段: `id`, `type`, `timestamp`