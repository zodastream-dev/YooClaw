import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawn } from 'child_process';
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

// ========== CodeBuddy Integration ==========
const CODEBUDDY_API_KEY = process.env.CODEBUDDY_API_KEY;
const CODEBUDDY_MODEL = process.env.CODEBUDDY_MODEL || 'deepseek-v3.1';
// Compatibility: the original code calls CODEBUDDY_API_ENDPOINT/v2/chat/completions
// Our proxy route on the Express server handles the translation
const CODEBUDDY_API_ENDPOINT = `http://127.0.0.1:${APP_PORT}`;
const CB_SERVE_PORT = Number(process.env.CB_SERVE_PORT) || 8080;
let codebuddyProcess: ChildProcess | null = null;

async function startCodeBuddyCLI(): Promise<void> {
  if (!CODEBUDDY_API_KEY) {
    console.warn('[CodeBuddy] CODEBUDDY_API_KEY not set, skipping CLI startup');
    return;
  }
  return new Promise((resolve, reject) => {
    console.log(`[CodeBuddy] Starting CLI serve on port ${CB_SERVE_PORT}...`);
    const proc = spawn('codebuddy', [
      '--serve', '--port', String(CB_SERVE_PORT),
      '--session-id', 'yooclaw',
      '--dangerously-skip-permissions',
    ], {
      stdio: 'ignore',
      env: { ...process.env, CODEBUDDY_API_KEY },
    });
    codebuddyProcess = proc;
    proc.on('exit', (code) => {
      console.error(`[CodeBuddy] CLI exited with code ${code}`);
      codebuddyProcess = null;
    });
    const startTime = Date.now();
    const poll = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${CB_SERVE_PORT}/api/v1/health`, {
          headers: { 'X-CodeBuddy-Request': '1' },
        });
        if (res.ok) {
          console.log(`[CodeBuddy] CLI serve ready on port ${CB_SERVE_PORT}`);
          resolve();
          return;
        }
      } catch {}
      if (Date.now() - startTime > 30000) {
        reject(new Error('[CodeBuddy] CLI startup timeout'));
        return;
      }
      setTimeout(poll, 500);
    };
    setTimeout(poll, 1500);
  });
}

function stopCodeBuddyCLI() {
  if (codebuddyProcess) {
    codebuddyProcess.kill();
    codebuddyProcess = null;
  }
}

async function* streamCodebuddy(systemMsg: string, userMsg: string): AsyncGenerator<{ type: string; content?: string; text?: string }> {
  // Use the persistent CodeBuddy CLI HTTP API (Runs API with SSE streaming)
  const runRes = await fetch(`http://127.0.0.1:${CB_SERVE_PORT}/api/v1/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CodeBuddy-Request': '1' },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      type: 'text',
      text: `${systemMsg}\n\n${userMsg}`,
      sender: { id: 'yooclaw', name: 'YooClaw', type: 'user' },
    }),
  });
  if (!runRes.ok) throw new Error(`CodeBuddy run error: ${runRes.status} ${await runRes.text()}`);
  const runData = await runRes.json();
  const runId = runData.data?.runId;
  if (!runId) throw new Error(`CodeBuddy run failed: ${JSON.stringify(runData)}`);

  // Stream the result via SSE
  const streamRes = await fetch(`http://127.0.0.1:${CB_SERVE_PORT}/api/v1/runs/${runId}/stream`, {
    headers: { 'X-CodeBuddy-Request': '1' },
  });
  if (!streamRes.ok || !streamRes.body) throw new Error(`CodeBuddy stream error: ${streamRes.status}`);

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('event: done')) continue;
        if (!line.startsWith('data: ')) { continue; }
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '{}') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.content?.markdown || parsed.content?.text || parsed.content;
          if (content) {
            yield { type: 'content', content };
          }
        } catch {}
      }
    }
  } finally { reader.releaseLock(); }
}

async function fetchCodebuddyNonStream(systemMsg: string, userMsg: string): Promise<string> {
  let fullText = '';
  for await (const ev of streamCodebuddy(systemMsg, userMsg)) {
    if (ev.content) fullText += ev.content;
  }
  return fullText;
}

// ========== Slug Helper ==========
function generateSlug(text: string): string {
  // Generate a clean ASCII-only slug: remove Chinese chars and special chars
  let slug = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // Remove non-alphanumeric (drops Chinese chars too)
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  // Add a short random suffix to ensure uniqueness
  const suffix = crypto.randomBytes(3).toString('hex');
  return slug ? `${slug}-${suffix}` : `site-${suffix}`;
}

