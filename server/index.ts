import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
// Agent SDK removed — using direct HTTP API to CodeBuddy cloud
import {
  initDatabase,
  hashPassword,
  verifyPassword,
  createUser,
  getUserByUsername,
  getUserById,
  getAllUsers,
  updateUserStatus,
  updateUserPassword,
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
  createReportSite,
  getReportSiteBySlug,
  getUserReportSites,
  deleteReportSite,
  incrementSiteViewCount,
  getSiteCountByType,
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ========== Helper: Convert BIGINT strings to numbers ==========
// PostgreSQL BIGINT returns strings, but we need numbers for JSON response
function toNumber(val: unknown): number {
  return typeof val === 'string' ? Number(val) : (val as number) || 0;
}

function formatUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    storageUsed: toNumber(user.storage_used),
    storageLimit: toNumber(user.storage_limit),
    status: user.status,
  };
}

// ========== Configuration ==========
const APP_PORT = Number(process.env.PORT) || Number(process.env.APP_PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET environment variable is required');
  process.exit(1);
}

// CodeBuddy API configuration (direct HTTP API mode)
const CODEBUDDY_API_KEY = process.env.CODEBUDDY_API_KEY;
const CODEBUDDY_API_ENDPOINT = process.env.CODEBUDDY_INTERNET_ENVIRONMENT === 'internal'
  ? 'https://copilot.tencent.com'
  : 'https://api.codebuddy.ai';
const CODEBUDDY_MODEL = process.env.CODEBUDDY_MODEL || 'deepseek-v3.1';

if (!CODEBUDDY_API_KEY) {
  console.warn('[WARN] CODEBUDDY_API_KEY is not set. AI features will not work.');
}

// ========== Slug Helper ==========
function generateSlug(text: string): string {
  // Simple Chinese-to-pinyin-like slug: keep alphanumeric + hyphens
  let slug = text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fa5-]/g, '')  // Keep Chinese chars, alphanumeric, hyphens
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  // Add a short random suffix to ensure uniqueness
  const suffix = crypto.randomBytes(3).toString('hex');
  return slug ? `${slug}-${suffix}` : `site-${suffix}`;
}

// ========== Portal HTML Generator ==========
function generatePortalHtml(siteName: string, siteDesc: string, template: string, apiBase: string): string {
  const templates: Record<string, {primary: string; secondary: string; bg: string; text: string; accent: string}> = {
    'business-blue': { primary: '#2563eb', secondary: '#1e40af', bg: '#ffffff', text: '#1f2937', accent: '#3b82f6' },
    'tech-black': { primary: '#0f172a', secondary: '#38bdf8', bg: '#0f172a', text: '#e2e8f0', accent: '#38bdf8' },
    'simple-white': { primary: '#1a1a2e', secondary: '#f59e0b', bg: '#ffffff', text: '#1a1a2e', accent: '#f59e0b' },
  };
  const theme = templates[template] || templates['business-blue'];
  const isDark = template === 'tech-black';
  const headerBg = template === 'tech-black'
    ? 'background:linear-gradient(135deg,#0f172a,#1e293b);border-bottom:2px solid ' + theme.secondary
    : template === 'simple-white'
      ? 'background:' + theme.bg + ';border-bottom:2px solid #e5e7eb'
      : 'background:linear-gradient(135deg,' + theme.primary + ',' + theme.secondary + ')';
  const pageBg = isDark ? '#020617' : '#f8fafc';
  const cardBg = isDark ? '#0f172a' : '#ffffff';
  const borderClr = isDark ? '#1e293b' : '#e5e7eb';
  const inputBg = isDark ? '#1e293b' : '#ffffff';
  const inputBorder = isDark ? '#334155' : '#d1d5db';
  const textClr = isDark ? '#e2e8f0' : '#1f2937';
  const mutedClr = '#94a3b8';
  const successBg = isDark ? '#0f172a' : '#f0fdf4';
  const successBorder = isDark ? '#166534' : '#bbf7d0';
  const successText = isDark ? '#4ade80' : '#16a34a';
  const errBg = isDark ? '#450a0a' : '#fef2f2';
  const errBorder = isDark ? '#991b1b' : '#fecaca';
  const errText = isDark ? '#fca5a5' : '#dc2626';

  const sn = siteName.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const sd = siteDesc.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${sn}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;background:${pageBg};color:${textClr};min-height:100vh}