// ========== HTML Cleaner ==========
// Robustly clean AI-generated HTML output and ensure it's a complete valid page
function cleanAiHtml(raw: string, fallbackTitle: string): string {
  if (!raw || !raw.trim()) {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${fallbackTitle}</title></head><body><p style="padding:2em;text-align:center;color:#888">报告内容生成失败，请重试。</p></body></html>`;
  }

  // 1. Remove markdown code fences (```html ... ```)
  let html = raw
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // 2. Locate the start of the actual HTML document
  //    Match common variants: <!DOCTYPE html>, <!doctype HTML>, <!DOCTYPE html PUBLIC ...>
  const doctypeIdx = html.search(/<!DOCTYPE\s+html/i);
  const htmlTagIdx = html.search(/<html[\s>\/]/i);
  const startIdx = doctypeIdx !== -1 ? doctypeIdx : htmlTagIdx;

  if (startIdx > 0) {
    html = html.slice(startIdx);
  }

  // 3. Locate the end — trim any text after </html>
  const htmlCloseIdx = html.search(/<\/html>/i);
  if (htmlCloseIdx !== -1) {
    html = html.slice(0, htmlCloseIdx + 7); // +7 for "</html>"
  }

  html = html.trim();

  // 4. If starts with <html> but no DOCTYPE, prepend DOCTYPE
  if (/^<html[\s>\/]/i.test(html) && !/^<!DOCTYPE\s+html/i.test(html)) {
    html = '<!DOCTYPE html>\n' + html;
    console.log(`[cleanAiHtml] Prepended DOCTYPE (${html.length} chars)`);
  }

  // 5. Fix common AI CSS/HTML syntax errors
  html = fixAiCssErrors(html);

  // 6. If it's a complete HTML document, return as-is
  if (/^<!DOCTYPE\s+html/i.test(html) || /^<html[\s>\/]/i.test(html)) {
    console.log(`[cleanAiHtml] Detected complete HTML document (${html.length} chars)`);
    return html;
  }

  // 7. Fragment — extract <body> content and <head><style> if present
  const headStyleMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const styleContent = headStyleMatch
    ? (headStyleMatch[1].match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n')
    : '';

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1].trim() : html;

  console.log(`[cleanAiHtml] Wrapping HTML fragment (${bodyContent.length} chars body, ${styleContent.length} chars style)`);

  const styleBlock = styleContent ? `\n${styleContent}` : '';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${fallbackTitle}</title>${styleBlock}</head><body>${bodyContent}</body></html>`;
}

/** Clean up common CSS/HTML syntax mistakes that AI models tend to make */
function fixAiCssErrors(html: string): string {
  let s = html;

  // Fix: <meta="UTF-8"> → <meta charset="UTF-8">
  s = s.replace(/<meta\s*=\s*"([^"]*?)"\s*\/?>/gi, '<meta charset="$1">');

  // Fix: CSS property missing colon — e.g., "text-align center;" → "text-align: center;"
  // Match known CSS properties followed by space + value + ; (without colon)
  const cssProps = 'text-align|border-radius|font-size|font-weight|line-height|margin(?:-top|-bottom|-left|-right)?|padding(?:-top|-bottom|-left|-right)?|max-width|min-width|width|height|display|justify(?:-content)?|align-items|flex-direction|flex-wrap|gap|grid-template-columns|background(?:-color)?|color|border(?:-bottom|-left|-right|-top|-radius)?|box-shadow|opacity|overflow|position|top|right|bottom|left|z-index|transform|transition|cursor|list-style|text-decoration|white-space|word-break|vertical-align|float|clear|grid-gap|flex';
  s = s.replace(new RegExp('\\b(' + cssProps + ')\\s+(?!:)([a-zA-Z0-9#.%()\\[\\]\'"\\-, ]+?);', 'g'),
    (_m, prop, val) => prop + ': ' + val + ';');

  // Fix: "box:-box" or "box: -box" → "box-sizing: border-box"
  s = s.replace(/box\s*:\s*-box/gi, 'box-sizing: border-box');
  // Also handle standalone "box-sizing border-box" (missing colon)
  s = s.replace(/box-sizing\s+border-box/gi, 'box-sizing: border-box');

  // Fix: "max-width: 0px" or "max-width:0px" → "max-width: 1100px"
  s = s.replace(/max-width\s*:\s*0px/gi, 'max-width: 1100px');

  // Fix: "line-height: 15-29;" (bogus unitless number) → "line-height: 1.6;"
  s = s.replace(/line-height\s*:\s*(1[5-9]|2[0-9])\s*;/g, 'line-height: 1.6;');

  // Fix: broken closing tags — e.g., "h1>" → "</h1>", "div>" → "</div>"
  // Only match when NOT preceded by < or / (to avoid breaking <h1> or </h1>)
  s = s.replace(/(?<![<\/])(h[1-6]|div|p|span|strong|em|ul|ol|li|section|article|header|footer|nav)\s*>/g, '</$1>');

  // Fix: <section="card"> → <section class="card">
  s = s.replace(/<(\w+)\s*=\s*"([^"]*?)"/g, '<$1 class="$2"');

  // Fix: CSS values missing semicolon at end (just before })
  s = s.replace(/([a-zA-Z0-9%#.\-]+)\s*\}/g, '$1; }');
  s = s.replace(/;(\s*;)+/g, ';'); // deduplicate semicolons

  // Fix: "font-family: ... ,-serif" → "font-family: ... , sans-serif"
  s = s.replace(/,\s*-?serif/gi, ', serif');
  s = s.replace(/,\s*-?sans-serif/gi, ', sans-serif');

  // Fix: "margin: 20;" (unitless number) → "margin: 20px;"
  s = s.replace(/(margin|padding)\s*:\s*(\d+)\s*;/g, (_m, p, v) => p + ': ' + v + 'px;');

  return s;
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
.form-group select{width:100%;padding:10px 14px;font-size:14px;border:1px solid ${inputBorder};border-radius:8px;background:${inputBg};color:${textClr};outline:none;cursor:pointer}
.form-group select:focus{border-color:${theme.primary}}
.form-group select option{background:${cardBg};color:${textClr}}
.form-group .api-key-input{margin-top:8px;display:none}
.option-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px}
.option-btn{text-align:left;padding:12px 14px;border:2px solid ${inputBorder};border-radius:10px;background:${inputBg};cursor:pointer;font-size:13px;color:${mutedClr};transition:all .2s;line-height:1.5}
.option-btn .label{font-weight:600;font-size:14px;color:${textClr};display:block;margin-bottom:2px}
.option-btn .desc{font-size:11px;color:${mutedClr}}
.option-btn.selected{border-color:${theme.primary};background:${theme.primary}15;color:${theme.primary}}
.option-btn.selected .label{color:${theme.primary}}
.option-btn:hover:not(.selected){border-color:${theme.primary}66}
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
.report-item{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid ${borderClr};border-radius:8px;margin-bottom:8px;transition:background .2s}
.report-item:hover{background:${isDark?'#1e293b':'#f8fafc'}}
.report-item .rname{font-size:13px;font-weight:500;color:${textClr}}
.report-item .rdate{font-size:11px;color:${mutedClr};margin-top:2px}
.report-item a{font-size:12px;color:${theme.primary};text-decoration:none;flex-shrink:0;padding:4px 10px;border:1px solid ${theme.primary}44;border-radius:6px}
.report-item a:hover{background:${theme.primary}11}
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
    <p>配置分析参数，AI 将自动搜索信息并生成专业的分析报告。</p>
    <div class="form-group"><label>公司 / 行业名称</label>
    <input type="text" id="companyInput" placeholder="例如：比亚迪、特斯拉、宁德时代..."/></div>
    <div class="form-group"><label>分析框架 <span style="font-size:11px;color:#94a3b8">（可多选）</span></label>
    <div class="option-grid">
      <div class="option-btn selected" onclick="toggle(this,'methods')" data-value="SWOT"><span class="label">SWOT 分析</span><span class="desc">优势/劣势/机会/威胁</span></div>
      <div class="option-btn selected" onclick="toggle(this,'methods')" data-value="PEST"><span class="label">PEST 分析</span><span class="desc">政治/经济/社会/技术</span></div>
      <div class="option-btn" onclick="toggle(this,'methods')" data-value="PORTER"><span class="label">波特五力</span><span class="desc">供应商/买方/新进入者/替代品/竞争</span></div>
      <div class="option-btn" onclick="toggle(this,'methods')" data-value="3C"><span class="label">3C 分析</span><span class="desc">公司/顾客/竞争对手</span></div>
    </div></div>
    <div class="form-group"><label>搜索平台 <span style="font-size:11px;color:#94a3b8">（选填，留空使用默认联网搜索）</span></label>
    <select id="searchPlatform" onchange="toggleSearchKey()">
      <option value="">默认 (CodeBuddy)</option>
      <option value="tavily">Tavily</option>
      <option value="metaso" selected>秘塔 (Metaso)</option>
      <option value="deepseek">DeepSeek</option>
      <option value="custom">自定义 API</option>
    </select>
    <input type="password" id="searchApiKey" class="api-key-input" placeholder="输入该平台的 API Key..." value="mk-65F31E31CBAB4DD4697CF57DA49000CB"/>
    <input type="text" id="searchEndpoint" class="api-key-input" placeholder="自定义 API 端点 URL..." style="margin-top:6px"/>
    </div>
    <div class="form-group"><label>系统提示词 <span style="font-size:11px;color:#94a3b8">（可选，修改 AI 的角色设定）</span></label>
    <textarea id="sysPromptInput" class="prompt-input" placeholder="例如：你是一个专业的金融分析师..." style="width:100%;min-height:60px;padding:10px 14px;font-size:13px;border:1px solid ${inputBorder};border-radius:8px;background:${inputBg};color:${textClr};outline:none;resize:vertical;font-family:inherit;line-height:1.5">你是一个行业研究分析师，输出结构化研究资料，用中文。</textarea></div>
    <div class="form-group"><label>用户提示词 <span style="font-size:11px;color:#94a3b8">（可选，修改分析要求）</span>
      <span style="margin-left:8px;font-size:12px;color:${mutedClr}"><input type="checkbox" id="stockAnalysisCheck" style="margin-right:4px;accent-color:${theme.primary}" onchange="toggleStockAnalysis()"/>股价分析</span></label>
    <textarea id="userPromptInput" class="prompt-input" placeholder="例如：预测股价走势（用 {company} 代替公司名）..." style="width:100%;min-height:80px;padding:10px 14px;font-size:13px;border:1px solid ${inputBorder};border-radius:8px;background:${inputBg};color:${textClr};outline:none;resize:vertical;font-family:inherit;line-height:1.5">按以下格式输出行业研究报告：

## 公司概况
## 市场规模与趋势
## 财务与经营分析
## 竞争格局
## 近期动态
## 机遇与挑战

请用中文，分段清晰，包含具体数据。</textarea></div>
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
  <div class="card" id="reportListCard">
    <h3>最近生成的报告</h3>
    <div id="reportList"><p style="font-size:13px;color:${mutedClr}">暂无报告，开始分析后这里会显示。</p></div>
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
var methodNames={'SWOT':'SWOT分析','PEST':'PEST分析','PORTER':'波特五力分析','3C':'3C分析'};
function toggle(el,grp){
  if(grp==='methods'){
    el.classList.toggle('selected');
    updatePromptFromOptions();
  }
}
function updatePromptFromOptions(){
  var methods=[];
  document.querySelectorAll('.option-btn.selected').forEach(function(e){methods.push(e.getAttribute('data-value'))});
  if(methods.length===0)methods=['SWOT','PEST'];
  var methodText='';
  if(methods.length>0){
    methodText='\n\n请使用以下分析框架进行分析：';
    methods.forEach(function(m){methodText+=methodNames[m]+'、'});
    methodText=methodText.replace(/、$/,'');
    methodText=methodText+'。\n';
  }
  var stockText=$('stockAnalysisCheck').checked?'\n\n结合公司最新的年报/季报，预测公司股价未来12个月的走势。':'';
  var up=$('userPromptInput');
  var v=up.value;
  var lines=v.split('\n');
  var result=[];
  var skip=false;
  for(var i=0;i<lines.length;i++){
    if(lines[i].indexOf('请使用以下分析框架进行分析：')===0){skip=true;continue;}
    if(skip&&lines[i].trim()===''){skip=false;continue;}
    if(skip)continue;
    if(lines[i].indexOf('结合公司最新的年报/季报')!=-1)continue;
    result.push(lines[i]);
  }
  v=result.join('\n').trim();
  var extra='';
  if(methodText)extra+=methodText;
  if(stockText)extra+=stockText;
  up.value=v+(extra?'\n\n':'')+extra.trim();
}
function toggleSearchKey(){
  var p=$('searchPlatform').value;
  $('searchApiKey').style.display=p?'block':'none';
  $('searchEndpoint').style.display=p==='custom'?'block':'none';
  if(p==='metaso'&&!$('searchApiKey').value){
    $('searchApiKey').value='mk-65F31E31CBAB4DD4697CF57DA49000CB';
  }
}
var stockAnalysisText='结合公司最新的年报/季报，预测公司股价未来12个月的走势。';
function toggleStockAnalysis(){
  updatePromptFromOptions();
}
async function startAnalysis(){
  var n=$('companyInput').value.trim();if(!n)return;
  var sp=$('searchPlatform').value;
  var sak=$('searchApiKey').value.trim();
  var se=$('searchEndpoint').value.trim();
  var sprompt=$('sysPromptInput').value.trim();
  var uprompt=$('userPromptInput').value.trim();
  var methods=[];
  document.querySelectorAll('.option-btn.selected').forEach(function(e){methods.push(e.getAttribute('data-value'))});
  if(methods.length===0)methods=['SWOT','PEST'];
  var slug=window.location.pathname.split('/').pop();
  h('step1');h('result');s('step2');h('step3');
  t('s2sub',n);t('sp','0%');$('sbar').style.width='0%';t('smsg','');$('stxt').style.display='none';
  try{
    var rt='';
    for await(var ev of _s(API+'/api/p/research/'+slug,{companyName:n,businessDesc:'',analysisMethods:methods,perspective:'investor',searchPlatform:sp,searchApiKey:sak,searchEndpoint:se,sysPrompt:sprompt,userPrompt:uprompt})){
      if(ev.type==='progress_update'){t('sp',ev.percent+'%');$('sbar').style.width=ev.percent+'%'}
      else if(ev.type==='stage'){$('stxt').style.display='flex';t('smsg',ev.text)}
      else if(ev.type==='research_complete'){rt=ev.data||''}
      else if(ev.type==='error'){throw new Error(ev.message||'搜索失败')}
    }
    h('step2');s('step3');t('s3sub',n);t('rp','0%');$('rbar').style.width='0%';t('rmsg','');$('rtxt').style.display='none';
    var url='';
    for await(var ev of _s(API+'/api/p/report/'+slug,{formData:{companyName:n,businessDesc:'',analysisMethods:methods,perspective:'investor'},researchData:rt,sysPrompt:sprompt,userPrompt:uprompt})){
      if(ev.type==='progress_update'){t('rp',ev.percent+'%');$('rbar').style.width=ev.percent+'%'}
      else if(ev.type==='stage'){$('rtxt').style.display='flex';t('rmsg',ev.text)}
      else if(ev.type==='report_complete'){url=ev.url||''}
      else if(ev.type==='error'){throw new Error(ev.message||'生成失败')}
    }
    h('step3');s('result');
    if(url){$('rsucc').style.display='block';t('rtitle',n+' 行业分析报告');var lu=window.location.origin+url;$('rlink').href=lu;$('rlink').textContent=lu;loadReports()}
    else throw new Error('未获取到链接');
  }catch(e){h('step2');h('step3');s('result');$('rsucc').style.display='none';$('rerr').style.display='block';$('rerr').textContent='错误: '+e.message}
}
function copyUrl(){
  var btn=event&&event.target;
  if(btn){
    navigator.clipboard.writeText($('rlink').textContent);
    btn.textContent='已复制';
    setTimeout(function(){btn.textContent='复制'},2000);
  }
}
async function loadReports(){
  var slug=window.location.pathname.split('/').pop();
  try{
    var r=await fetch(API+'/api/p/reports/'+slug);
    if(!r.ok)return;
    var reports=await r.json();
    var html='';
    if(reports.data&&reports.data.length>0){
      reports.data.slice(0,20).forEach(function(report){
        var d=new Date(report.createdAt).toLocaleDateString('zh-CN');
        html+='<div class="report-item"><div style="flex:1"><div class="rname">'+report.companyName+'</div><div class="rdate">'+d+'</div></div><a href="'+report.url+'" target="_blank" style="margin-right:6px">查看</a><button onclick="deleteReport(&#39;'+report.slug+'&#39;)" style="padding:4px 8px;font-size:12px;border:1px solid #e24b4a44;border-radius:6px;background:none;color:#e24b4a;cursor:pointer">删除</button></div>'
      });
    }else{html='<p style="font-size:13px;color:#94a3b8">暂无报告，开始分析后这里会显示。</p>'}
    $('reportList').innerHTML=html;
  }catch(e){}
}
async function deleteReport(rSlug){
  if(!confirm('确定删除这个报告？'))return;
  var slug=window.location.pathname.split('/').pop();
  try{
    var r=await fetch(API+'/api/p/reports/'+slug+'/'+rSlug,{method:'DELETE'});
    if(!r.ok){alert('删除失败');return}
    loadReports();
  }catch(e){alert('删除失败')}
}
toggleSearchKey();updatePromptFromOptions();
loadReports();
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

## HTML 质量检查 — 生成前务必逐条确认
8. HTML 必须以 <!DOCTYPE html> 开头，不能省略
9. CSS 语法必须正确：每条规则用 \`属性名: 值;\` 格式，冒号和分号不可省略
10. HTML 标签必须正确闭合，例如 \`</h1>\` 而不是 \`h1>\`，\`</div>\` 而不是 \`div>\`
11. 容器宽度设置必须合理，\`max-width\` 不能设置为 \`0px\`
12. \`box-sizing\` 的值必须是 \`border-box\`，不能写成 \`-box\` 或 \`:box\`
13. 行高 \`line-height\` 必须用无单位数值（如 \`1.6\`），不能用 \`16\`
14. \`<meta charset="UTF-8">\` 必须包含 \`charset=\` 属性名

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

  // Debug: log first 300 chars of raw AI output
  console.log(`[generateReportHtml] Raw AI output (first 300 chars): ${fullHtml.slice(0, 300)}`);

  // Strip markdown code fences if the model wraps the output
  const cleaned = cleanAiHtml(fullHtml, `${companyName} - 行业分析报告`);
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

  const cleaned = cleanAiHtml(fullHtml, gameName);
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
    if (origin.endsWith('.zeabur.app')) return callback(null, true);
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
      mode: 'cli-serve',
      cliStatus: codebuddyProcess ? 'running' : 'stopped',
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

## HTML 质量检查 — 生成前务必逐条确认
9. HTML 必须以 <!DOCTYPE html> 开头，不能省略
10. CSS 语法必须正确：每条规则用 \`属性名: 值;\` 格式，冒号和分号不可省略
11. HTML 标签必须正确闭合，例如 \`</h1>\` 而不是 \`h1>\`，\`</div>\` 而不是 \`div>\`
12. 容器宽度设置必须合理，\`max-width\` 不能设置为 \`0px\`
13. \`box-sizing\` 的值必须是 \`border-box\`，不能写成 \`-box\` 或 \`:box\`
14. 行高 \`line-height\` 必须用无单位数值（如 \`1.6\`），不能用 \`16\`
15. \`<meta charset="UTF-8">\` 必须包含 \`charset=\` 属性名
16. 不要使用 \`<meta="UTF-8">\`，要写 \`<meta charset="UTF-8">\`

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

      // Debug: log first 300 chars of raw AI output
      console.log(`[Wizard Report] Raw AI output (first 300 chars): ${fullHtml.slice(0, 300)}`);

      // Clean HTML
      const cleaned = cleanAiHtml(fullHtml, `${name} 行业深度分析报告`);

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
      const cleaned = cleanAiHtml(fullHtml, gameName);
      const finalHtml = cleaned;

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

    const apiBase = process.env.FRONTEND_URL
      || (req.get('host') ? `https://${req.get('host')}` : null)
      || `http://localhost:${APP_PORT}`;

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

// ========== Public Portal API (no auth required) ==========

// Public research endpoint for portal visitors
app.post('/api/p/research/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { companyName, businessDesc, searchPlatform, searchApiKey, searchEndpoint, sysPrompt, userPrompt } = req.body || {};

    const site = await getReportSiteBySlug(slug, 'portal');
    if (!site) return res.status(404).json({ error: { message: 'Portal not found' } });
    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      return res.status(400).json({ error: { message: 'Company name is required' } });
    }

    const name = companyName.trim();
    console.log(`[PubResearch] Portal:${slug} researching "${name}" platform:${searchPlatform || 'default'}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Collect search results if using a search platform
    let searchResults = '';

    if (searchPlatform === 'metaso' && searchApiKey) {
      // === METASO SEARCH MODE ===
      const apiEndpoint = searchEndpoint || 'https://metaso.cn/api/v1/search';
      res.write(`data: ${JSON.stringify({ type: 'stage', text: `🔍 正在通过秘塔搜索 ${name} 的实时信息...` })}\n\n`);

      const searchQueries = [
        `${name} ${businessDesc || ''} 行业分析 市场规模 竞争格局`,
        `${name} 最新动态 财报 经营数据`,
        `${name} 竞争对手 市场份额`,
        `${name} 行业趋势 发展前景`,
      ];

      const allResults: string[] = [];

      for (let i = 0; i < searchQueries.length; i++) {
        const stages = ['行业与市场', '财务与动态', '竞争格局', '发展趋势'];
        res.write(`data: ${JSON.stringify({ type: 'stage', text: `🔍 [${i+1}/4] 正在搜索 ${name} 的${stages[i]}...` })}\n\n`);

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
            body: JSON.stringify({ q: searchQueries[i], scope: 'web', size: 5 }),
          });
          clearTimeout(timeout);

          if (searchResp.ok) {
            const json = await searchResp.json();
            const webpages = json.webpages || json.results || json.data || [];
            if (Array.isArray(webpages)) {
              for (const r of webpages) {
                const title = r.title || '';
                const snippet = r.snippet || '';
                if (title || snippet) {
                  allResults.push(`- ${title}: ${snippet}`);
                }
              }
              res.write(`data: ${JSON.stringify({ type: 'stage', text: `✅ [${i+1}/4] ${name} 的${stages[i]}搜索完成 (${webpages.length}条结果)` })}\n\n`);
            } else {
              res.write(`data: ${JSON.stringify({ type: 'stage', text: `⚠️ [${i+1}/4] ${name} 的${stages[i]}搜索返回了0条结果` })}\n\n`);
            }
          } else {
            res.write(`data: ${JSON.stringify({ type: 'stage', text: `❌ [${i+1}/4] ${name} 的${stages[i]}搜索失败 (HTTP ${searchResp.status})` })}\n\n`);
          }
        } catch (e: any) {
          res.write(`data: ${JSON.stringify({ type: 'stage', text: `❌ [${i+1}/4] ${name} 的${stages[i]}搜索超时: ${e.message}` })}\n\n`);
          console.log(`[PubResearch] Metaso query ${i} error: ${e.message}`);
        }
      }

      if (allResults.length > 0) {
        searchResults = `\n\n以下是搜索到的 ${name} 相关信息：\n${allResults.join('\n')}`;
        res.write(`data: ${JSON.stringify({ type: 'stage', text: `📦 秘塔搜索完成，共收集到 ${allResults.length} 条信息，准备生成分析报告...` })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ type: 'stage', text: `⚠️ 秘塔搜索未获取到结果，将使用 AI 知识库生成报告` })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: 'progress_update', percent: 15 })}\n\n`);
    } else if (searchPlatform && searchApiKey) {
      res.write(`data: ${JSON.stringify({ type: 'stage', text: `正在使用自定义搜索平台获取 ${name} 的信息...` })}\n\n`);
    }

    // Build the AI prompt — use custom prompts if provided
    const systemMsg = sysPrompt || `你是一个行业研究分析师，输出结构化研究资料，用中文。`;
    const defaultPrompt = `请研究以下公司：${name}${businessDesc ? `（${businessDesc}）` : ''}
${searchResults || '\n请使用你的知识储备进行回答。'}
按以下格式输出行业研究报告：

## 公司概况
## 市场规模与趋势
## 财务与经营分析
## 竞争格局
## 近期动态
## 机遇与挑战

请用中文，分段清晰，包含具体数据。`;
    // If user provided custom prompt, prepend company context + search results
    const prompt = userPrompt
      ? `请研究以下公司：${name}${businessDesc ? `（${businessDesc}）` : ''}
${searchResults || ''}

用户自定义分析要求：
${userPrompt.replace('{company}', name).replace('{name}', name)}`
      : defaultPrompt;

    // Stream AI response using CodeBuddy CLI
    res.write(`data: ${JSON.stringify({ type: 'stage', text: `🧠 正在调用 AI 模型生成分析报告（可能需要 30-60 秒）...` })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'progress_update', percent: 20 })}\n\n`);

    let fullText = '';
    let lastHeartbeat = Date.now();
    try {
      for await (const ev of streamCodebuddy(systemMsg, prompt)) {
        if (ev.content) {
          fullText += ev.content;
          const pct = Math.min(95, 20 + Math.floor((fullText.length / 15000) * 75));
          res.write(`data: ${JSON.stringify({ type: 'progress_update', percent: pct })}\n\n`);
        }
        // Send heartbeat every 10s so the connection stays alive
        if (Date.now() - lastHeartbeat > 10000) {
          res.write(`data: ${JSON.stringify({ type: 'stage', text: `⏳ 正在生成报告...已收集 ${fullText.length} 字内容` })}\n\n`);
          lastHeartbeat = Date.now();
        }
      }
      res.write(`data: ${JSON.stringify({ type: 'stage', text: `✅ AI 报告生成完成，共 ${fullText.length} 字` })}\n\n`);
    } catch (e: any) {
      console.error('[PubResearch] AI stream error:', e.message);
      if (fullText.length > 0) {
        // Use partial result if available
      } else {
        throw e;
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'progress_update', percent: 100 })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'research_complete', data: fullText })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error('[PubResearch Error]', err.message);
    if (!res.headersSent) res.status(500).json({ error: { message: err.message } });
    else { res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`); res.end(); }
  }
});