.header{${headerBg};padding:40px 20px;text-align:center}
.header h1{font-size:28px;font-weight:700;color:${isDark?'#f1f5f9':'#ffffff'};margin-bottom:8px}
.header p{font-size:15px;color:${isDark?'#94a3b8':'rgba(255,255,255,0.85)'};max-width:600px;margin:0 auto;line-height:1.5}
.container{max-width:720px;margin:0 auto;padding:24px 16px 60px}
.footer{text-align:center;padding:20px;font-size:12px;color:#94a3b8;border-top:1px solid ${borderClr}}
.card{background:${cardBg};border:1px solid ${borderClr};border-radius:12px;padding:24px;margin-bottom:16px}
.card h3{font-size:16px;font-weight:600;margin-bottom:6px}
.card p{font-size:13px;color:${mutedClr};margin-bottom:16px;line-height:1.5}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:13px;font-weight:500;margin-bottom:6px}
.form-group input{width:100%;padding:10px 14px;font-size:14px;border:1px solid ${inputBorder};border-radius:8px;background:${inputBg};color:${textClr};outline:none}
.form-group input:focus{border-color:${theme.primary};box-shadow:0 0 0 3px ${theme.primary}22}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px 20px;font-size:14px;font-weight:600;border:none;border-radius:8px;cursor:pointer;transition:opacity .2s;color:#fff;background:${theme.primary}}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn:hover:not(:disabled){opacity:.9}
.progress-section{margin-top:16px}
.progress-label{display:flex;justify-content:space-between;font-size:12px;color:${mutedClr};margin-bottom:6px}
.progress-bar{height:6px;background:${isDark?'#1e293b':'#e5e7eb'};border-radius:3px;overflow:hidden}
.progress-fill{height:100%;background:linear-gradient(90deg,${theme.primary},${theme.accent});border-radius:3px;transition:width .5s ease-out}
.stage-text{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;background:${isDark?'#1e293b':'#f8fafc'};border-radius:8px;margin-top:12px;font-size:13px;color:${mutedClr};line-height:1.5}
.spinner{width:14px;height:14px;border:2px solid ${theme.primary}33;border-top-color:${theme.primary};border-radius:50%;animation:spin .6s linear infinite;flex-shrink:0;margin-top:2px}
@keyframes spin{to{transform:rotate(360deg)}}
.result-section{margin-top:16px}
.result-card{background:${successBg};border:1px solid ${successBorder};border-radius:12px;padding:24px;text-align:center}
.result-card h3{font-size:18px;color:${successText};margin-bottom:8px}
.result-card .url-box{display:flex;align-items:center;gap:8px;background:${cardBg};border:1px solid ${inputBorder};border-radius:8px;padding:10px 14px;margin-top:12px}
.result-card .url-box a{flex:1;font-size:13px;color:${theme.primary};text-decoration:none;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.result-card .url-box a:hover{text-decoration:underline}
.error-box{background:${errBg};border:1px solid ${errBorder};border-radius:8px;padding:14px;margin-top:12px;font-size:13px;color:${errText};line-height:1.5;white-space:pre-wrap}
</style>
</head>
<body>
<div class="header">
  <h1>${sn}</h1>
  ${sd ? '<p>'+sd+'</p>' : ''}
</div>
<div class="container">
  <div class="card" id="step1">
    <h3>行业分析报告</h3>
    <p>输入公司或行业名称，AI 将自动搜索信息并生成专业的分析报告。</p>
    <div class="form-group"><label>公司 / 行业名称</label>
    <input type="text" id="companyInput" placeholder="例如：比亚迪、特斯拉、宁德时代..."/></div>
    <button class="btn" id="startBtn" onclick="startAnalysis()">开始分析</button>
  </div>
  <div class="card" id="step2" style="display:none">
    <h3>正在搜索行业信息</h3>
    <p id="s2sub" style="font-size:13px;color:${mutedClr}"></p>
    <div class="progress-section">
      <div class="progress-label"><span>搜索进度</span><span id="sp">0%</span></div>
      <div class="progress-bar"><div class="progress-fill" id="sbar" style="width:0%"></div></div>
      <div class="stage-text" id="stxt" style="display:none"><div class="spinner"></div><span id="smsg"></span></div>
    </div>
  </div>
  <div class="card" id="step3" style="display:none">
    <h3>正在生成深度分析报告</h3>
    <p id="s3sub" style="font-size:13px;color:${mutedClr}"></p>
    <div class="progress-section">
      <div class="progress-label"><span>报告进度</span><span id="rp">0%</span></div>
      <div class="progress-bar"><div class="progress-fill" id="rbar" style="width:0%"></div></div>
      <div class="stage-text" id="rtxt" style="display:none"><div class="spinner"></div><span id="rmsg"></span></div>
    </div>
  </div>
  <div class="card" id="result" style="display:none">
    <div class="result-card" id="rsucc" style="display:none">
      <h3>报告生成成功!</h3>
      <p id="rtitle" style="font-size:13px;color:#6b7280;margin-bottom:4px"></p>
      <div class="url-box">
        <a id="rlink" href="#" target="_blank" rel="noopener"></a>
        <button onclick="copyUrl()" style="flex-shrink:0;padding:4px 10px;font-size:12px;background:${theme.primary};color:#fff;border:none;border-radius:6px;cursor:pointer">复制</button>
      </div>
    </div>
    <div class="error-box" id="rerr" style="display:none"></div>
  </div>
</div>
<div class="footer">Powered by <strong>YooClaw AI</strong></div>
<script>
var API='${apiBase}';
function $(id){return document.getElementById(id)}
function h(id){$(id).style.display='none'}
function s(id){$(id).style.display='block'}
function t(id,v){$(id).textContent=v}
async function*_s(url,body){
  var r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw new Error('HTTP '+r.status);
  var rd=r.body.getReader(),dc=new TextDecoder(),buf='';
  try{while(true){var{done,value}=await rd.read();if(done)break;buf+=dc.decode(value,{stream:true});var ls=buf.split('\\n');buf=ls.pop()||'';for(var l of ls){if(!l.startsWith('data: '))continue;var js=l.slice(6).trim();if(!js||js==='{}')continue;try{yield JSON.parse(js)}catch{}}}}
  finally{rd.releaseLock()}
}
async function startAnalysis(){
  var n=$('companyInput').value.trim();if(!n)return;
  h('step1');h('result');s('step2');h('step3')
  t('s2sub',n);t('sp','0%');$('sbar').style.width='0%';t('smsg','');$('stxt').style.display='none';
  try{
    var rt='';
    for await(var ev of _s(API+'/api/v1/sites/research',{companyName:n,businessDesc:'',analysisMethods:['SWOT','PEST'],perspective:'investor'})){
      if(ev.type==='progress_update'){t('sp',ev.percent+'%');$('sbar').style.width=ev.percent+'%'}
      else if(ev.type==='stage'){$('stxt').style.display='flex';t('smsg',ev.text)}
      else if(ev.type==='research_complete'){rt=ev.data||''}
      else if(ev.type==='error'){throw new Error(ev.message||'搜索失败')}
    }
    h('step2');s('step3');t('s3sub',n);t('rp','0%');$('rbar').style.width='0%';t('rmsg','');$('rtxt').style.display='none';
    var url='';
    for await(var ev of _s(API+'/api/v1/sites/report',{formData:{companyName:n,businessDesc:'',analysisMethods:['SWOT','PEST'],perspective:'investor'},researchData:rt})){
      if(ev.type==='progress_update'){t('rp',ev.percent+'%');$('rbar').style.width=ev.percent+'%'}
      else if(ev.type==='stage'){$('rtxt').style.display='flex';t('rmsg',ev.text)}
      else if(ev.type==='report_complete'){url=ev.url||''}
      else if(ev.type==='error'){throw new Error(ev.message||'生成失败')}
    }
    h('step3');s('result');
    if(url){$('rsucc').style.display='block';t('rtitle',n+' 行业分析报告');var lu=window.location.origin+url;$('rlink').href=lu;$('rlink').textContent=lu}
    else throw new Error('未获取到链接');
  }catch(e){h('step2');h('step3');s('result');$('rsucc').style.display='none';$('rerr').style.display='block';$('rerr').textContent='错误: '+e.message}
}
function copyUrl(){navigator.clipboard.writeText($('rlink').textContent);event.target.textContent='已复制';setTimeout(function(){event.target.textContent='复制'},2000)}
</script>
</body>
</html>`;
}

// ========== Report HTML Generator ==========
function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function generateReportHtml(companyName: string): Promise<string> {
  const prompt = `你是一个专业的行业分析报告生成器。

用户输入的公司名是: "${companyName}"

请生成一份完整的、可直接打开的 HTML 页面，作为该公司的行业分析报告。

## 要求
1. 输出格式: 仅输出 HTML 代码，不要用 markdown 包裹，不要有任何额外说明
2. 所有样式内嵌在 <style> 标签中，不依赖外部 CSS 或 JS
3. 中文字体使用系统字体栈 (font-family: -apple-system, "Microsoft YaHei", sans-serif)
4. 页面结构:
   - 顶部: 蓝色 header 区域，显示报告标题、公司名、生成日期
   - 公司概览 (Company Overview) — 公司简介、主营业务、行业地位
   - 市场规模与趋势 (Market Size & Trends) — 行业规模、增长率、发展趋势
   - 财务分析 (Financial Analysis) — 营收、利润、关键财务指标（可用合理估算数据）
   - 竞争格局 (Competitive Landscape) — 主要竞争对手、市场份额
   - SWOT 分析 — 用表格形式呈现
   - 行业展望与建议 (Outlook & Recommendations) — 未来发展预测
   - 底部: "由 YooClaw AI 生成" 版权信息，以及 YooClaw 品牌标识
5. 设计风格: 专业、清晰、现代，使用蓝色(#2563eb)/灰色为主色调
6. 尽量包含具体的行业数据和分析，不要泛泛而谈
7. 页面要适合打印 (A4 布局)

请直接输出完整的 HTML 代码。`;

  const response = await fetch(`${CODEBUDDY_API_ENDPOINT}/v2/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CODEBUDDY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CODEBUDDY_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: '你是 YooClaw AI 助手，专门生成专业美观的行业分析报告 HTML 页面。你只输出纯 HTML 代码，不要包含任何 markdown 标记。' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 16384,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`CodeBuddy API error: ${response.status} ${errText}`);
  }

  // Use streaming to accumulate the full HTML content
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullHtml = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
          const chunk = JSON.parse(jsonStr);
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            fullHtml += content;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Strip markdown code fences if the model wraps the output
  const cleaned = fullHtml
    .replace(/^```html\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // Ensure it's valid HTML
  if (!cleaned.startsWith('<!') && !cleaned.startsWith('<html')) {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${companyName} - 行业分析报告</title></head><body>${cleaned}</body></html>`;
  }
  return cleaned;
}