// Public report endpoint for portal visitors
app.post('/api/p/report/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { formData, researchData, sysPrompt, userPrompt } = req.body || {};

    const site = await getReportSiteBySlug(slug, 'portal');
    if (!site) return res.status(404).json({ error: { message: 'Portal not found' } });
    const name = formData?.companyName?.trim();
    if (!name) return res.status(400).json({ error: { message: 'Company name is required' } });

    console.log(`[PubReport] Portal:${slug} generating report for "${name}"`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const methods = (formData?.analysisMethods || ['SWOT', 'PEST']).join('、');
    const defaultReportPrompt = `我正在研究"${name}"，请根据以下研究资料，用 Markdown 格式撰写一份完整的行业分析报告。

分析框架: ${methods}

研究资料:
${researchData || '（暂无）'}

请严格按照以下格式输出：

## 公司概况
## 市场规模与趋势
## 财务与经营分析
## 竞争格局
## 近期动态
## 机遇与挑战

要求：
- 每个章节用 "## 标题" 格式，内容用 - 列表分项
- 关键数字用 **加粗** 标记
- 内容详实，每个章节不少于 3 个要点
- 只输出报告内容，不要额外说明文字`;
    const reportUserPrompt = userPrompt
      ? `我正在研究"${name}"，请根据以下研究资料撰写分析报告。

研究资料:
${researchData || '（暂无）'}

用户要求：
${userPrompt.replace(/\{company\}/g, name).replace(/\{name\}/g, name)}

请用 Markdown 格式输出，标题用 ##，列表用 -，关键数据用 **加粗**。`
      : defaultReportPrompt;
    const reportSysMsg = '你是一个行业分析报告撰写专家。用 Markdown 格式输出结构化报告内容。只输出报告正文。';
    const finalReportPrompt = reportUserPrompt;

    // Send initial progress before AI starts
    res.write(`data: ${JSON.stringify({ type: 'progress_update', percent: 3 })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'stage', text: `正在调用 AI 为 ${name} 生成深度分析报告（可能需要 30-60 秒）...` })}\n\n`);

    let fullHtml = '';
    let lastReportHeartbeat = Date.now();
    try {
      for await (const ev of streamCodebuddy(reportSysMsg, finalReportPrompt)) {
        if (ev.content) {
          fullHtml += ev.content;
          const pct = Math.min(95, 3 + Math.floor((fullHtml.length / 30000) * 92));
          res.write(`data: ${JSON.stringify({ type: 'progress_update', percent: pct })}\n\n`);
        }
        // Send heartbeat every 10s
        if (Date.now() - lastReportHeartbeat > 10000) {
          res.write(`data: ${JSON.stringify({ type: 'stage', text: `⏳ 正在生成报告 HTML...已生成 ${fullHtml.length} 个字符` })}\n\n`);
          lastReportHeartbeat = Date.now();
        }
      }
    } catch (e: any) {
      console.error('[PubReport] AI stream error:', e.message);
      if (fullHtml.length === 0) throw e;
    }

    res.write(`data: ${JSON.stringify({ type: 'progress_update', percent: 100 })}\n\n`);

    const finalHtml = cleanAiHtml(fullHtml, `${name} - 行业分析报告`);
    
    // If AI returned text/markdown instead of HTML, wrap in a professional page
    let displayHtml = finalHtml;
    if (!finalHtml.includes('<div') && !finalHtml.includes('<h1') && !finalHtml.includes('<p>') && !finalHtml.includes('<table')) {
      // Improved markdown-to-HTML conversion
      let text = fullHtml
        // Remove line number artifacts like "### 2025年全年业绩（创新高）"
        // Convert headings first: ### → <h3>, ## → <h2>, # → <h1>
        .replace(/^### (.*$)/gm, '</section><section class="sub-section"><h3>$1</h3>')
        .replace(/^## (.*$)/gm, '</section><section class="report-section"><h2>$1</h2>')
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        // Convert tables: detect lines with pipe separators
        .replace(/^\|(.+)\|$/gm, function(m: string) {
          if (m.match(/^\|[-:\s|]+\|$/)) return '<tr class="table-divider"></tr>'; // skip separator rows
          const cells = m.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
          return `<tr>${cells}</tr>`;
        })
        // Wrap consecutive table rows in <table>
        .replace(/((?:<tr>.*<\/tr>\n?)+)/g, '<table>$1</table>')
        // Convert horizontal rules
        .replace(/^---\s*$/gm, '</section><hr></section>')
        // Bold
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // List items
        .replace(/^- (.*)/gm, '<li>$1</li>');
      
      // Wrap consecutive <li> items in <ul>
      text = text.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul class="report-list">$1</ul>');
      
      // Remove empty sections from heading conversions
      text = text.replace(/<\/section>\s*<section class="report-section">/g, '');
      text = text.replace(/<\/section>\s*<section class="sub-section">/g, '');
      // Wrap remaining content in paragraphs
      const parts = text.split(/\n{2,}/);
      text = parts.map(p => {
        p = p.trim();
        if (!p) return '';
        if (p.startsWith('<') && !p.startsWith('<br')) return p; // Already HTML
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
      }).join('\n');
      
      // Final clean up: remove stray </section> / <section> that aren't paired
      text = text.replace(/<\/?section[^>]*>/g, '');
      text = text.replace(/(<table>.*?<\/table>)/gs, '$1');
      
      displayHtml = `<!DOCTYPE html><html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${name} - 行业分析报告</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"Microsoft YaHei",sans-serif;background:#f8fafc;color:#333;line-height:1.8}
.header{background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;padding:40px 20px;text-align:center}
.header h1{font-size:26px;font-weight:700;margin-bottom:6px}
.header p{opacity:0.85;font-size:14px}
.content{max-width:900px;margin:0 auto;padding:24px 16px}
.report-section{background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:24px;margin-bottom:20px}
.report-section h2{font-size:20px;color:#1e40af;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #2563eb}
.sub-section h3{font-size:16px;color:#2563eb;margin:16px 0 8px}
.content p{font-size:14px;margin-bottom:10px;color:#374151}
.content p:last-child{margin-bottom:0}
strong{color:#2563eb}
.report-list{list-style:none;padding:0;margin:8px 0}
.report-list li{padding:4px 0 4px 16px;position:relative;font-size:14px;color:#374151}
.report-list li:before{content:"•";color:#2563eb;position:absolute;left:0}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
td{padding:8px 10px;border:1px solid #e5e7eb;text-align:left}
tr:first-child td{background:#2563eb;color:#fff;font-weight:600}
tr:nth-child(even) td{background:#f8fafc}
hr{border:none;border-top:1px solid #e5e7eb;margin:24px 0}
.footer{text-align:center;padding:24px;color:#94a3b8;font-size:12px;border-top:1px solid #e5e7eb;max-width:900px;margin:0 auto}
</style></head>
<body>
<div class="header"><h1>${name} - 行业分析报告</h1><p>由 YooClaw AI · 秘塔搜索生成</p></div>
<div class="content">${text}</div>
<div class="footer">由 YooClaw AI 生成 · 数据来源：秘塔搜索 · 不构成投资建议 | ${new Date().toISOString().slice(0,10)}</div>
</body></html>`;
      console.log('[PubReport] AI returned markdown, rendered to HTML');
    }

    const reportSlug = generateSlug(name);
    const title = `${name} 行业分析报告`;
    await createReportSite(site.user_id, reportSlug, title, name, displayHtml);

    res.write(`data: ${JSON.stringify({ type: 'report_complete', slug: reportSlug, title, url: '/web/' + reportSlug })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error('[PubReport Error]', err.message);
    if (!res.headersSent) res.status(500).json({ error: { message: err.message } });
    else { res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`); res.end(); }
  }
});