// ========== Game HTML Generator ==========
async function generateGameHtml(gameName: string): Promise<string> {
  const prompt = `你是一个专业的 HTML 小游戏生成器。

用户想玩的游戏是: "${gameName}"

请生成一个完整的、可直接运行的 HTML 页面，实现这个游戏。

## 要求
1. 输出格式: 仅输出 HTML 代码，不要用 markdown 包裹，不要有任何额外说明
2. 所有样式（CSS）和逻辑（JavaScript）内嵌在同一个 HTML 文件中
3. 不依赖任何外部资源（CDN、图片、字体等）
4. 游戏需要包含:
   - 完整的游戏逻辑和交互
   - 键盘/触控操作支持
   - 得分/计时显示
   - 游戏结束判定和重新开始按钮
   - 清晰的界面和操作说明
5. 设计风格: 精致、现代、色彩丰富
6. 使用 HTML5 Canvas 或 DOM 元素实现
7. 确保在移动端和桌面端都能正常游玩

请直接输出完整的 HTML 代码。`;

  const response = await fetch(`${CODEBUDDY_API_ENDPOINT}/v2/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CODEBUDDY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CODEBUDDY_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: '你是 YooClaw AI 助手，专门生成可直接运行的 HTML 小游戏。你只输出纯 HTML 代码，不要包含任何 markdown 标记。' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 16384,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`CodeBuddy API error: ${response.status} ${errText}`);
  }

  // Streaming accumulation (same pattern as generateReportHtml)
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullHtml = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
          const chunk = JSON.parse(jsonStr);
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            fullHtml += content;
          }
        } catch { /* ignore parse errors */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const cleaned = fullHtml
    .replace(/^```html\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  if (!cleaned.startsWith('<!') && !cleaned.startsWith('<html')) {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${gameName}</title></head><body>${cleaned}</body></html>`;
  }
  return cleaned;
}

// ========== Extract Game Name from Chat ==========
function extractGameName(text: string): string {
  // "开发贪吃蛇小游戏" → "贪吃蛇"
  // "帮我做个2048" → "2048"
  const patterns = [
    /(?:开发|生成|做一个|帮我做|做|写|创建)(?:一个)?(.{1,20})(?:小游戏|游戏)/,
    /(.{1,20})(?:小游戏|游戏)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      let name = m[1].trim();
      // Remove common filler words
      name = name.replace(/^[的]/, '').trim();
      if (name) return name;
    }
  }
  // Fallback: use first meaningful segment
  return text.replace(/^(?:开发|生成|做一个|帮我做|做|写|创建)\s*/, '').slice(0, 20) || '未知游戏';
}

// ========== Game Request Detection ==========
function isGameRequest(text: string): boolean {
  const gameKeywords = [
    '小游戏', '游戏', '贪吃蛇', '飞机大战', '俄罗斯方块',
    '2048', '弹球', '打砖块', '消消乐', '扫雷', '五子棋',
    '井字棋', '拼图', '射击', '赛车', '跑酷', '跳跃',
  ];
  const textLower = text.toLowerCase();
  return gameKeywords.some(kw => textLower.includes(kw));
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
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    callback(null, true);
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

// ========== Middleware ==========
app.use(express.json());
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ========== Auth Routes ==========

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
        user: formatUser(user),
      },
    });
  } catch (err: any) {
    console.error('[Register Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Registration failed' } });
  }
});

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
        user: formatUser(user),
      },
    });
  } catch (err: any) {
    console.error('[Login Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Login failed' } });
  }
});

app.get('/api/v1/auth/me', authMiddleware, async (req, res) => {
  try {
    const payload = (req as any).user as JwtPayload;
    const user = await getUserById(payload.userId);
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    res.json({
      data: {
        user: { ...formatUser(user), status: user.status },
      },
    });
  } catch (err: any) {
    console.error('[Auth/Me Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch user' } });
  }
});

app.get('/api/v1/auth/status', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const payload = authHeader?.startsWith('Bearer ') ? verifyToken(authHeader.slice(7)) : null;
    if (payload) {
      const user = await getUserById(payload.userId);
      res.json({
        data: {
          authenticated: true,
          user: user ? formatUser(user) : null,
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
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/v1/health', async (_req, res) => {
  res.json({
    data: {
      status: CODEBUDDY_API_KEY ? 'ok' : 'degraded',
      api: CODEBUDDY_API_KEY ? 'configured' : 'not configured',
      endpoint: CODEBUDDY_API_ENDPOINT,
      model: CODEBUDDY_MODEL,
    },
  });
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
    const limit = toNumber(user.storage_limit);
    res.json({
      data: {
        used,
        limit,
        percentage: limit > 0 ? Math.round((used / limit) * 100) : 0,
        canCreate: used < limit,
      },
    });
  } catch (err: any) {
    console.error('[Get Storage Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch storage' } });
  }
});

// ========== User Profile ==========

app.post('/api/v1/user/change-password', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { oldPassword, newPassword } = req.body || {};

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '旧密码和新密码都是必填的' } });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '新密码至少需要 6 个字符' } });
    }

    // Verify old password
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: '用户不存在' } });
    }
    if (!verifyPassword(oldPassword, user.password_hash)) {
      return res.status(403).json({ error: { code: 'INVALID_PASSWORD', message: '旧密码不正确' } });
    }

    // Update to new password
    const newHash = hashPassword(newPassword);
    await updateUserPassword(userId, newHash);

    res.json({ data: { success: true, message: '密码修改成功' } });
  } catch (err: any) {
    console.error('[Change Password Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '密码修改失败' } });
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
        storageUsed: toNumber(u.storage_used),
        storageLimit: toNumber(u.storage_limit),
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

// ========== Report Site Routes ==========

// Generate a new report site
app.post('/api/v1/sites/generate', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { companyName } = req.body || {};

    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Company name is required' } });
    }

    if (!CODEBUDDY_API_KEY) {
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'AI service not configured' } });
    }

    const name = companyName.trim();
    const slug = generateSlug(name);
    const title = `${name} 行业分析报告`;

    console.log(`[Sites] User:${userId} Generating report for "${name}" (slug: ${slug})`);

    // Generate HTML via CodeBuddy API
    const htmlContent = await generateReportHtml(name);

    // Save to database
    const site = await createReportSite(userId, slug, title, name, htmlContent);

    res.status(201).json({
      data: {
        id: site.id,
        slug: site.slug,
        title: site.title,
        companyName: site.company_name,
        url: `/web/${site.slug}`,
        createdAt: new Date(site.created_at).getTime(),
      },
    });
  } catch (err: any) {
    console.error('[Sites Generate Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Helper: Fetch research via CodeBuddy API (used as default and as fallback)
async function fetchResearchViaCodeBuddy(companyName: string, businessDesc: string, prompt: string): Promise<string> {
  const response = await fetch(`${CODEBUDDY_API_ENDPOINT}/v2/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CODEBUDDY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CODEBUDDY_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: '你是一个专业的行业研究分析师，擅长搜集和整理行业信息。输出结构化的研究资料，用中文。' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 16384,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`CodeBuddy API error: ${response.status} ${errText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
          const chunk = JSON.parse(jsonStr);
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
          }
        } catch { /* ignore */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText.trim();
}

// ========== Wizard: Research & Report (SSE) ==========

// Step 2 — Research: Search the internet for company/industry info
app.post('/api/v1/sites/research', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { companyName, businessDesc, analysisMethods, perspective, searchPlatform, searchApiKey, searchEndpoint, searchModel } = req.body || {};

    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Company name is required' } });
    }

    if (!CODEBUDDY_API_KEY) {
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'AI service not configured' } });
    }

    // If using custom search platform, validate API key
    if (searchPlatform && !searchApiKey) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Search API key is required when using a custom search platform' } });
    }

    const name = companyName.trim();
    const platformName = searchPlatform === 'metaso' ? '秘塔搜索' : (searchPlatform === 'custom' ? searchEndpoint : 'CodeBuddy');
    console.log(`[Research] User:${userId} Researching "${name}" via "${platformName}"`);

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Initial acknowledgment
    res.write(`data: ${JSON.stringify({
      type: 'stage',
      text: `正在通过 ${platformName} 搜索 ${name} 的行业信息...`,
    })}\n\n`);

    const researchStartTime = Date.now();
    const researchStageSchedule = [
      { at: 5, text: '正在搜索行业概况...', percent: 10 },
      { at: 15, text: '正在收集市场数据...', percent: 30 },
      { at: 25, text: '正在分析竞争对手...', percent: 55 },
      { at: 35, text: '正在汇总财务信息...', percent: 75 },
      { at: 45, text: '正在整理搜索报告...', percent: 90 },
    ];
    let researchNextStage = 0;

    const researchTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - researchStartTime) / 1000);
      while (researchNextStage < researchStageSchedule.length && elapsed >= researchStageSchedule[researchNextStage].at) {
        const stage = researchStageSchedule[researchNextStage];
        res.write(`data: ${JSON.stringify({ type: 'progress_update', percent: stage.percent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'stage', text: stage.text })}\n\n`);
        researchNextStage++;
      }
    }, 2000);

    try {
      const researchPrompt = `你是一个行业研究分析师。用户正在研究 "${name}"${businessDesc ? `（${businessDesc}）` : ''}。

请使用【联网搜索功能】查找最新的行业数据和信息，按以下结构化格式返回该公司的行业研究报告。要求包含具体的实时数据和事实，尽量引用最新的信息，不要泛泛而谈：

## 公司概况
- 行业定位、主营业务、核心竞争优势
- 在行业中的地位

## 市场规模与趋势
- 行业整体规模（用具体数字）
- 增长率和增长趋势
- 关键驱动因素

## 财务与经营分析
- 营收、利润等关键财务指标（可用合理估算）
- 经营效率分析

## 竞争格局
- 主要竞争对手
- 市场份额分布
- 差异化优势

## 近期动态
- 重大新闻、技术突破、政策变化

## 机遇与挑战
- 发展机遇
- 面临的风险和挑战

请用中文，分段清晰，包含具体数据，每个章节用标题开头。这是一份将要交给分析模型进一步处理的原始研究资料，请确保内容详实。`;

      let fullResearch = '';

      if (searchPlatform === 'metaso') {
        // === METASO SEARCH MODE ===
        // Use search mode (not Q&A) to get real-time web search results
        const apiEndpoint = searchEndpoint || 'https://metaso.cn/api/v1/search';

        res.write(`data: ${JSON.stringify({ type: 'stage', text: `正在通过秘塔搜索引擎搜索 ${name} 的实时信息...` })}\n\n`);

        const searchQueries = [
          `结合最新的行业数据，分析 ${name} ${businessDesc} 所处的行业地位、市场规模及发展趋势`,
          `获取 ${name} 最新的财务报告、营收及利润数据`,
          `分析 ${name} 当前的竞争对手、市场份额及竞争优势`,
          `${name} 最新的重大新闻、技术突破及行业政策变化`,
        ];

        const allResults: string[] = [];
        let successCount = 0;
        let networkErrorCount = 0;
        let httpErrorCount = 0;
        const diagnosticDetails: string[] = [];

        for (let i = 0; i < searchQueries.length; i++) {
          const stageLabels = ['行业与市场数据', '财务与财报信息', '竞争格局', '最新动态'];
          res.write(`data: ${JSON.stringify({ type: 'stage', text: `正在搜索 ${name} 的${stageLabels[i]}...` })}\n\n`);

          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const searchResp = await fetch(apiEndpoint, {
              signal: controller.signal,
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${searchApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                q: searchQueries[i],
                scope: 'web',
                size: 8,
                page: 1,
              }),
            });
            clearTimeout(timeout);

            if (searchResp.ok) {
              const text = await searchResp.text();
              try {
                const json = JSON.parse(text);
                const webpages = json.webpages || json.results || json.data || [];
                if (Array.isArray(webpages)) {
                  for (const r of webpages) {
                    const title = r.title || '';
                    const url = r.link || r.url || '';
                    const snippet = r.snippet || '';
                    if (title || snippet) {
                      allResults.push(`[${title}](${url})\n${snippet}\n`);
                    }
                  }
                  successCount++;
                  diagnosticDetails.push(`${stageLabels[i]}: 成功(${webpages.length}条)`);
                } else {
                  const keys = Object.keys(json).join(',');
                  diagnosticDetails.push(`${stageLabels[i]}: 字段=${keys}, 前200字符=${JSON.stringify(json).slice(0,200).replace(/"/g,"'")}`);
                  httpErrorCount++;
                }
              } catch (e: any) {
                diagnosticDetails.push(`${stageLabels[i]}: JSON解析失败=${e.message}, 原文=${text.slice(0,200).replace(/"/g,"'")}`);
                httpErrorCount++;
              }
            } else {
              const errText = await searchResp.text();
              diagnosticDetails.push(`${stageLabels[i]}: HTTP ${searchResp.status} ${errText.slice(0,100)}`);
              httpErrorCount++;
            }
          } catch (e: any) {
            diagnosticDetails.push(`${stageLabels[i]}: 网络错误=${e.message}`);
            networkErrorCount++;
          }

          const queryProgress = Math.floor(((i + 1) / searchQueries.length) * 90);
          res.write(`data: ${JSON.stringify({ type: 'progress_update', percent: queryProgress })}\n\n`);
        }

        if (allResults.length > 0) {
          fullResearch = `## 关于 "${name}" 的实时搜索结果\n\n共检索到 ${allResults.length} 条结果：\n\n${allResults.join('\n---\n\n')}`;
          res.write(`data: ${JSON.stringify({ type: 'stage', text: `秘塔搜索完成，找到 ${allResults.length} 条实时结果` })}\n\n`);
        } else {
          // Show all diagnostics and throw an error (wizard page will catch it)
          const errMsg = `秘塔搜索失败（所有查询均未返回结果）\n\n诊断详情:\n${diagnosticDetails.join('\n')}\n\n请检查:\n1. API Key 是否正确\n2. 秘塔 API 服务是否正常\n3. 如为自定义 API，检查端点地址是否正确`;
          console.log(`[Metaso] All queries failed:\n${diagnosticDetails.join('\n')}`);
          clearInterval(researchTimer);
          throw new Error(errMsg);
          }
      } else if (searchPlatform === 'custom') {
        // === CUSTOM API (OpenAI-compatible) ===
        const apiEndpoint = searchEndpoint || '';
        const modelName = searchModel || 'default';

        res.write(`data: ${JSON.stringify({ type: 'stage', text: `正在调用自定义搜索 API 获取信息...` })}\n\n`);

        const externalSearchPrompt = `你是一个行业研究分析师。用户正在研究 "${name}"${businessDesc ? `（${businessDesc}）` : ''}。

请使用【联网搜索功能】查找以下信息，并按结构化格式返回该公司的行业研究报告。要求包含具体的实时数据和事实，不要泛泛而谈，尽量引用最新的数据和信息：

## 公司概况
- 行业定位、主营业务、核心竞争优势
- 在行业中的地位

## 市场规模与趋势
- 行业整体规模（用具体数字）
- 增长率和增长趋势
- 关键驱动因素

## 财务与经营分析
- 营收、利润等关键财务指标（引用最新财报数据）
- 经营效率分析

## 竞争格局
- 主要竞争对手
- 市场份额分布
- 差异化优势

## 近期动态
- 近期重大新闻、技术突破、政策变化（尽量最新）

## 机遇与挑战
- 发展机遇
- 面临的风险和挑战`;

        const externalResponse = await fetch(apiEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${searchApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName,
            stream: true,
            messages: [
              { role: 'system', content: '你是一个专业的行业研究分析师。请务必使用【联网搜索】能力查找最新的行业数据和新闻，基于实时搜索结果回答。用中文输出结构化的研究资料。' },
              { role: 'user', content: externalSearchPrompt },
            ],
            max_tokens: 16384,
          }),
        });

        if (!externalResponse.ok) {
          const errText = await externalResponse.text();
          throw new Error(`Custom API error: ${externalResponse.status} ${errText}`);
        }

        const extReader = externalResponse.body!.getReader();
        const extDecoder = new TextDecoder();
        let extBuffer = '';

        try {
          while (true) {
            const { done, value } = await extReader.read();
            if (done) break;
            extBuffer += extDecoder.decode(value, { stream: true });
            const lines = extBuffer.split('\n');
            extBuffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const jsonStr = line.slice(6).trim();
              if (!jsonStr || jsonStr === '[DONE]') continue;
              try {
                const chunk = JSON.parse(jsonStr);
                const content = chunk.choices?.[0]?.delta?.content;
                if (content) {
                  fullResearch += content;
                }
              } catch { /* ignore */ }
            }
          }
        } finally {
          extReader.releaseLock();
        }
      } else {
        // === DEFAULT: CodeBuddy API ===
        fullResearch = await fetchResearchViaCodeBuddy(name, businessDesc, researchPrompt);
      }

      clearInterval(researchTimer);

      // Send 100% progress
      res.write(`data: ${JSON.stringify({ type: 'progress_update', percent: 100 })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'stage', text: '搜索完成' })}\n\n`);

      // Send research complete with data
      res.write(`data: ${JSON.stringify({
        type: 'research_complete',
        data: fullResearch,
      })}\n\n`);
      res.end();
    } catch (err: any) {
      clearInterval(researchTimer);
      console.error(`[Research Error] User:${userId}:`, err.message);
      res.write(`data: ${JSON.stringify({ type: 'error', message: `搜索失败: ${err.message}` })}\n\n`);
      res.end();
    }
  } catch (err: any) {
    console.error('[Research Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Step 3 — Report: Deep analysis based on research data + deploy
app.post('/api/v1/sites/report', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { formData, researchData } = req.body || {};

    if (!formData?.companyName) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Company name is required' } });
    }

    if (!CODEBUDDY_API_KEY) {
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'AI service not configured' } });
    }

    const name = formData.companyName.trim();
    const methods = (formData.analysisMethods || ['SWOT', 'PEST']).join('、');
    const perspectiveMap: Record<string, string> = {
      investor: '投资者视角：重点关注财务表现、增长潜力和投资价值',
      management: '管理层视角：重点关注战略方向、运营效率和竞争策略',
      academic: '学术视角：重点关注理论框架、方法论和研究深度',
      general: '通用视角：全面覆盖各维度',
    };
    const perspectiveText = perspectiveMap[formData.perspective] || perspectiveMap.general;

    const slug = generateSlug(name);
    const title = `${name} 行业深度分析报告`;

    console.log(`[Wizard Report] User:${userId} Generating report for "${name}" (slug: ${slug})`);

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Initial acknowledgment
    res.write(`data: ${JSON.stringify({
      type: 'stage',
      text: `开始为 ${name} 生成深度分析报告...`,
    })}\n\n`);

    const reportStartTime = Date.now();
    const reportStageSchedule = [
      { at: 5, text: '正在构建报告框架...', percent: 5 },
      { at: 10, text: '正在撰写公司概览...', percent: 15 },
      { at: 20, text: '正在分析市场规模与趋势...', percent: 35 },
      { at: 30, text: '正在生成财务与竞争分析...', percent: 55 },
      { at: 40, text: '正在制作可视化图表...', percent: 75 },
      { at: 50, text: '正在优化布局与排版...', percent: 90 },
    ];
    let reportNextStage = 0;

    const reportTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - reportStartTime) / 1000);
      while (reportNextStage < reportStageSchedule.length && elapsed >= reportStageSchedule[reportNextStage].at) {
        const stage = reportStageSchedule[reportNextStage];
        res.write(`data: ${JSON.stringify({ type: 'progress_update', percent: stage.percent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'stage', text: stage.text })}\n\n`);
        reportNextStage++;
      }
    }, 2000);

    try {
      const reportPrompt = `你是一个专业的行业分析报告生成器。

## 分析对象
${name}${formData.businessDesc ? `（${formData.businessDesc}）` : ''}

## 分析框架
使用以下分析方法: ${methods}

## 报告视角
${perspectiveText}

## 研究资料
以下是之前搜索到的行业数据和分析资料，请基于这些资料生成报告：

${researchData || '（暂无详细研究资料，请基于你的知识生成）'}

请生成一份完整的、可直接打开的 HTML 页面，作为行业深度分析报告。

## 要求
1. 输出格式: 仅输出 HTML 代码，不要用 markdown 包裹，不要有任何额外说明
2. 所有样式内嵌在 <style> 标签中，不依赖外部 CSS 或 JS
3. 中文字体使用系统字体栈 (font-family: -apple-system, "Microsoft YaHei", sans-serif)
4. 页面结构（基于选用的分析框架进行扩展）:
   - 顶部: 深色 header 区域，显示报告标题、公司名、生成日期、分析框架标签
   - 报告摘要 (Executive Summary) — 核心发现和结论
   - 公司概览 (Company Overview) — 公司简介、主营业务、行业地位
   - ${methods.includes('PEST') ? 'PEST 分析 (Political, Economic, Social, Technological) — 用表格展示各维度' : '市场规模与趋势 — 行业规模、增长率、发展趋势'}
   - ${methods.includes('SWOT') ? 'SWOT 分析 — 用表格呈现优势/劣势/机会/威胁' : ''}
   - ${methods.includes('PORTER') ? '波特五力分析 — 供应商议价能力、买方议价能力、新进入者威胁、替代品威胁、同业竞争' : ''}
   - ${methods.includes('3C') ? '3C 分析 — 公司(Corporation)、顾客(Customer)、竞争对手(Competitor)' : ''}
   - 财务分析 (Financial Analysis) — 营收、利润、关键财务指标（可用合理估算数据）
   - 竞争格局 (Competitive Landscape) — 主要竞争对手、市场份额
   - 行业展望与建议 (Outlook & Recommendations) — 未来发展预测、投资或战略建议
   - 底部: "由 YooClaw AI 生成" 版权信息，以及 YooClaw 品牌标识
5. 设计风格: 专业、清晰、现代，使用蓝色(#2563eb)/灰色为主色调
6. 尽量包含具体的行业数据和分析，不要泛泛而谈
7. 页面要适合打印 (A4 布局)
8. 如果适用，用图表（CSS 柱状图或表格）展示数据和对比

请直接输出完整的 HTML 代码。`;

      const response = await fetch(`${CODEBUDDY_API_ENDPOINT}/v2/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CODEBUDDY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: CODEBUDDY_MODEL,
          stream: true,
          messages: [
            { role: 'system', content: '你是 YooClaw AI 助手，专门生成专业美观的行业深度分析报告 HTML 页面。你只输出纯 HTML 代码，不要包含任何 markdown 标记。' },
            { role: 'user', content: reportPrompt },
          ],
          max_tokens: 32768,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`CodeBuddy API error: ${response.status} ${errText}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullHtml = '';
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const chunk = JSON.parse(jsonStr);
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) {
                fullHtml += content;
              }
            } catch { /* ignore */ }
          }
        }
      } finally {
        reader.releaseLock();
      }

      clearInterval(reportTimer);

      // Clean HTML
      const cleaned = fullHtml
        .replace(/^```html\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      // Save to database
      const site = await createReportSite(userId, slug, title, name, cleaned);

      console.log(`[Wizard Report] User:${userId} Report "${name}" deployed at /web/${slug}`);

      // Send 100% progress
      res.write(`data: ${JSON.stringify({ type: 'progress_update', percent: 100 })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'stage', text: '报告已生成并部署上线!' })}\n\n`);

      res.write(`data: ${JSON.stringify({
        type: 'report_complete',
        slug: site.slug,
        title: site.title,
        url: `/web/${site.slug}`,
      })}\n\n`);
      res.end();
    } catch (err: any) {
      clearInterval(reportTimer);
      console.error(`[Wizard Report Error] User:${userId}:`, err.message);
      res.write(`data: ${JSON.stringify({ type: 'error', message: `报告生成失败: ${err.message}` })}\n\n`);
      res.end();
    }
  } catch (err: any) {
    console.error('[Wizard Report Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// List user's report sites
app.get('/api/v1/user/sites', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const type = req.query.type as string | undefined;
    const sites = await getUserReportSites(userId, type);
    res.json({
      data: sites.map(s => ({
        id: s.id,
        slug: s.slug,
        title: s.title,
        companyName: s.company_name,
        type: s.type,
        viewCount: s.view_count,
        url: s.type === 'game' ? `/game/${s.slug}` : `/web/${s.slug}`,
        createdAt: new Date(s.created_at).getTime(),
        updatedAt: new Date(s.updated_at).getTime(),
      })),
    });
  } catch (err: any) {
    console.error('[Sites List Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch sites' } });
  }
});

// Delete a report site
app.delete('/api/v1/sites/:slug', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { slug } = req.params;
    await deleteReportSite(userId, slug);
    res.json({ data: { deleted: true } });
  } catch (err: any) {
    console.error('[Sites Delete Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete site' } });
  }
});

// ========== Game Routes ==========

// Generate a game
app.post('/api/v1/games/generate', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { gameName } = req.body || {};

    if (!gameName || typeof gameName !== 'string' || !gameName.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '游戏名称不能为空' } });
    }

    if (!CODEBUDDY_API_KEY) {
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'AI service not configured' } });
    }

    const name = gameName.trim();
    const slug = generateSlug(name);
    const title = `${name} 小游戏`;

    console.log(`[Games] User:${userId} Generating game "${name}" (slug: ${slug})`);

    const htmlContent = await generateGameHtml(name);
    const site = await createReportSite(userId, slug, title, name, htmlContent, 'game');

    res.status(201).json({
      data: {
        id: site.id,
        slug: site.slug,
        title: site.title,
        gameName: site.company_name,
        url: `/game/${site.slug}`,
        createdAt: new Date(site.created_at).getTime(),
      },
    });
  } catch (err: any) {
    console.error('[Games Generate Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Deploy pre-generated HTML content (for AI chat integration)
app.post('/api/v1/content/deploy', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { title, html, type } = req.body || {};

    if (!title || !html) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Title and html are required' } });
    }

    const contentType = type === 'game' ? 'game' : 'report';
    const slug = generateSlug(title);
    const site = await createReportSite(userId, slug, title, title, html, contentType);

    res.status(201).json({
      data: {
        id: site.id,
        slug: site.slug,
        title: site.title,
        type: contentType,
        url: contentType === 'game' ? `/game/${slug}` : `/web/${slug}`,
        createdAt: new Date(site.created_at).getTime(),
      },
    });
  } catch (err: any) {
    console.error('[Content Deploy Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// ========== Public: Serve Content ==========

app.get('/web/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const site = await getReportSiteBySlug(slug);
    if (!site) {
      return res.status(404).send('<html><body><h1>404 - 内容未找到</h1><p>该内容不存在或已被删除。</p></body></html>');
    }
    incrementSiteViewCount(slug).catch(() => {});
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(site.html_content);
  } catch (err: any) {
    console.error('[Web Serve Error]', err.message);
    res.status(500).send('<html><body><h1>500 - 服务器错误</h1></body></html>');
  }
});

app.get('/game/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const site = await getReportSiteBySlug(slug, 'game');
    if (!site) {
      return res.status(404).send('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>游戏未找到</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#666;}</style></head><body><h1>🎮 游戏未找到</h1><p>该游戏不存在或已被删除。</p></body></html>');
    }
    incrementSiteViewCount(slug).catch(() => {});
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(site.html_content);
  } catch (err: any) {
    console.error('[Game Serve Error]', err.message);
    res.status(500).send('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>错误</title></head><body><h1>500 - 服务器错误</h1></body></html>');
  }
});

// ========== POST /api/v1/runs — Create AI Run ==========
app.post('/api/v1/runs', authMiddleware, async (req, res) => {
  try {
    const { text, sender, sessionId } = req.body || {};
    const userPayload = (req as any).user as JwtPayload;
    if (!text) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Text is required' } });
    }

    if (!CODEBUDDY_API_KEY) {
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'AI service not configured (missing CODEBUDDY_API_KEY)' } });
    }

    // Check storage quota
    if (!(await canCreateSession(userPayload.userId))) {
      return res.status(403).json({ error: { code: 'STORAGE_FULL', message: '存储空间已满，请删除旧对话释放空间' } });
    }

    // Save user message to DB
    const activeSessionId = sessionId || crypto.randomUUID();
    const existingSessions = await getUserSessions(userPayload.userId);
    if (!existingSessions.find(s => s.session_id === activeSessionId)) {
      // Use Array.from to safely slice Unicode/CJK characters (avoids encoding corruption)
      const chars = Array.from(text);
      const sessionName = chars.length > 20 ? chars.slice(0, 20).join('') + '...' : text;
      await createUserSession(userPayload.userId, activeSessionId, sessionName);
    }
    await createMessage(userPayload.userId, activeSessionId, 'user', text);

    // Generate runId
    const runId = crypto.randomUUID();

    console.log(`[Runs] User:${userPayload.username} Creating run ${runId}: "${text.slice(0, 50)}..."`);

    res.json({
      data: {
        runId,
        status: 'accepted',
        sessionId: activeSessionId,
      },
    });
  } catch (err: any) {
    console.error('[Runs Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// ========== GET /api/v1/runs/:runId/stream — SSE Stream via Direct HTTP API ==========
app.get('/api/v1/runs/:runId/stream', async (req, res) => {
  const { runId } = req.params;
  const sessionId = req.query.sessionId as string | undefined;
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? verifyToken(authHeader.slice(7)) : null;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.flushHeaders();

  if (!CODEBUDDY_API_KEY) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'AI service not configured' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'run_status', status: 'failed' })}\n\n`);
    res.end();
    return;
  }

  // Get user message from DB if we have sessionId and token
  let userMessage = '';
  if (token && sessionId) {
    try {
      const messages = await getSessionMessages(token.userId, sessionId);
      const lastUserMsg = messages.filter(m => m.role === 'user').pop();
      if (lastUserMsg) userMessage = lastUserMsg.content;
    } catch {}
  }

  // Check if this is a game request (detect from user message text)
  if (userMessage && isGameRequest(userMessage)) {
    const gameName = extractGameName(userMessage);
    console.log(`[Stream] Run ${runId} is a game request: "${gameName}"`);
    try {
      // Stream game generation in real-time so user sees progress
      const gamePrompt = `你是一个专业的 HTML 小游戏生成器。

用户想玩的游戏是: "${gameName}"

请生成一个完整的、可直接运行的 HTML 页面，实现这个游戏。

## 要求
1. 输出格式: 仅输出 HTML 代码，不要用 markdown 包裹，不要有任何额外说明
2. 所有样式（CSS）和逻辑（JavaScript）内嵌在同一个 HTML 文件中
3. 不依赖任何外部资源（CDN、图片、字体等）
4. 游戏需要包含:
   - 完整的游戏逻辑和交互
   - 键盘/触控操作支持
   - 得分/计时显示
   - 游戏结束判定和重新开始按钮
   - 清晰的界面和操作说明
5. 设计风格: 精致、现代、色彩丰富
6. 使用 HTML5 Canvas 或 DOM 元素实现
7. 确保在移动端和桌面端都能正常游玩

请直接输出完整的 HTML 代码。`;

      // Send initial acknowledgment so user sees something immediately
      const gameStartTime = Date.now();
      res.write(`data: ${JSON.stringify({
        type: 'agent_message_chunk',
        content: { text: `🎮 正在生成 **${gameName}** 游戏...` },
      })}\n\n`);

      // Time-based stage schedule (contextual phases with percentage)
      const stageSchedule = [
        { at: 5, text: '正在设计游戏界面...', percent: 10 },
        { at: 15, text: '正在编写游戏逻辑...', percent: 30 },
        { at: 25, text: '正在添加交互控制...', percent: 55 },
        { at: 35, text: '正在优化视觉效果...', percent: 75 },
        { at: 45, text: '正在完成收尾...', percent: 90 },
      ];
      let nextStageIdx = 0;
      let stagesFired = 0;

      const stageTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
        while (nextStageIdx < stageSchedule.length && elapsed >= stageSchedule[nextStageIdx].at) {
          const stage = stageSchedule[nextStageIdx];
          // Send progress percentage update
          res.write(`data: ${JSON.stringify({
            type: 'progress_update',
            percent: stage.percent,
          })}\n\n`);
          // Send stage text message with proper line break (\n\n for new paragraph)
          res.write(`data: ${JSON.stringify({
            type: 'agent_message_chunk',
            content: { text: `\n\n${stage.text}` },
          })}\n\n`);
          nextStageIdx++;
          stagesFired++;
        }
      }, 2000);

      const apiResponse = await fetch(`${CODEBUDDY_API_ENDPOINT}/v2/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CODEBUDDY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: CODEBUDDY_MODEL,
          stream: true,
          messages: [
            { role: 'system', content: '你是 YooClaw AI 助手，专门生成可直接运行的 HTML 小游戏。你只输出纯 HTML 代码，不要包含任何 markdown 标记。' },
            { role: 'user', content: gamePrompt },
          ],
          max_tokens: 16384,
        }),
      });

      if (!apiResponse.ok) {
        clearInterval(stageTimer);
        const errText = await apiResponse.text();
        throw new Error(`CodeBuddy API error: ${apiResponse.status} ${errText}`);
      }

      // Stream chunks to accumulate for storage (NOT sent to frontend to avoid HTML pollution)
      const gameReader = apiResponse.body!.getReader();
      const gameDecoder = new TextDecoder();
      let fullHtml = '';
      let gameBuffer = '';

      try {
        while (true) {
          const { done, value } = await gameReader.read();
          if (done) break;
          gameBuffer += gameDecoder.decode(value, { stream: true });
          const lines = gameBuffer.split('\n');
          gameBuffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const chunk = JSON.parse(jsonStr);
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) {
                fullHtml += content;
              }
            } catch { /* ignore */ }
          }
        }
      } finally {
        clearInterval(stageTimer);
        gameReader.releaseLock();
      }

      // Clean up the HTML
      const cleaned = fullHtml
        .replace(/^```html\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const finalHtml = cleaned.startsWith('<!') || cleaned.startsWith('<html')
        ? cleaned
        : `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${gameName}</title></head><body>${cleaned}</body></html>`;

      // Save to database
      const slug = generateSlug(gameName);
      const title = `${gameName} 小游戏`;
      await createReportSite(token!.userId, slug, title, gameName, finalHtml, 'game');

      console.log(`[Stream] Game "${gameName}" deployed at /game/${slug} (${finalHtml.length} bytes)`);

      // Send completion message + game card
      res.write(`data: ${JSON.stringify({
        type: 'progress_update',
        percent: 100,
      })}\n\n`);
      res.write(`data: ${JSON.stringify({
        type: 'agent_message_chunk',
        content: { text: `\n\n✅ **${gameName}** 已完成！游戏已部署上线，点击下方按钮开始游玩。` },
      })}\n\n`);
      res.write(`data: ${JSON.stringify({
        type: 'game_deployed',
        slug: slug,
        url: `/game/${slug}`,
        title: title,
      })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'run_status', status: 'completed' })}\n\n`);
      res.end();
      return;
    } catch (err: any) {
      console.error(`[Stream] Game generation failed for run ${runId}:`, err.message);
      res.write(`data: ${JSON.stringify({ type: 'error', message: `游戏生成失败: ${err.message}` })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'run_status', status: 'failed' })}\n\n`);
      res.end();
      return;
    }
  }

  if (!userMessage) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'No message found' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'run_status', status: 'failed' })}\n\n`);
    res.end();
    return;
  }

  console.log(`[Stream] Starting API call for run ${runId}: "${userMessage.slice(0, 50)}..."`);

  // Create AbortController for cancellation
  const abortController = new AbortController();
  req.on('close', () => {
    abortController.abort();
  });

  let fullMarkdown = '';

  try {
    // Call CodeBuddy cloud API directly (OpenAI-compatible streaming)
    const apiResponse = await fetch(`${CODEBUDDY_API_ENDPOINT}/v2/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CODEBUDDY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CODEBUDDY_MODEL,
        stream: true,
        messages: [
          { role: 'system', content: '你是 YooClaw AI 助手，一个友好、专业的对话助手。请用简洁清晰的中文回答用户的问题。' },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: abortController.signal,
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      console.error(`[Stream] API error: ${apiResponse.status} ${errText}`);
      res.write(`data: ${JSON.stringify({ type: 'error', message: `API error: ${apiResponse.status}` })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'run_status', status: 'failed' })}\n\n`);
      res.end();
      return;
    }

    // Parse SSE stream from CodeBuddy API
    const reader = apiResponse.body!;
    const decoder = new TextDecoder();
    let buffer = '';

    // Helper to flush SSE lines
    function processSSELines(text: string) {
      const lines = text.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
          const chunk = JSON.parse(jsonStr);
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            fullMarkdown += content;
            res.write(`data: ${JSON.stringify({
              type: 'agent_message_chunk',
              content: { text: content },
            })}\n\n`);
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Read the stream using getReader for Node.js compatibility
    if (reader && typeof reader.getReader === 'function') {
      const streamReader = (reader as any).getReader();
      try {
        while (true) {
          const { done, value } = await streamReader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Process complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const chunk = JSON.parse(jsonStr);
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) {
                fullMarkdown += content;
                res.write(`data: ${JSON.stringify({
                  type: 'agent_message_chunk',
                  content: { text: content },
                })}\n\n`);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      } finally {
        streamReader.releaseLock();
      }
    }

    // Save assistant message to DB
    if (fullMarkdown && token && sessionId) {
      try {
        await createMessage(token.userId, sessionId, 'assistant', fullMarkdown);
      } catch (e: any) {
        console.error('[Stream] Failed to save assistant message:', e.message);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'run_status', status: 'completed' })}\n\n`);
    res.end();
    console.log(`[Stream] Run ${runId} completed. Response length: ${fullMarkdown.length}`);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log(`[Stream] Run ${runId} cancelled by user`);
      res.write(`data: ${JSON.stringify({ type: 'run_status', status: 'cancelled' })}\n\n`);
    } else {
      console.error(`[Stream] Run ${runId} error:`, error.message);
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'run_status', status: 'failed' })}\n\n`);
    }
    res.end();
  }
});