// Public report list endpoint - get all reports for a portal
app.get('/api/p/reports/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const site = await getReportSiteBySlug(slug, 'portal');
    if (!site) return res.status(404).json({ error: { message: 'Portal not found' } });

    const reports = await getUserReportSites(site.user_id, 'report');
    const data = (reports || []).slice(-20).reverse().map((r: any) => ({
      id: r.id,
      slug: r.slug,
      companyName: r.company_name || r.companyName,
      url: '/web/' + r.slug,
      createdAt: new Date(r.created_at || r.createdAt).getTime(),
    }));
    res.json({ data });
  } catch (err: any) {
    console.error('[PubReports Error]', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

// Public delete report endpoint
app.delete('/api/p/reports/:slug/:reportSlug', async (req, res) => {
  try {
    const { slug, reportSlug } = req.params;
    const site = await getReportSiteBySlug(slug, 'portal');
    if (!site) return res.status(404).json({ error: { message: 'Portal not found' } });

    // Verify the report belongs to the portal owner
    const report = await getReportSiteBySlug(reportSlug, 'report');
    if (!report || report.user_id !== site.user_id) {
      return res.status(404).json({ error: { message: 'Report not found' } });
    }

    await deleteReportSite(site.user_id, reportSlug);
    res.json({ data: { success: true } });
  } catch (err: any) {
    console.error('[PubDeleteReport Error]', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ========== CodeBuddy Proxy Route ==========
// Compatibility: acts like OpenAI chat/completions, routes through local CodeBuddy CLI
app.post('/v2/chat/completions', async (req, res) => {
  const { messages = [], stream = true } = req.body || {};
  const systemMsg = messages.find((m: any) => m.role === 'system')?.content || 'You are a helpful AI assistant.';
  const userMsg = messages.find((m: any) => m.role === 'user')?.content || messages.map((m: any) => m.content).join('\n');

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      for await (const ev of streamCodebuddy(systemMsg, userMsg)) {
        if (ev.content) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ev.content } }] })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: any) {
      console.error('[CodeBuddy Proxy Error]', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: { message: err.message } });
      } else {
        res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
        res.end();
      }
    }
  } else {
    try {
      const result = await fetchCodebuddyNonStream(systemMsg, userMsg);
      res.json({ choices: [{ message: { role: 'assistant', content: result } }] });
    } catch (err: any) {
      console.error('[CodeBuddy Proxy Error]', err.message);
      res.status(500).json({ error: { message: err.message } });
    }
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

  // Start CodeBuddy persistent serve mode for AI
  if (CODEBUDDY_API_KEY) {
    try {
      await startCodeBuddyCLI();
    } catch (err: any) {
      console.error('[Startup] CodeBuddy CLI failed:', err.message);
    }
  } else {
    console.warn('[Startup] CODEBUDDY_API_KEY not set. AI features disabled.');
  }

  app.listen(APP_PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  =======================================');
    console.log('');
    console.log('   YooClaw - Cloud Deployment (HTTP API)');
    console.log('');
    console.log(`   URL:      http://localhost:${APP_PORT}`);
    console.log(`   AI Mode:  CodeBuddy CLI serve (port ${CB_SERVE_PORT})`);
    console.log(`   CLI:      ${codebuddyProcess ? 'running' : 'NOT RUNNING'}`);
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

// Cleanup on exit
process.on('SIGINT', () => { stopCodeBuddyCLI(); process.exit(0); });
process.on('SIGTERM', () => { stopCodeBuddyCLI(); process.exit(0); });