// ========== POST /api/v1/runs/:runId/cancel ==========
app.post('/api/v1/runs/:runId/cancel', authMiddleware, async (req, res) => {
  // In the new SDK mode, cancellation is handled via AbortController
  // We just return success - the client should close the SSE connection
  res.json({ data: { cancelled: true } });
});

// ========== Portal: Deploy & Serve ==========

// Deploy a new portal website
app.post('/api/v1/sites/portal/deploy', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { siteName, siteDesc, template, slug: customSlug } = req.body || {};

    if (!siteName || typeof siteName !== 'string' || !siteName.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Site name is required' } });
    }

    const name = siteName.trim();
    const slug = customSlug || generateSlug(name);

    console.log(`[Portal] User:${userId} Deploying "${name}" (slug: ${slug}, template: ${template})`);

    const apiBase = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : (process.env.FRONTEND_URL || `http://localhost:${APP_PORT}`);

    const htmlContent = generatePortalHtml(name, siteDesc || '', template || 'business-blue', apiBase);
    const site = await createReportSite(userId, slug, name, name, htmlContent, 'portal');

    res.status(201).json({
      data: {
        id: site.id,
        slug: site.slug,
        title: site.title,
        url: `/p/${site.slug}`,
        createdAt: new Date(site.created_at).getTime(),
      },
    });
  } catch (err: any) {
    console.error('[Portal Deploy Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Serve a deployed portal
app.get('/p/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const site = await getReportSiteBySlug(slug, 'portal');
    if (!site) {
      return res.status(404).send('<html><body><h1>404 - 门户未找到</h1><p>该分析门户不存在或已被删除。</p></body></html>');
    }
    incrementSiteViewCount(slug).catch(() => {});
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(site.html_content);
  } catch (err: any) {
    console.error('[Portal Serve Error]', err.message);
    res.status(500).send('<html><body><h1>500 - 服务器错误</h1></body></html>');
  }
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

// ========== Start ==========
async function start() {
  await initDatabase();

  app.listen(APP_PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  =======================================');
    console.log('');
    console.log('   YooClaw - Cloud Deployment (HTTP API)');
    console.log('');
    console.log(`   URL:      http://localhost:${APP_PORT}`);
    console.log(`   API:      ${CODEBUDDY_API_ENDPOINT}`);
    console.log(`   Model:    ${CODEBUDDY_MODEL}`);
    console.log(`   API Key:  ${CODEBUDDY_API_KEY ? 'configured' : 'NOT SET'}`);
    console.log(`   DB:       PostgreSQL (Supabase)`);
    console.log('');
    console.log('  =======================================');
    console.log('');
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});