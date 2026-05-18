import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
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
  getAllPortalSites,
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
  // Timeout: 5 minutes for entire operation
  const STREAM_TIMEOUT = 5 * 60 * 1000;
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT);

  try {
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
      signal: controller.signal,
    });
    if (!runRes.ok) throw new Error(`CodeBuddy run error: ${runRes.status} ${await runRes.text()}`);
    const runData = await runRes.json();
    const runId = runData.data?.runId;
    if (!runId) throw new Error(`CodeBuddy run failed: ${JSON.stringify(runData)}`);

    // Stream the result via SSE
    const streamRes = await fetch(`http://127.0.0.1:${CB_SERVE_PORT}/api/v1/runs/${runId}/stream`, {
      headers: { 'X-CodeBuddy-Request': '1' },
      signal: controller.signal,
    });
    if (!streamRes.ok || !streamRes.body) throw new Error(`CodeBuddy stream error: ${streamRes.status}`);

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        // Check timeout
        if (Date.now() - startTime > STREAM_TIMEOUT) {
          throw new Error('Stream timeout: AI generation took too long');
        }
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
    } finally { 
      clearTimeout(timeoutId);
      reader.releaseLock(); 
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Stream timeout: AI generation took too long (5 minutes)');
    }
    throw error;
  }
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

  // 6.5. Guard: AI sometimes outputs text summary instead of HTML
  if (!/<[a-zA-Z]/.test(html)) {
    console.log(`[cleanAiHtml] Non-HTML output detected, first 200 chars: "${html.slice(0, 200)}"`);
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${fallbackTitle}</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#666;text-align:center;padding:2em}</style></head><body><h2>⚠️ 生成失败</h2><p>AI 返回了无效内容，请重试。</p></body></html>`;
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

/** Convert markdown-like AI output to HTML (used when AI returns non-HTML content) */
function markdownToHtml(markdown: string, title: string): string {
  if (!markdown || !markdown.trim()) return '';
  let text = mark
down
    .replace(/^### (.*$)/gm, '</section><section class="sub-section"><h3>$1</h3>')
    .replace(/^## (.*$)/gm, '</section><section class="report-section"><h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/^\|(.+)\|$/gm, function(m: string) {
      if (m.match(/^\|[-:\s|]+\|$/)) return '';
      const cells = m.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .replace(/((?:<tr>.*<\/tr>\n?)+)/g, '<table>$1</table>')
    .replace(/^---\s*$/gm, '<hr>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.*)/gm, '<li>$1</li>');

  text = text.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul class="report-list">$1</ul>');
  text = text.replace(/<\/section>\s*<section class="report-section">/g, '');
  text = text.replace(/<\/section>\s*<section class="sub-section">/g, '');
  const parts = text.split(/\n{2,}/);
  text = parts.map((p: string) => {
    p = p.trim();
    if (!p) return '';
    if (p.startsWith('<') && !p.startsWith('<br')) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  text = text.replace(/<\/?section[^>]*>/g, '');
  text = text.replace(/(<table>.*?<\/table>)/gs, '$1');

  return `<!DOCTYPE html><html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title} - 行业分析报告</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"Microsoft YaHei",sans-serif;background:#f8fafc;color:#333;line-height:1.8}
.header{background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;padding:40px 20px;text-align:center}
.header h1{font-size:26px;font-weight:700;margin-bottom:6px}
.content{max-width:900px;margin:0 auto;padding:24px 16px}
.report-section{background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:24px;margin-bottom:20px}
.report-section h2{font-size:20px;color:#1e40af;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #2563eb}
.sub-section h3{font-size:16px;color:#2563eb;margin:16px 0 8px}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb}
th{background:#f1f5f9;color:#1e40af;font-weight:600}
tr:hover{background:#f8fafc}
ul{margin:8px 0;padding-left:20px}
li{margin:4px 0}
p{margin:8px 0}
</style>
</head><body>
<div class="header"><h1>${title}</h1><p>AI 生成行业分析报告</p></div>
<div class="content">${text}</div>
<div style="text-align:center;padding:20px;color:#888;font-size:13px">由 YooClaw AI 生成 · 不构成投资建议 | ${new Date().toISOString().slice(0,10)}</div>
</body></html>`;
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
function generatePortalHtml(siteName: string, siteDesc: string, template: string, apiBase: string, slug: string, widgets?: any[]): string {
  // Intel Station Layout (Three-Column Intelligence Workstation)
  if (template === 'intel-station') {
    return generateIntelStationHtml(siteName, siteDesc, apiBase, slug, widgets);
  }
  
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

  const wlist = (widgets && widgets.length > 0) ? widgets : [{ type: 'report-generator', title: '行业分析报告', config: {} }];
  // Normalize type names (JS config uses 'report'/'monitor', widget config uses 'report-generator'/'intel-monitor')
  wlist.forEach((w: any) => {
    if (w.type === 'report') w.type = 'report-generator';
    else if (w.type === 'monitor') w.type = 'intel-monitor';
  });
  const reportWidgetIndices: number[] = [];
  const monitorWidgetIndices: number[] = [];

  // Build compact cards HTML
  let cardsHtml = '';

  wlist.forEach((w: any, i: number) => {
    if (w.type === 'report-generator') {
      reportWidgetIndices.push(i);
      const title = (w.title || '行业分析报告').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      cardsHtml += `
  <div class="c-card type-report" onclick="openModal(${i})" title="${title}">
    <div class="cc-icon">📊</div>
    <div class="cc-title">${title}</div>
    <div class="cc-meta"><span>SWOT</span><span class="cc-dot"></span><span>PEST</span><span class="cc-dot"></span><span>+3</span></div>
  </div>`;
    } else if (w.type === 'intel-monitor') {
      monitorWidgetIndices.push(i);
      const title = (w.title || '情报监控').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const sources = w.config?.sources || [];
      const kwCount = sources.reduce((sum: number, s: any) => sum + (s.keywords?.length || 0), 0);
      const freq = sources[0]?.updateFrequency || 'daily';
      const freqLabel = freq === 'realtime' ? '实时' : freq === 'daily' ? '每日' : '每周';
      cardsHtml += `
  <div class="c-card type-monitor" onclick="openModal(${i})" title="${title}">
    <div class="cc-icon">🛰️</div>
    <div class="cc-title">${title}</div>
    <div class="cc-meta"><span>${kwCount} 关键词</span><span class="cc-dot"></span><span>${freqLabel}</span></div>
  </div>`;
    }
  });

  // 我的报告卡片
  cardsHtml += `
  <div class="c-card type-reports" onclick="openReportList()" title="查看所有报告">
    <div class="cc-icon">📋</div>
    <div class="cc-title">我的报告</div>
    <div class="cc-meta"><span id="reportCardCount">0 份</span></div>
  </div>`;

  // Build widget configs for JS (modal content data)
  const widgetConfigsJs = JSON.stringify(wlist.map((w: any, i: number) => {
    if (w.type === 'report-generator') {
      return {
        type: 'report',
        idx: i,
        title: w.title || '行业分析报告',
        subtitle: (w.config?.subtitle || '配置分析参数，AI 将自动搜索信息并生成专业的分析报告。')
          .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
        defaultOpen: w.config?.defaultOpen !== false,
        sysPrompt: (w.config?.sysPrompt || '').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
        userPrompt: (w.config?.userPrompt || '').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
        searchPlatform: w.config?.searchPlatform || 'metaso',
        searchApiKey: (w.config?.searchApiKey || '').replace(/'/g,'\\x27'),
        searchEndpoint: (w.config?.searchEndpoint || '').replace(/'/g,'\\x27'),
      };
    } else {
      const sources = (w.config?.sources || []).map((s: any) => ({
        name: (s.name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
        aiProvider: (s.aiProvider || '默认').replace(/'/g,'\\x27'),
        aiModel: (s.aiModel || '默认').replace(/'/g,'\\x27'),
        updateFrequency: s.updateFrequency || 'daily',
        keywords: (s.keywords || []).map((k: string) => k.replace(/'/g,'\\x27')),
        customPrompt: (s.customPrompt || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'\\x27'),
        apiKey: (s.apiKey || '').replace(/'/g,'\\x27'),
      }));
      return {
        type: 'monitor',
        idx: i,
        title: (w.title || '情报监控').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
        subtitle: sources.length > 0 ? '追踪配置的关键词情报' : '暂无监控源配置',
        sources,
      };
    }
  }));

  const reportIndicesJson = JSON.stringify(reportWidgetIndices);

  // Modal dark/light colors
  const modalBg = isDark ? '#111118' : '#ffffff';
  const modalBorder = isDark ? 'rgba(255,255,255,.08)' : '#e5e7eb';
  const modalInputBg = isDark ? 'rgba(255,255,255,.02)' : '#f8fafc';
  const modalInputBorder = isDark ? 'rgba(255,255,255,.06)' : '#d1d5db';
  const reportAccent = '#6366f1';
  const reportAccentLight = '#818cf8';
  const monitorAccent = '#f59e0b';
  const monitorAccentLight = '#fbbf24';

  const defaultSysPrompt = '你是一个行业研究分析师，输出结构化研究资料，用中文。';
  const defaultUserPrompt = `请用完整的 HTML 格式输出行业研究报告，包含以下章节（用 <h2> 标题和 <p>/<ul>/<table> 等 HTML 标签）：

<h2>公司概况</h2>
<h2>市场规模与趋势</h2>
<h2>财务与经营分析</h2>
<h2>竞争格局</h2>
<h2>近期动态</h2>
<h2>机遇与挑战</h2>

要求：
- 每个章节用 <h2> 标题，内容用 <p> 段落和 <ul>/<li> 列表
- 关键数字用 <strong>加粗</strong>
- 包含具体数据，每个章节不少于 3 个要点
- 只输出纯 HTML 代码，不要 markdown 标记，不要额外说明文字`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${sn}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--card-radius:14px;--transition-smooth:cubic-bezier(.4,0,.2,1)}
html{scroll-behavior:smooth}
body{font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei","PingFang SC",sans-serif;background:${pageBg};color:${textClr};min-height:100vh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
::selection{background:${theme.primary}22;color:${textClr}}
body::-webkit-scrollbar{width:6px}
body::-webkit-scrollbar-track{background:transparent}
body::-webkit-scrollbar-thumb{background:${isDark?'#334155':'#cbd5e1'};border-radius:10px}
body::-webkit-scrollbar-thumb:hover{background:${isDark?'#475569':'#94a3b8'}}

/* ===== HEADER ===== */
.header{${headerBg};padding:52px 20px 44px;text-align:center;position:relative;overflow:hidden}
.header::before{content:'';position:absolute;top:-60%;left:-30%;width:160%;height:200%;background:radial-gradient(ellipse at 35% 50%,rgba(255,255,255,0.07) 0%,transparent 60%);pointer-events:none;animation:headerGlow 8s ease-in-out infinite alternate}
.header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:${isDark?'rgba(255,255,255,.06)':'rgba(255,255,255,.12)'};pointer-events:none}
@keyframes headerGlow{0%{opacity:.6;transform:scale(1)}100%{opacity:1;transform:scale(1.08)}}
.header h1{font-size:30px;font-weight:800;color:${isDark?'#f1f5f9':'#ffffff'};margin-bottom:10px;letter-spacing:-.3px;position:relative;animation:fadeSlideDown .6s var(--transition-smooth)}
.header p{font-size:15px;color:${isDark?'#94a3b8':'rgba(255,255,255,0.78)'};max-width:600px;margin:0 auto;line-height:1.6;position:relative;animation:fadeSlideDown .6s var(--transition-smooth) .1s backwards}
@keyframes fadeSlideDown{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}

/* ===== CARD ROW ===== */
.card-row-wrap{display:flex;justify-content:center;gap:16px;padding:24px 24px 14px;flex-wrap:wrap;max-width:1100px;margin:0 auto}

/* Card — polished */
.c-card{width:230px;height:138px;border-radius:var(--card-radius);border:1px solid ${borderClr};background:${cardBg};cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;transition:all .35s var(--transition-smooth);position:relative;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,${isDark?'.2':'.04'})}
.c-card::before{content:'';position:absolute;inset:0;opacity:0;transition:opacity .35s;pointer-events:none}
.type-report::before{background:radial-gradient(circle at 50% 0%,rgba(99,102,241,.06) 0%,transparent 70%)}
.type-monitor::before{background:radial-gradient(circle at 50% 0%,rgba(245,158,11,.06) 0%,transparent 70%)}
.c-card:hover{border-color:${theme.primary}44;transform:translateY(-4px);box-shadow:0 12px 32px rgba(0,0,0,${isDark?'.35':'.1'})}
.c-card:hover::before{opacity:1}
.c-card:active{transform:scale(.97);transition:transform .1s}
.c-card::after{content:'';position:absolute;top:0;left:0;right:0;height:3px;opacity:0;transition:opacity .35s var(--transition-smooth)}
.c-card:hover::after{opacity:1}
.type-report::after{background:linear-gradient(90deg,${reportAccent},${reportAccentLight})}
.type-monitor::after{background:linear-gradient(90deg,${monitorAccent},${monitorAccentLight})}

/* Card entrance animation */
@keyframes cardIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.c-card{animation:cardIn .5s var(--transition-smooth) backwards}
.c-card:nth-child(1){animation-delay:0s}
.c-card:nth-child(2){animation-delay:.06s}
.c-card:nth-child(3){animation-delay:.12s}
.c-card:nth-child(4){animation-delay:.18s}
.c-card:nth-child(5){animation-delay:.24s}
.c-card:nth-child(6){animation-delay:.3s}
.c-card:nth-child(7){animation-delay:.36s}
.c-card:nth-child(8){animation-delay:.42s}

.cc-icon{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:21px;transition:transform .35s var(--transition-smooth)}
.c-card:hover .cc-icon{transform:scale(1.08)}
.type-report .cc-icon{background:linear-gradient(135deg,rgba(99,102,241,.12),rgba(129,140,248,.08));color:#818cf8}
.type-monitor .cc-icon{background:linear-gradient(135deg,rgba(245,158,11,.12),rgba(251,191,36,.08));color:#fbbf24}
.cc-title{font-size:13px;font-weight:700;color:${textClr};letter-spacing:-.2px;text-align:center;line-height:1.3;padding:0 10px}
.cc-meta{font-size:9px;color:${mutedClr};display:flex;align-items:center;gap:6px;font-weight:500}
.cc-dot{width:4px;height:4px;border-radius:50%;background:${isDark?'#334155':'#d1d5db'}}

/* ===== DIVIDER ===== */
.divider{max-width:1100px;margin:20px auto;padding:0 24px;display:flex;align-items:center;gap:12px}
.divider .dlabel{font-size:10px;font-weight:700;letter-spacing:1.8px;color:${mutedClr};text-transform:uppercase;white-space:nowrap}
.divider .dline{flex:1;height:1px;background:linear-gradient(90deg,${borderClr},transparent)}

/* ===== CONTENT AREA ===== */
.content-area{flex:1;max-width:1100px;margin:0 auto;padding:12px 24px 48px;width:100%}
.placeholder{text-align:center;padding:60px 20px}
.placeholder .ph-icon{font-size:40px;margin-bottom:14px;opacity:.25;transition:opacity .3s;animation:phPulse 3s ease-in-out infinite}
@keyframes phPulse{0%,100%{opacity:.2}50%{opacity:.35}}
.placeholder .ph-text{font-size:13px;color:${mutedClr};line-height:1.6}

/* ===== REPORT LIST ===== */
.report-item{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border:1px solid ${borderClr};border-radius:10px;margin-bottom:8px;transition:all .2s var(--transition-smooth)}
.report-item:hover{background:${isDark?'#1e293b':'#f8fafc'};border-color:${theme.primary}22;transform:translateX(2px)}
.report-item .rname{font-size:13px;font-weight:600;color:${textClr};letter-spacing:-.1px}
.report-item .rdate{font-size:11px;color:${mutedClr};margin-top:3px}
.report-item a,.report-item button{font-size:12px;text-decoration:none;flex-shrink:0;padding:5px 12px;border-radius:6px;cursor:pointer;font-weight:500;transition:all .2s}

/* ===== MODAL ===== */
.modal-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .25s}
.modal-overlay.open{opacity:1;pointer-events:auto}
.modal-bg{position:absolute;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(6px)}
.modal-panel{position:relative;width:100%;max-width:600px;max-height:88vh;background:${modalBg};border:1px solid ${modalBorder};border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transform:scale(.92) translateY(20px);transition:transform .35s cubic-bezier(.34,1.56,.64,1);box-shadow:0 24px 64px rgba(0,0,0,${isDark?'.5':'.15'})}
.modal-overlay.open .modal-panel{transform:scale(1) translateY(0)}
.modal-panel.type-report{border-top:4px solid ${reportAccent}}
.modal-panel.type-monitor{border-top:4px solid ${monitorAccent}}
.modal-hd{display:flex;align-items:center;gap:14px;padding:20px 22px;border-bottom:1px solid ${modalBorder};flex-shrink:0}
.modal-hd .mh-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.modal-panel.type-report .mh-icon{background:linear-gradient(135deg,rgba(99,102,241,.14),rgba(129,140,248,.06));color:#818cf8}
.modal-panel.type-monitor .mh-icon{background:linear-gradient(135deg,rgba(245,158,11,.14),rgba(251,191,36,.06));color:#fbbf24}
.modal-hd .mh-info{flex:1;min-width:0}
.modal-hd .mh-title{font-size:16px;font-weight:700;color:${textClr};letter-spacing:-.2px}
.modal-hd .mh-sub{font-size:11px;color:${mutedClr};margin-top:3px}
.modal-close{width:34px;height:34px;border-radius:50%;border:1px solid ${modalBorder};background:transparent;color:${mutedClr};cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0;font-size:17px;line-height:1}
.modal-close:hover{background:${isDark?'rgba(255,255,255,.08)':'#f1f5f9'};color:${textClr};border-color:${isDark?'rgba(255,255,255,.15)':'#94a3b8'};transform:rotate(90deg)}
.modal-bd{flex:1;overflow-y:auto;padding:20px 22px 22px;scroll-behavior:smooth}
.modal-bd::-webkit-scrollbar{width:5px}
.modal-bd::-webkit-scrollbar-thumb{background:${isDark?'#334155':'#d1d5db'};border-radius:10px}
.modal-ft{padding:16px 22px;border-top:1px solid ${modalBorder};flex-shrink:0;display:flex;gap:10px}
.modal-ft button{flex:1;padding:11px 16px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit;letter-spacing:0}
.btn-save{color:#fff}
.modal-panel.type-report .btn-save{background:linear-gradient(135deg,${reportAccent},${reportAccentLight})}
.modal-panel.type-monitor .btn-save{background:linear-gradient(135deg,${monitorAccent},${monitorAccentLight})}
/* ===== REPORTS CARD & MODAL ===== */
.type-reports{background:linear-gradient(135deg,rgba(16,185,129,.05),rgba(52,211,153,.02))}
.type-reports::before{background:radial-gradient(circle at 50% 0%,rgba(16,185,129,.08) 0%,transparent 70%)}
.type-reports::after{background:linear-gradient(90deg,#10b981,#34d399)}
.type-reports .cc-icon{background:linear-gradient(135deg,rgba(16,185,129,.14),rgba(52,211,153,.08));color:#34d399}
.modal-panel.type-reports{border-top:4px solid #10b981}
.modal-panel.type-reports .mh-icon{background:linear-gradient(135deg,rgba(16,185,129,.14),rgba(52,211,153,.06));color:#34d399}
.rpt-cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;padding:0}
.rpt-card{position:relative;background:${modalInputBg};border:1px solid ${modalBorder};border-radius:12px;padding:18px 20px;cursor:pointer;transition:all .25s;overflow:hidden}
.rpt-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,${isDark?'.3':'.08'});border-color:#10b98155}
.rpt-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#10b981,#34d399);opacity:0;transition:opacity .25s}
.rpt-card:hover::before{opacity:1}
.rpt-card .rpt-company{font-size:15px;font-weight:700;color:${textClr};margin-bottom:6px}
.rpt-card .rpt-date{font-size:11px;color:${mutedClr};margin-bottom:12px}
.rpt-card .rpt-actions{display:flex;gap:10px;align-items:center}
.rpt-card .rpt-view{font-size:12px;font-weight:600;color:#10b981;text-decoration:none;border:1px solid #10b98144;padding:6px 14px;border-radius:7px;transition:all .2s}
.rpt-card .rpt-view:hover{background:#10b98115;color:#059669}
.rpt-card .rpt-delete{position:absolute;top:10px;right:10px;width:24px;height:24px;border-radius:6px;border:none;background:transparent;color:${mutedClr};cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .2s}
.rpt-card .rpt-delete:hover{background:rgba(226,75,74,.1);color:#e24b4a}
.btn-save:hover{opacity:.92;transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,${isDark?'.3':'.1'})}
.btn-cancel{background:${isDark?'rgba(255,255,255,.03)':'#f3f4f6'};color:${mutedClr};border:1px solid ${modalBorder}}
.btn-cancel:hover{background:${isDark?'rgba(255,255,255,.06)':'#e5e7eb'};color:${textClr}}

/* ===== MODAL FORM ===== */
.mb-group{margin-bottom:18px}
.mb-group:last-child{margin-bottom:0}
.mb-label{display:block;font-size:11px;font-weight:600;color:${mutedClr};margin-bottom:7px;letter-spacing:.3px}
.mb-label span{font-weight:400;color:${isDark?'#475569':'#94a3b8'}}
.mb-input,.mb-select{width:100%;padding:10px 14px;font-size:13px;border:1px solid ${modalInputBorder};border-radius:9px;background:${modalInputBg};color:${textClr};outline:none;transition:all .25s;font-family:inherit}
.mb-input:focus,.mb-select:focus{border-color:${theme.primary}66;box-shadow:0 0 0 3px ${theme.primary}15}
.mb-input::placeholder{color:${isDark?'#475569':'#94a3b8'}}
.mb-select option{background:${cardBg};color:${textClr}}
.mb-area{width:100%;padding:10px 14px;font-size:12px;border:1px solid ${modalInputBorder};border-radius:9px;background:${modalInputBg};color:${textClr};outline:none;transition:all .25s;resize:vertical;font-family:inherit;min-height:60px;line-height:1.7}
.mb-area:focus{border-color:${theme.primary}66;box-shadow:0 0 0 3px ${theme.primary}15}
.mb-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}

/* ===== FRAMEWORK CHIPS ===== */
.fw-chips{display:flex;flex-wrap:wrap;gap:6px}
.fw-c{position:relative;cursor:pointer;user-select:none}
.fw-c input{position:absolute;opacity:0;width:0;height:0}
.fw-c .fw-v{display:block;padding:7px 16px;border:2px solid ${modalInputBorder};border-radius:9px;font-size:12px;font-weight:600;color:${mutedClr};transition:all .25s}
.fw-c input:checked+.fw-v{border-color:${theme.primary}66;background:${theme.primary}14;color:${isDark?reportAccentLight:theme.primary};box-shadow:0 2px 8px ${theme.primary}18}
.fw-c:hover .fw-v{border-color:${theme.primary}44}

/* ===== KEYWORD TAGS ===== */
.kw-tags{display:flex;flex-wrap:wrap;gap:5px}
.kw-t{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:10px;font-weight:600;background:rgba(129,140,248,.08);color:#a5b4fc;border:1px solid rgba(129,140,248,.15);transition:all .2s}
.kw-t:hover{background:rgba(129,140,248,.15);transform:translateY(-1px)}

/* ===== MONITOR SOURCE MINI CARD ===== */
.src-mini{background:${isDark?'rgba(255,255,255,.02)':'#f9fafb'};border:1px solid ${modalBorder};border-radius:10px;padding:16px;margin-bottom:12px;transition:border-color .2s}
.src-mini:hover{border-color:${monitorAccent}33}
.src-mini:last-child{margin-bottom:0}
.src-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.src-top .st-name{font-size:12px;font-weight:600;color:${textClr};display:flex;align-items:center;gap:8px}
.src-top .st-name::before{content:'';width:5px;height:5px;border-radius:50%;background:${monitorAccent};flex-shrink:0;box-shadow:0 0 6px ${monitorAccent}44}
.src-top .st-model{font-size:10px;padding:3px 10px;border-radius:10px;border:1px solid rgba(251,191,36,.2);color:#fbbf24;background:rgba(251,191,36,.06);font-weight:600}

/* 监控源可编辑样式 */
.st-name-input { font-size: 14px; font-weight: 700; border: 1px solid transparent; background: transparent; padding: 4px 8px; border-radius: 6px; width: 100%; transition: all .2s }
.st-name-input:focus { border-color: #f59e0b33; background: #fff; outline: none; box-shadow: 0 0 0 3px rgba(245,158,11,.1) }
.src-del { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #94a3b8; font-size: 14px; transition: all .2s; flex-shrink: 0 }
.src-del:hover { background: #fef2f2; color: #ef4444 }
.kw-x { margin-left: 4px; background: none; border: none; color: inherit; cursor: pointer; font-size: 12px; opacity: .5; padding: 0; line-height: 1 }
.kw-x:hover { opacity: 1 }
.kw-add-row { display: flex; gap: 8px; margin-top: 8px }
.kw-add-input { flex: 1; padding: 6px 10px; font-size: 12px; border: 1px solid #e5e7eb; border-radius: 6px }
.kw-add-input:focus { outline: none; border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.08) }
.kw-add-btn { padding: 6px 12px; background: #f59e0b; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600 }
.btn-add-src:hover { background: #f8f4ff !important; border-color: #6366f1 !important }

/* ===== PROGRESS ===== */
.progress-section{margin-top:18px}
.progress-label{display:flex;justify-content:space-between;font-size:12px;color:${mutedClr};margin-bottom:8px;font-weight:500}
.progress-bar{height:6px;background:${isDark?'#1e293b':'#e5e7eb'};border-radius:4px;overflow:hidden}
.progress-fill{height:100%;background:linear-gradient(90deg,${theme.primary},${theme.accent});border-radius:4px;transition:width .5s ease-out}
.stage-text{display:flex;align-items:flex-start;gap:9px;padding:12px 14px;background:${isDark?'#1e293b':'#f8fafc'};border-radius:9px;margin-top:14px;font-size:13px;color:${mutedClr};line-height:1.6}
.spinner{width:14px;height:14px;border:2px solid ${theme.primary}33;border-top-color:${theme.primary};border-radius:50%;animation:spin .6s linear infinite;flex-shrink:0;margin-top:2px}
@keyframes spin{to{transform:rotate(360deg)}}
.result-card{background:${successBg};border:1px solid ${successBorder};border-radius:14px;padding:24px;text-align:center;margin-top:12px}
.result-card h3{font-size:20px;color:${successText};margin-bottom:10px;font-weight:700}
.result-card .url-box{display:flex;align-items:center;gap:10px;background:${cardBg};border:1px solid ${inputBorder};border-radius:10px;padding:12px 16px;margin-top:14px}
.result-card .url-box a{flex:1;font-size:13px;color:${theme.primary};text-decoration:none;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.error-box{background:${errBg};border:1px solid ${errBorder};border-radius:10px;padding:16px;margin-top:14px;font-size:13px;color:${errText};line-height:1.6;white-space:pre-wrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px 20px;font-size:14px;font-weight:600;border:none;border-radius:10px;cursor:pointer;transition:all .25s;color:#fff;background:linear-gradient(135deg,${theme.primary},${theme.accent});margin-top:18px;letter-spacing:0}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn:hover:not(:disabled){opacity:.92;transform:translateY(-1px);box-shadow:0 4px 16px ${theme.primary}44}

/* ===== FOOTER ===== */
.footer{text-align:center;padding:28px 24px;font-size:12px;color:${mutedClr};border-top:1px solid ${borderClr};letter-spacing:.3px;position:relative}
.footer::before{content:'';position:absolute;top:-1px;left:50%;transform:translateX(-50%);width:120px;height:2px;background:linear-gradient(90deg,transparent,${theme.accent}66,transparent)}

/* ===== INTEL RESULTS ===== */
.intel-results-area{padding:0 24px 24px;max-width:1100px;margin:0 auto}
.intel-src-group{margin-bottom:28px}
.isg-title{font-size:15px;font-weight:700;color:${textClr};margin-bottom:16px;display:flex;align-items:center;gap:8px}
.isg-title::before{content:'';width:8px;height:8px;border-radius:3px;background:${monitorAccent};flex-shrink:0}
.intel-src-block{margin-bottom:20px}
.intel-src-title{font-size:14px;font-weight:600;color:${textClr};display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid ${borderClr}}
.intel-src-title .isdot{width:7px;height:7px;border-radius:50%;background:${monitorAccent};flex-shrink:0;box-shadow:0 0 8px ${monitorAccent}44}
.intel-src-title .isfreq{font-size:10px;color:${mutedClr};font-weight:400}
.intel-items{display:flex;flex-direction:column;gap:8px}
.intel-item{display:flex;gap:14px;padding:14px 16px;background:${cardBg};border:1px solid ${borderClr};border-radius:10px;transition:all .25s var(--transition-smooth);position:relative;overflow:hidden}
.intel-item::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:transparent;transition:background .25s}
.intel-item:hover{border-color:${theme.primary}33;background:${isDark?'rgba(255,255,255,.02)':'#fafbfc'};transform:translateX(3px)}
.intel-item:hover::before{background:${theme.accent}}
.intel-item .inum{width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,${theme.accent},${theme.primary});color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 6px ${theme.primary}33}
.intel-item .ibody{flex:1;min-width:0}
.intel-item .ititle{font-size:13px;font-weight:600;color:${textClr};margin-bottom:5px;line-height:1.5;letter-spacing:-.1px}
.intel-item .isummary{font-size:12px;color:${mutedClr};line-height:1.6}
.intel-item .isource{font-size:10px;color:${mutedClr};margin-top:6px;display:flex;align-items:center;gap:4px}
.intel-item .isource::before{content:'🔗';font-size:10px}
.intel-loading{text-align:center;padding:24px;color:${mutedClr};font-size:13px}
.intel-loading .spinner{display:inline-block;width:18px;height:18px;border:2px solid ${theme.primary}33;border-top-color:${theme.primary};border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:10px}
.intel-error{text-align:center;padding:18px;color:${errText};background:${errBg};border:1px solid ${errBorder};border-radius:10px;font-size:13px;margin-bottom:14px}
.intel-empty{text-align:center;padding:24px;color:${mutedClr};font-size:13px}

/* ===== RESPONSIVE ===== */
@media(max-width:768px){
  .header{padding:40px 16px 32px}
  .header h1{font-size:24px}
  .card-row-wrap{gap:12px;padding:18px 16px 10px}
  .c-card{width:180px;height:118px}
  .cc-icon{width:38px;height:38px;font-size:18px}
  .cc-title{font-size:12px}
  .modal-panel{max-width:95vw;border-radius:14px 14px 0 0;max-height:90vh}
  .mb-row{grid-template-columns:1fr}
}
@media(max-width:400px){
  .card-row-wrap{gap:8px}
  .c-card{width:150px;height:105px;border-radius:12px}
  .cc-icon{width:32px;height:32px;font-size:16px;border-radius:10px}
  .intel-item{padding:10px 12px;gap:10px}
}

/* ===== ACCESSIBILITY ===== */
:focus-visible{outline:2px solid ${theme.accent};outline-offset:2px;border-radius:4px}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid ${theme.accent};outline-offset:2px}

</style>
</head>
<body>
<!-- ===== MODAL OVERLAY ===== -->
<div class="modal-overlay" id="modalOverlay" onclick="closeModal(event)">
  <div class="modal-bg"></div>
  <div class="modal-panel" id="modalPanel" onclick="event.stopPropagation()">
    <div class="modal-hd">
      <div class="mh-icon" id="modalIcon"></div>
      <div class="mh-info">
        <div class="mh-title" id="modalTitle"></div>
        <div class="mh-sub" id="modalSub"></div>
      </div>
      <button class="modal-close" onclick="closeModalDirect()">&times;</button>
    </div>
    <div class="modal-bd" id="modalBody"></div>
    <div class="modal-ft" id="modalFooter">
      <button class="btn-cancel" onclick="closeModalDirect()">取消</button>
      <button class="btn-save" id="btnSave" onclick="closeModalDirect()">保存配置</button>
    </div>
  </div>
</div>

<div class="header">
  <h1>${sn}</h1>
  ${sd ? '<p>'+sd+'</p>' : ''}
</div>

<div class="card-row-wrap">
  ${cardsHtml}
</div>

<div class="intel-results-area" id="intelResultsArea" style="display:none">
  <div class="divider" style="margin-bottom:16px"><span class="dlabel">Intel Feed</span><span class="dline"></span></div>
  <div class="intel-results" id="intelResults"></div>
  <div class="intel-status" id="intelStatus"></div>
</div>

<div id="globalPlaceholder" style="display:none"></div>
<div id="globalReports" style="display:none"></div>

<div class="footer">Powered by <strong>YooClaw AI</strong></div>

<script>
var API='${apiBase}';
var REPORT_INDICES=${reportIndicesJson};
var DEFAULT_DEEPSEEK_KEY='${process.env.DEEPSEEK_API_KEY || ""}';
var DEFAULT_METASO_KEY='${process.env.METASO_API_KEY || ""}';
var WIDGETS=${widgetConfigsJs};
var METHOD_NAMES={SWOT:'SWOT分析',PEST:'PEST分析',PORTER:'波特五力分析','3C':'3C分析',STOCK:'股价预测'};

function $(id){return document.getElementById(id)}

/* ===== MODAL ===== */
var _activeIdx=-1;

function openModal(idx){
  _activeIdx=idx;
  var w=WIDGETS[idx];
  if(!w)return;
  var overlay=$('modalOverlay');
  var panel=$('modalPanel');
  panel.className='modal-panel type-'+(w.type==='report'?'report':'monitor');
  $('modalIcon').textContent=w.type==='report'?'📊':'🛰️';
  $('modalTitle').textContent=w.title;
  $('modalSub').textContent=w.subtitle;
  if(w.type==='report'){
    renderReportForm(idx,w);
    $('modalFooter').style.display='flex';
    $('btnSave').style.display='none';
  }else{
    renderMonitorForm(idx,w);
    $('modalFooter').style.display='flex';
    $('btnSave').style.display='inline-flex';
    $('btnSave').onclick=function(){saveMonitorConfig(idx)};
  }
  overlay.classList.add('open');
  document.body.style.overflow='hidden';
}

function closeModal(e){
  if(e&&e.target!==$('modalOverlay'))return;
  closeModalDirect();
}

function closeModalDirect(){
  $('modalOverlay').classList.remove('open');
  document.body.style.overflow='';
  _activeIdx=-1;
}

document.addEventListener('keydown',function(e){
  if(e.key==='Escape')closeModalDirect();
});

/* ===== REPORT FORM ===== */
function renderReportForm(idx,w){
  var defSys='${defaultSysPrompt.replace(/'/g,"\\'").replace(/\n/g,'\\n')}';
  var defUsr='${defaultUserPrompt.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n')}';
  var s='<div class="mb-group">';
  s+='<label class="mb-label">公司 / 行业名称</label>';
  s+='<input class="mb-input" id="mfCompany_'+idx+'" placeholder="例如：比亚迪、特斯拉、宁德时代...">';
  s+='</div><div class="mb-group">';
  s+='<label class="mb-label">分析框架 <span>· 可多选</span></label>';
  s+='<div class="fw-chips" id="mfFrameworks_'+idx+'">';
  var fws=[{v:'SWOT',l:'SWOT',c:true},{v:'PEST',l:'PEST',c:true},{v:'PORTER',l:'波特五力',c:false},{v:'3C',l:'3C分析',c:false},{v:'STOCK',l:'股价预测',c:false}];
  fws.forEach(function(f){
    s+='<label class="fw-c"><input type="checkbox" value="'+f.v+'"'+(f.c?' checked':'')+' onchange="onFrameworkChange('+idx+')"><span class="fw-v">'+f.l+'</span></label>';
  });
  s+='</div></div><div class="mb-row"><div class="mb-group">';
  s+='<label class="mb-label">搜索平台</label>';
  s+='<select class="mb-select" id="mfPlatform_'+idx+'" onchange="onPlatformChange('+idx+')">';
  s+='<option value="">默认 (CodeBuddy)</option>';
  s+='<option value="tavily">Tavily</option>';
  s+='<option value="metaso" selected>秘塔 (Metaso)</option>';
  s+='<option value="deepseek">DeepSeek</option>';
  s+='<option value="custom">自定义 API</option></select></div>';
  s+='<div class="mb-group"><label class="mb-label">API Key</label>';
  s+='<div style="position:relative"><input class="mb-input" type="password" id="mfApiKey_'+idx+'" value="'+(w.searchApiKey||'mk-65F31E31CBAB4DD4697CF57DA49000CB')+'" style="padding-right:36px"><span onclick="toggleApiKeyEye('+idx+')" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;color:#94a3b8;user-select:none" id="mfApiKeyEye_'+idx+'"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></span></div>';
  s+='<input class="mb-input" id="mfEndpoint_'+idx+'" placeholder="自定义 API 端点 URL..." style="margin-top:6px;display:none"></div></div>';
  s+='<div class="mb-group"><label class="mb-label">系统提示词 <span>（可选）</span></label>';
  s+='<textarea class="mb-area" id="mfSysPrompt_'+idx+'" style="min-height:50px">'+(w.sysPrompt||defSys)+'</textarea></div>';
  s+='<div class="mb-group"><label class="mb-label">用户提示词 <span>（可选）</span></label>';
  s+='<textarea class="mb-area" id="mfUserPrompt_'+idx+'" style="min-height:100px">'+(w.userPrompt||defUsr)+'</textarea></div>';
  s+='<button class="btn" id="btnStartAnalysis_'+idx+'" onclick="startAnalysis('+idx+')">开始分析</button>';
  s+='<div id="modalResultArea_'+idx+'"></div>';
  $('modalBody').innerHTML=s;
  $('modalBody').scrollTop=0;
}

/* ===== MONITOR VIEW ===== */
function renderMonitorForm(idx,w){
  var s='';
  var sources=w.sources||[];
  if(sources.length>0){
    sources.forEach(function(src,si){
      s+='<div class="src-mini" id="srcBlock_'+idx+'_'+si+'">';
      s+='<div class="src-top"><input class="st-name-input" id="srcName_'+idx+'_'+si+'" value="'+escHtml(src.name)+'" placeholder="监控源名称">';
      s+='<span class="src-del" onclick="deleteSource('+idx+','+si+')" title="删除此监控源">\u2715</span></div>';
      s+='<div class="mb-row"><div class="mb-group"><label class="mb-label">AI 引擎</label>';
      s+='<select class="mb-select" id="srcProvider_'+idx+'_'+si+'">';
      ['deepseek','metaso','codebuddy','custom'].forEach(function(p){
        s+='<option value="'+p+'"'+(src.aiProvider===p?' selected':'')+'>'+p+'</option>';
      });
      s+='</select></div>';
      s+='<div class="mb-group"><label class="mb-label">AI 模型</label>';
      s+='<input class="mb-input" id="srcModel_'+idx+'_'+si+'" value="'+escHtml(src.aiModel||'')+'" placeholder="例如: deepseek-v3.1">';
      s+='</div></div>';
      s+='<div class="mb-row"><div class="mb-group"><label class="mb-label">API Key</label>';
      s+='<input class="mb-input" type="password" id="srcApiKey_'+idx+'_'+si+'" value="'+escHtml(src.apiKey||'')+'" placeholder="可选">';
      s+='</div><div class="mb-group"><label class="mb-label">更新频率</label>';
      s+='<select class="mb-select" id="srcFreq_'+idx+'_'+si+'">';
      ['hourly','daily','weekly','monthly'].forEach(function(f){
        var labels={hourly:'每小时',daily:'每日',weekly:'每周',monthly:'每月'};
        s+='<option value="'+f+'"'+(src.updateFrequency===f?' selected':'')+'>'+labels[f]+'</option>';
      });
      s+='</select></div></div>';
      var kws=src.keywords||[];
      s+='<div class="mb-group"><label class="mb-label">监控关键词</label>';
      s+='<div class="kw-tags" id="kwTags_'+idx+'_'+si+'">';
      kws.forEach(function(k){
        s+='<span class="kw-t">'+escHtml(k)+'<button class="kw-x" onclick="removeKeyword('+idx+','+si+',this.parentElement)" title="移除">&times;</button></span>';
      });
      s+='</div>';
      s+='<div class="kw-add-row"><input class="kw-add-input" id="kwInput_'+idx+'_'+si+'" placeholder="输入关键词后回车添加..." onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();addKeyword('+idx+','+si+')}">';
      s+='<button class="kw-add-btn" onclick="addKeyword('+idx+','+si+')">+</button></div>';
      s+='</div>';
      s+='<div class="mb-group"><label class="mb-label">自定义提示词 <span>（可选）</span></label>';
      s+='<textarea class="mb-area" id="srcPrompt_'+idx+'_'+si+'" style="min-height:60px" placeholder="自定义此监控源的分析提示词...">'+escHtml(src.customPrompt||'')+'</textarea>';
      s+='</div>';
      s+='</div>';
    });
    s+='<button class="btn-add-src" onclick="addSource('+idx+')" style="width:100%;margin-top:8px;padding:10px;border:1px dashed #d1d5db;border-radius:9px;background:none;color:#6366f1;cursor:pointer;font-size:13px;font-weight:600">+ 添加监控源</button>';
  }else{
    s='<div class="placeholder"><div class="ph-icon">\U0001f6f0\ufe0f</div><p class="ph-text">暂无监控源配置。<br>点击下方按钮添加监控源。</p></div>';
    s+='<button class="btn-add-src" onclick="addSource('+idx+')" style="width:100%;margin-top:16px;padding:10px;border:1px dashed #d1d5db;border-radius:9px;background:none;color:#6366f1;cursor:pointer;font-size:13px;font-weight:600">+ 添加监控源</button>';
  }
  $('modalBody').innerHTML=s;
  $('modalBody').scrollTop=0;
}


/* ===== MONITOR HELPERS ===== */
function escHtml(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function addSource(idx){
  var w=WIDGETS[idx];
  if(!w||w.type!=='monitor')return;
  if(!w.sources)w.sources=[];
  w.sources.push({name:'',aiProvider:'deepseek',aiModel:'',apiKey:'',keywords:[],updateFrequency:'daily',customPrompt:''});
  renderMonitorForm(idx,w);
}

function deleteSource(idx,si){
  if(!confirm('确定删除这个监控源？'))return;
  var w=WIDGETS[idx];
  if(!w||w.type!=='monitor')return;
  w.sources.splice(si,1);
  renderMonitorForm(idx,w);
}

function addKeyword(idx,si){
  var inp=$('kwInput_'+idx+'_'+si);
  if(!inp)return;
  var kw=inp.value.trim();
  if(!kw)return;
  var w=WIDGETS[idx];
  if(!w||w.type!=='monitor')return;
  if(!w.sources[si].keywords)w.sources[si].keywords=[];
  if(w.sources[si].keywords.indexOf(kw)===-1){
    w.sources[si].keywords.push(kw);
  }
  renderMonitorForm(idx,w);
}

function removeKeyword(idx,si,el){
  var w=WIDGETS[idx];
  if(!w||w.type!=='monitor')return;
  var kwText=el.childNodes[0]?el.childNodes[0].textContent.replace('×','').trim():'';
  var kws=w.sources[si].keywords||[];
  var ki=kws.indexOf(kwText);
  if(ki!==-1)kws.splice(ki,1);
  renderMonitorForm(idx,w);
}

function saveMonitorConfig(idx){
  var w=WIDGETS[idx];
  if(!w||w.type!=='monitor')return;
  var sources=[];
  var srcIndices=[];
  document.querySelectorAll('[id^="srcName_'+idx+'_"]').forEach(function(el){
    var idParts=el.id.split('_');
    srcIndices.push(parseInt(idParts[idParts.length-1]));
  });
  srcIndices.forEach(function(si){
    var name=($('srcName_'+idx+'_'+si)||{}).value||'';
    var provider=($('srcProvider_'+idx+'_'+si)||{}).value||'deepseek';
    var model=($('srcModel_'+idx+'_'+si)||{}).value||'';
    var apiKey=($('srcApiKey_'+idx+'_'+si)||{}).value||'';
    var freq=($('srcFreq_'+idx+'_'+si)||{}).value||'daily';
    var prompt=($('srcPrompt_'+idx+'_'+si)||{}).value||'';
    var keywords=[];
    var kwContainer=$('kwTags_'+idx+'_'+si);
    if(kwContainer){
      kwContainer.querySelectorAll('.kw-t').forEach(function(tag){
        var kwText=tag.childNodes[0]?tag.childNodes[0].textContent.replace('×','').trim():'';
        if(kwText)keywords.push(kwText);
      });
    }
    if(name){
      sources.push({name:name,aiProvider:provider,aiModel:model,apiKey:apiKey,keywords:keywords,updateFrequency:freq,customPrompt:prompt});
    }
  });
  var freq=(sources[0]||{}).updateFrequency||'daily';
  var freqLabel={hourly:'每小时',daily:'每日',weekly:'每周',monthly:'每月'}[freq]||'每日';
  var updatedWidget={type:'monitor',idx:idx,title:w.title,subtitle:sources.length>0?'追踪配置的关键词情报':'暂无监控源配置',sources:sources};
  var slug=window.location.pathname.split('/').pop();
  fetch(API+'/api/p/config/'+slug,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({widgetIdx:idx,widget:updatedWidget})}).then(function(r){
    if(r.ok){
      WIDGETS[idx]=updatedWidget;
      var card=document.querySelectorAll('.c-card')[idx];
      if(card){
        var meta=card.querySelector('.cc-meta');
        if(meta)meta.textContent=(sources.length||0)+' 个监控源 · '+freqLabel;
      }
      closeModalDirect();
    }else{alert('保存失败，请稍后重试');}
  }).catch(function(){alert('网络错误，请稍后重试');});
}

/* ===== FRAMEWORK & PLATFORM ===== */
function onFrameworkChange(idx){
  updatePrompt(idx);
}

function updatePrompt(idx){
  var container=$('mfFrameworks_'+idx);
  if(!container)return;
  var methods='',hasStock=false;
  container.querySelectorAll('input[type=checkbox]:checked').forEach(function(cb){
    if(cb.value==='STOCK')hasStock=true;
    else{methods+=METHOD_NAMES[cb.value]+'、'}
  });
  methods=methods.replace(/、$/,'');
  var up=$('mfUserPrompt_'+idx);
  if(!up)return;
  var v=up.value;
  var lines=v.split('\\n'),result=[];
  for(var i=0;i<lines.length;i++){
    var l=lines[i];
    if(l.indexOf('请使用以下分析框架')===0)continue;
    if(l.indexOf('结合公司最新的年报/季报')!=-1)continue;
    result.push(l);
  }
  v=result.join('\\n').trim();
  var extra='';
  if(methods)extra+='\\n\\n请使用以下分析框架进行分析：'+methods+'。';
  if(hasStock)extra+='\\n\\n结合公司最新的年报/季报，预测公司股价未来12个月的走势。';
  up.value=v+extra;
}

function onPlatformChange(idx){
  var p=$('mfPlatform_'+idx);
  if(!p)return;
  var ep=$('mfEndpoint_'+idx);
  if(ep)ep.style.display=p.value==='custom'?'block':'none';
  if(p.value==='metaso'){
    var key=$('mfApiKey_'+idx);
    if(key&&!key.value)key.value='mk-65F31E31CBAB4DD4697CF57DA49000CB';
  }
}

function toggleApiKeyEye(idx){
  var inp=$('mfApiKey_'+idx),eye=$('mfApiKeyEye_'+idx);
  if(!inp||!eye)return;
  if(inp.type==='password'){
    inp.type='text';
    eye.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.9 9.9a3 3 0 1 0 4.2 4.2"/><path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13 13 0 0 1-1.7 2.7"/><path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
  }else{
    inp.type='password';
    eye.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  }
}

/* ===== STREAMING ===== */
async function* _s(url,body){
  var r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw new Error('HTTP '+r.status);
  var rd=r.body.getReader(),dc=new TextDecoder(),buf='';
  try{while(true){var nxt=await rd.read();if(nxt.done)break;buf+=dc.decode(nxt.value,{stream:true});var ls=buf.split('\\n');buf=ls.pop()||'';for(var l of ls){if(!l.startsWith('data: '))continue;var js=l.slice(6).trim();if(!js||js==='{}')continue;try{yield JSON.parse(js)}catch(e){}}}}
  finally{rd.releaseLock()}
}

/* ===== ANALYSIS ===== */
async function startAnalysis(idx){
  var n=$('mfCompany_'+idx);
  if(!n)return;
  n=n.value.trim();if(!n)return;
  var sp=$('mfPlatform_'+idx);sp=sp?sp.value:'';
  var sak=$('mfApiKey_'+idx);sak=sak?sak.value.trim():'';
  var se=$('mfEndpoint_'+idx);se=se?se.value.trim():'';
  var sprompt=$('mfSysPrompt_'+idx);sprompt=sprompt?sprompt.value.trim():'';
  var uprompt=$('mfUserPrompt_'+idx);uprompt=uprompt?uprompt.value.trim():'';
  var fwContainer=$('mfFrameworks_'+idx);
  var methods=[];
  if(fwContainer){fwContainer.querySelectorAll('input[type=checkbox]:checked').forEach(function(c){methods.push(c.value)})}
  if(methods.length===0)methods=['SWOT','PEST'];
  methods=methods.filter(function(m){return m!=='STOCK'});
  if(methods.length===0)methods=['SWOT','PEST'];
  var slug=window.location.pathname.split('/').pop();
  
  $('modalBody').innerHTML=
    '<h3 style="font-size:15px;font-weight:600;margin-bottom:6px;color:${textClr}">正在搜索行业信息</h3>'+
    '<p style="font-size:13px;margin-bottom:16px;color:${mutedClr}">'+n+'</p>'+
    '<div class="progress-section"><div class="progress-label"><span>搜索进度</span><span id="sp_'+idx+'">0%</span></div>'+
    '<div class="progress-bar"><div class="progress-fill" id="sbar_'+idx+'" style="width:0%"></div></div>'+
    '<div class="stage-text" id="stxt_'+idx+'" style="display:none"><div class="spinner"></div><span id="smsg_'+idx+'"></span></div></div>';
  $('modalBody').scrollTop=0;
  
  try{
    var rt='';
    for await(var ev of _s(API+'/api/p/research/'+slug,{companyName:n,businessDesc:'',analysisMethods:methods,perspective:'investor',searchPlatform:sp,searchApiKey:sak,searchEndpoint:se,sysPrompt:sprompt,userPrompt:uprompt})){
      if(ev.type==='progress_update'){$('sp_'+idx).textContent=ev.percent+'%';$('sbar_'+idx).style.width=ev.percent+'%'}
      else if(ev.type==='stage'){$('stxt_'+idx).style.display='flex';$('smsg_'+idx).textContent=ev.text}
      else if(ev.type==='research_complete'){rt=ev.data||''}
      else if(ev.type==='error'){throw new Error(ev.message||'搜索失败')}
    }
    
    $('modalBody').innerHTML=
      '<h3 style="font-size:15px;font-weight:600;margin-bottom:6px;color:${textClr}">正在生成深度分析报告</h3>'+
      '<p style="font-size:13px;margin-bottom:16px;color:${mutedClr}">'+n+'</p>'+
      '<div class="progress-section"><div class="progress-label"><span>报告进度</span><span id="rp_'+idx+'">0%</span></div>'+
      '<div class="progress-bar"><div class="progress-fill" id="rbar_'+idx+'" style="width:0%"></div></div>'+
      '<div class="stage-text" id="rtxt_'+idx+'" style="display:none"><div class="spinner"></div><span id="rmsg_'+idx+'"></span></div></div>';
    $('modalBody').scrollTop=0;
    
    var url='';
    for await(var ev of _s(API+'/api/p/report/'+slug,{formData:{companyName:n,businessDesc:'',analysisMethods:methods,perspective:'investor'},researchData:rt,sysPrompt:sprompt,userPrompt:uprompt})){
      if(ev.type==='progress_update'){$('rp_'+idx).textContent=ev.percent+'%';$('rbar_'+idx).style.width=ev.percent+'%'}
      else if(ev.type==='stage'){$('rtxt_'+idx).style.display='flex';$('rmsg_'+idx).textContent=ev.text}
      else if(ev.type==='report_complete'){url=ev.url||''}
      else if(ev.type==='error'){throw new Error(ev.message||'生成失败')}
    }
    
    if(url){
      var lu=window.location.origin+url;
      $('modalBody').innerHTML=
        '<div class="result-card"><h3>✅ 报告生成成功!</h3>'+
        '<p style="font-size:13px;margin-bottom:4px;color:${mutedClr}">'+n+' 行业分析报告</p>'+
        '<div class="url-box"><a href="'+lu+'" target="_blank" rel="noopener">'+lu+'</a>'+
        '<button onclick="copyUrlModal()" style="flex-shrink:0;padding:4px 10px;font-size:12px;background:#6366f1;color:#fff;border:none;border-radius:6px;cursor:pointer">复制</button></div></div>'+
        '<div id="modalReportList_'+idx+'" style="margin-top:16px"><p style="font-size:13px;text-align:center;color:${mutedClr}">加载报告列表...</p></div>';
      loadReports(idx);
    }else throw new Error('未获取到链接');
  }catch(e){
    $('modalBody').innerHTML=
      '<div class="error-box">❌ 错误: '+e.message+'</div>'+
      '<button class="btn" onclick="openModal('+idx+')">返回重试</button>';
    $('modalBody').scrollTop=0;
  }
}

function copyUrlModal(){
  var links=$('modalBody').querySelectorAll('a');
  if(links.length>0){
    navigator.clipboard.writeText(links[0].textContent||'');
    var btns=$('modalBody').querySelectorAll('button');
    btns.forEach(function(b){
      if(b.textContent==='复制'){b.textContent='已复制';setTimeout(function(){b.textContent='复制'},2000)}
    });
  }
}

/* ===== REPORTS ===== */
async function loadReports(idx){
  var slug=window.location.pathname.split('/').pop();
  try{
    var r=await fetch(API+'/api/p/reports/'+slug);
    if(!r.ok){renderReportList(idx,[]);return}
    var reports=await r.json();
    renderReportList(idx,reports.data||[]);
  }catch(e){renderReportList(idx,[])}
}

function renderReportList(idx,reports){
  var html='<h4 style="font-size:13px;font-weight:600;margin-bottom:10px;color:${textClr}">最近生成的报告 ('+reports.length+')</h4>';
  if(reports.length>0){
    reports.slice(0,20).forEach(function(report){
      var d=new Date(report.createdAt).toLocaleString('zh-CN');
      html+='<div class="report-item"><div style="flex:1"><div class="rname">'+(report.companyName||'未知')+'</div><div class="rdate">'+d+'</div></div><a href="'+report.url+'" target="_blank" style="color:${reportAccent};border:1px solid ${reportAccent}33">查看</a><button onclick="deleteReport('+idx+',\\''+(report.slug||'').replace(/'/g,'\\x27')+'\\')" style="border:1px solid rgba(226,75,74,.3);background:none;color:#e24b4a;cursor:pointer">删除</button></div>';
    });
  }else{
    html+='<p style="font-size:13px;text-align:center;color:${mutedClr}">暂无报告，开始分析后这里会显示。</p>';
  }
  var container=$('modalReportList_'+idx);
  if(container)container.innerHTML=html;
  // Update main card count
  var cnt=$('reportCardCount');
  if(cnt)cnt.textContent=reports.length+' 份';
}

async function deleteReport(idx,rSlug){
  if(!confirm('确定删除这个报告？'))return;
  var slug=window.location.pathname.split('/').pop();
  try{
    var r=await fetch(API+'/api/p/reports/'+slug+'/'+rSlug,{method:'DELETE'});
    if(!r.ok){alert('删除失败');return}
    loadReports(idx);
  }catch(e){alert('删除失败')}
}

/* ===== INIT ===== */
REPORT_INDICES.forEach(function(idx){
  setTimeout(function(){loadReports(idx)},100);
});
// Load report count for my reports card
setTimeout(function(){loadRecentReportCount()},200);

/* ===== REPORT LIST MODAL ===== */
var CURRENT_REPORTS=[];

function openReportList(){
  var overlay=$('modalOverlay'),panel=$('modalPanel');
  overlay.classList.add('open');
  panel.className='modal-panel type-reports';
  $('modalIcon').innerHTML='📋';
  $('modalTitle').textContent='我的报告';
  $('modalSub').textContent='查看和管理所有生成的行业分析报告';
  $('modalFooter').innerHTML='<button class="btn-cancel" onclick="closeModalDirect()">关闭</button>';
  $('modalBody').innerHTML='<p style="font-size:13px;text-align:center;color:${mutedClr}">加载报告列表中...</p>';
  var slug=window.location.pathname.split('/').pop();
  fetch(API+'/api/p/reports/'+slug).then(function(r){
    if(!r.ok){renderReportCards([]);return}
    return r.json();
  }).then(function(data){
    renderReportCards(data.data||[]);
  }).catch(function(e){
    renderReportCards([]);
  });
}

function renderReportCards(reports){
  CURRENT_REPORTS=reports;
  if(reports.length===0){
    $('modalBody').innerHTML='<div style="text-align:center;padding:40px 20px"><div style="font-size:40px;margin-bottom:12px">📭</div><p style="font-size:14px;color:${mutedClr}">暂无报告，开始行业分析后这里会显示。</p></div>';
    var cnt=$('reportCardCount');
    if(cnt)cnt.textContent='0 份';
    return;
  }
  var html='<div class="rpt-cards-grid">';
  reports.forEach(function(report){
    var d=new Date(report.createdAt).toLocaleString('zh-CN');
    var company=(report.companyName||'未知').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    var rSlug=(report.slug||'').replace(/'/g,'\\x27');
    html+='<div class="rpt-card" onclick="window.open(\\''+report.url+'\\',\\'_blank\\')">'+
      '<button class="rpt-delete" onclick="event.stopPropagation();deleteReportCard(\\''+rSlug+'\\')" title="删除报告">&times;</button>'+
      '<div class="rpt-company">'+company+'</div>'+
      '<div class="rpt-date">'+d+'</div>'+
      '<div class="rpt-actions"><span class="rpt-view">查看报告 →</span></div>'+
      '</div>';
  });
  html+='</div>';
  $('modalBody').innerHTML=html;
  var cnt=$('reportCardCount');
  if(cnt)cnt.textContent=reports.length+' 份';
}

async function deleteReportCard(rSlug){
  if(!confirm('确定删除这个报告？'))return;
  var slug=window.location.pathname.split('/').pop();
  try{
    var r=await fetch(API+'/api/p/reports/'+slug+'/'+rSlug,{method:'DELETE'});
    if(!r.ok){alert('删除失败');return}
    var r2=await fetch(API+'/api/p/reports/'+slug);
    var data=await r2.json();
    renderReportCards(data.data||[]);
  }catch(e){alert('删除失败')}
}

function loadRecentReportCount(){
  var slug=window.location.pathname.split('/').pop();
  fetch(API+'/api/p/reports/'+slug).then(function(r){
    if(!r.ok)return;
    return r.json();
  }).then(function(data){
    var cnt=$('reportCardCount');
    if(cnt)cnt.textContent=(data.data||[]).length+' 份';
  }).catch(function(){});
}

/* ===== INTEL FETCH ===== */
var INTEL_FETCHING=false;

async function fetchAllIntel(){
  if(INTEL_FETCHING)return;
  INTEL_FETCHING=true;
  var area=$('intelResultsArea'),results=$('intelResults'),status=$('intelStatus');
  var monitors=WIDGETS.filter(function(w){return w.type==='monitor'});
  if(monitors.length===0){INTEL_FETCHING=false;return}
  area.style.display='block';
  status.innerHTML='<div class="intel-loading"><div class="spinner"></div>正在获取情报数据（并行加速中）...</div>';
  // Collect all source fetch tasks with position info
  var fetchTasks=[];
  for(var mi=0;mi<monitors.length;mi++){
    var mw=monitors[mi];
    if(!mw.sources||mw.sources.length===0)continue;
    for(var si=0;si<mw.sources.length;si++){
      var src=mw.sources[si];
      fetchTasks.push({
        mi:mi,si:si,mw:mw,src:src,
        fl:src.updateFrequency==='realtime'?'实时':src.updateFrequency==='daily'?'每日':'每周'
      });
    }
  }
  if(fetchTasks.length===0){INTEL_FETCHING=false;results.innerHTML='<div class="intel-empty">暂无监控源</div>';return}
  // Fetch all sources concurrently in chunks of 3 (parallel acceleration)
  var allResults=[];
  for(var i=0;i<fetchTasks.length;i+=3){
    var chunk=fetchTasks.slice(i,i+3);
    var chunkResults=await Promise.all(chunk.map(function(task,chunkIdx){
      return fetchSourceIntel(task.src).then(function(data){
        return {ok:true,data:data,idx:i+chunkIdx};
      }).catch(function(e){
        return {ok:false,error:e.message,idx:i+chunkIdx};
      });
    }));
    allResults=allResults.concat(chunkResults);
  }
  // Sort by original index and build HTML in order
  allResults.sort(function(a,b){return a.idx-b.idx});
  var allHtml='';
  var currentMi=-1;
  for(var j=0;j<allResults.length;j++){
    var task=fetchTasks[j];
    if(task.mi!==currentMi){
      if(currentMi>=0)allHtml+='</div>';
      currentMi=task.mi;
      allHtml+='<div class="intel-src-group"><h3 class="isg-title">🛰️ '+task.mw.title+'</h3>';
    }
    allHtml+='<div class="intel-src-block"><div class="intel-src-title"><span class="isdot"></span>'+task.src.name+'<span class="isfreq"> · '+task.fl+'更新 · '+(task.src.aiModel||'默认')+'</span></div>';
    if(allResults[j].ok&&allResults[j].data&&allResults[j].data.length>0){
      allHtml+=renderIntelItems(allResults[j].data);
    }else if(allResults[j].ok){
      allHtml+='<div class="intel-empty">暂无情报数据</div>';
    }else{
      allHtml+='<div class="intel-error">获取失败: '+allResults[j].error+'</div>';
    }
    allHtml+='</div>';
  }
  if(currentMi>=0)allHtml+='</div>';
  results.innerHTML=allHtml;
  status.innerHTML='';
  INTEL_FETCHING=false;
}

function makeIntelPrompt(keywords,customPrompt){
  var kw=(keywords||[]).join('、');
  var sp=customPrompt||'你是一个专业的情报分析助手。';
  var up='请搜索并整理关于【'+kw+'】的最新资讯，列出最重要的10条。'+
    '要求：1.每条包含标题、摘要(50字内)、来源/时间(如有)。'+
    '2.按重要性排序。3.输出严格JSON数组：[{"title":"","summary":"","source":""}]。'+
    '4.仅输出JSON数组，不要任何其他文字。';
  return {systemPrompt:sp,userPrompt:up};
}

async function fetchSourceIntel(src){
  var prompt=makeIntelPrompt(src.keywords,src.customPrompt);
  var provider=src.aiProvider||'deepseek';
  var apiKey=src.apiKey||(provider==='metaso'?DEFAULT_METASO_KEY:DEFAULT_DEEPSEEK_KEY)||'';
  var _kwArr=Array.isArray(src.keywords)?src.keywords:(typeof src.keywords==='string'?src.keywords.split(/[,，、]/).map(function(s){return s.trim()}).filter(Boolean):[]);
  var model=src.aiModel||'deepseek-v4-flash';
  if(!apiKey)throw new Error('未配置API Key');
  if(provider==='metaso'){
    var apiUrl='https://metaso.cn/api/open/search/v2';
    var msResponse=await fetch(apiUrl,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
      body:JSON.stringify({question:_kwArr.join(' OR '),lang:'zh'})
    });
    if(!msResponse.ok){var msErr=await msResponse.text();throw new Error('秘塔API错误: '+msResponse.status+' '+msErr.substring(0,200))}
    var msData=await msResponse.json();
    var rawData=(msData.data&&msData.data.references)?msData.data.references:(msData.data||msData.results||msData.items||[]);
    var results=Array.isArray(rawData)?rawData:(rawData.results||rawData.items||rawData.references||[rawData]);
    return results.slice(0,10).map(function(r){return{title:r.title||r.name||'',summary:r.snippet||r.summary||r.content||r.aiSummary||'',source:r.url||r.link||r.source||'秘塔搜索',date:r.date||r.publishedAt||r.publishTime||'',link:r.url||r.link||''};});
  } else {
    var apiUrl='https://api.deepseek.com/chat/completions';
    var response=await fetch(apiUrl,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
      body:JSON.stringify({model:model,messages:[{role:'system',content:prompt.systemPrompt},{role:'user',content:prompt.userPrompt}],max_tokens:4096,temperature:0.7})
    });
    if(!response.ok){var err=await response.text();throw new Error('API错误: '+response.status)}
    var data=await response.json();
    var content=data.choices[0].message.content;
    content=content.replace('\`\`\`json','').replace(/\`\`\`/g,'').trim();
    try{return JSON.parse(content)}
    catch(e){
      var match=content.match(/\\[\\s*(?:\\{[\\s\\S]*?\\}|\\[[\\s\\S]*?\\])+\\s*\\]/);
      if(match)return JSON.parse(match[0]);
      throw new Error('无法解析AI返回数据');
    }
  }
}

function renderIntelItems(items){
  var html='<div class="intel-items">';
  for(var i=0;i<Math.min(items.length,10);i++){
    var item=items[i];
    var itemId='intel-'+i+'-'+Date.now();
    html+='<div class="intel-item" onclick="toggleIntelDetail(this,\\x27'+itemId+'\\x27)" style="cursor:pointer">';
    html+='<div class="inum">'+(i+1)+'</div><div class="ibody">';
    html+='<div class="ititle">'+(item.title||'')+'</div>';
    if(item.summary)html+='<div class="isummary">'+item.summary+'</div>';
    if(item.link){
      html+='<a class="isource" href="'+item.link+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">📎 '+((item.source||item.link||'').replace(/^https?:\\/\\//,''))+'</a>';
    }else if(item.source){
      html+='<div class="isource">📎 '+item.source+'</div>';
    }
    if(item.date)html+='<div class="idate" style="font-size:10px;color:#888;margin-top:2px">🕐 '+item.date+'</div>';
    if(item.summary){
      html+='<div class="intel-detail" id="'+itemId+'" style="display:none;margin-top:6px;padding:10px;background:#f8fafc;border-radius:6px;border:1px solid #e5e7eb">';
      html+='<div style="font-size:12px;line-height:1.7">'+item.summary+'</div>';
      html+='</div>';
    }
    html+='</div></div>';
  }
  html+='</div>';
  return html;
}

function toggleIntelDetail(el,detailId){
  var detail=document.getElementById(detailId);
  if(!detail)return;
  var numEl=el.querySelector(".inum");
  if(detail.style.display==="none"||!detail.style.display){
    detail.style.display="block";
    if(numEl)numEl.textContent="▼";
    el.style.borderColor="var(--primary,#2563eb)";
  } else {
    detail.style.display="none";
    if(numEl)numEl.textContent=numEl.textContent==="▼"?"▶":numEl.textContent;
    el.style.borderColor="";
  }
}

(function(){
  var monitors=WIDGETS.filter(function(w){return w.type==='monitor'});
  if(monitors.length>0){setTimeout(function(){fetchAllIntel()},500)}
})();

</script>
</body>
</html>`;
}


// ========== Report HTML Generator ==========
function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function generateReportHtml(companyName: string): Promise<string> {
  const prompt = `你是一位顶级的行业研究分析师兼网页设计师。你精通财务建模、数据可视化和现代 CSS 设计。

用户输入的公司名是: "${companyName}"

请生成一份精美专业的 HTML 行业分析报告页面。风格参考麦肯锡/高盛出品的研究报告。

## ⚠️ 输出铁律（最高优先级，违反即失败）
1. 只输出纯 HTML 代码。禁止 \`\`\`html 或任何 markdown 包裹
2. 第一个字符必须是 <，最后一个字符必须是 >
3. 不输出任何解释、描述、文件路径、摘要
4. 所有 CSS 必须内嵌在单个 <style> 标签中
5. 零外部依赖（CDN/字体/图片/JS库）

## 🎨 设计系统

### 色彩
- 主渐变: linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #6366f1 100%)
- 主色: #2563eb | 强调紫: #7c3aed | 成功绿: #059669 | 警示红: #dc2626 | 警告橙: #d97706
- 页面背景: #f1f5f9 | 卡片背景: #ffffff | 正文: #1e293b | 辅助文: #64748b
- 浅色边框: #e2e8f0

### 排版
- 字体栈: font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif
- h1: 32px / 800 / letter-spacing:-0.5px / 渐变色 background-clip:text
- h2: 22px / 700 / color:#0f172a / 左侧蓝色竖线装饰 (border-left:4px solid #2563eb; padding-left:16px)
- h3: 17px / 600 / color:#1e293b
- 正文: 15px / line-height:1.8 / color:#334155
- 小字: 13px / color:#64748b

### 全局 CSS（必须包含）
\`\`\`css
* { margin:0; padding:0; box-sizing:border-box }
html { scroll-behavior:smooth }
body { font-family: -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif; background:#f1f5f9; color:#334155; line-height:1.8; -webkit-font-smoothing:antialiased }
.container { max-width:960px; margin:0 auto; padding:0 24px }
\`\`\`

---

## 📐 页面结构（按以下顺序，每个 section 用白色卡片包裹）

### ① Header — 顶部横幅
- 背景: linear-gradient(135deg, #1e40af 0%, #3b82f6 40%, #6366f1 100%)
- 叠加光晕: radial-gradient(ellipse at 30% 50%, rgba(255,255,255,0.08) 0%, transparent 60%)
- padding: 64px 24px 56px; text-align:center; position:relative; overflow:hidden
- h1: 颜色 #ffffff; 字号 34px; font-weight:800; text-shadow:0 2px 8px rgba(0,0,0,0.15)
- 副标题行: 公司名称 · 生成日期, color:rgba(255,255,255,0.85), 字号 16px
- 底部装饰: 使用 border-bottom 或伪元素分割线

### ② Section 卡片容器
每个分析区块包裹在 .section-card 中：
\`\`\`css
.section-card { background:#fff; border-radius:16px; padding:36px 32px; margin-bottom:32px; box-shadow:0 1px 3px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.03); border:1px solid #f1f5f9 }
\`\`\`

### ③ 公司概览
- h2 标题 + 2-3段分析文字
- 关键数据用 <strong> 加粗高亮

### ④ 市场规模与趋势
- 行业规模描述 + 增长率数据
- 如有数据对比，使用表格

### ⑤ 财务分析
- 必须包含至少 1 个 data-table（财务指标表格，3 年以上数据）
- 关键指标分析文字

### ⑥ 竞争格局
- 主要竞争对手表格（公司/市场份额/优势）
- 竞争态势文字总结

### ⑦ SWOT 分析 — 2x2 彩色卡片网格
\`\`\`css
.cards-grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin:20px 0 }
.swot-card { border-radius:14px; padding:24px; transition:transform .2s,box-shadow .2s }
.swot-card:hover { transform:translateY(-3px); box-shadow:0 12px 28px rgba(0,0,0,0.1) }
.swot-card h4 { font-size:16px; font-weight:700; margin-bottom:14px; padding-bottom:10px; border-bottom:2px solid rgba(0,0,0,0.06) }
.swot-card ul { padding-left:18px; margin:0 }
.swot-card li { margin-bottom:8px; line-height:1.7; font-size:14px; color:#475569 }
/* S-优势 */ .card-s { border-top:4px solid #059669; background:#ecfdf5 }
.card-s h4 { color:#059669 }
/* W-劣势 */ .card-w { border-top:4px solid #dc2626; background:#fef2f2 }
.card-w h4 { color:#dc2626 }
/* O-机会 */ .card-o { border-top:4px solid #2563eb; background:#eff6ff }
.card-o h4 { color:#2563eb }
/* T-威胁 */ .card-t { border-top:4px solid #d97706; background:#fffbeb }
.card-t h4 { color:#d97706 }
\`\`\`

### ⑧ PEST 分析 — 2x2 彩色卡片网格
样式同 SWOT，四个维度各不同顶部 accent 色：
- P-政治: #7c3aed(紫) | E-经济: #2563eb(蓝) | S-社会: #059669(绿) | T-技术: #d97706(橙)
- 每个对应的浅色背景

### ⑨ 行业展望与建议
- 3-5 条编号要点，每条带 emoji 图标前缀
- 未来趋势预测 + 投资建议

### ⑩ Footer
- 深色背景 (#0f172a)，白色文字
- padding:32px 24px; text-align:center; font-size:13px; color:#94a3b8
- 内容: "由 YooClaw AI 生成 · {日期}" + 品牌标识

---

## 📊 表格样式规范（必须严格遵守）

\`\`\`css
.data-table { width:100%; border-collapse:separate; border-spacing:0; border-radius:12px; overflow:hidden; border:1px solid #e2e8f0; font-size:14px; margin:20px 0; box-shadow:0 1px 2px rgba(0,0,0,0.04) }
.data-table thead th { background:linear-gradient(180deg, #1e40af, #2563eb); color:#fff; font-weight:700; padding:14px 18px; text-align:left; font-size:13px; letter-spacing:0.5px }
.data-table thead th:first-child { border-radius:12px 0 0 0 }
.data-table thead th:last-child { border-radius:0 12px 0 0 }
.data-table tbody td { padding:13px 18px; border-bottom:1px solid #f1f5f9; color:#334155 }
.data-table tbody tr:last-child td { border-bottom:none }
.data-table tbody tr:nth-child(even) td { background:#f8fafc }
.data-table tbody tr:hover td { background:#eff6ff; transition:background .2s }
.data-table .num { text-align:right; font-variant-numeric:tabular-nums; font-weight:600 }
\`\`\`

---

## 📱 响应式
@media (max-width: 768px) {
  .cards-grid { grid-template-columns: 1fr }
  .section-card { padding: 24px 20px; border-radius: 12px }
  h1 { font-size: 24px }
  .data-table { font-size: 13px }
}

## 🖨️ 打印
@media print {
  body { background:#fff }
  .section-card { box-shadow:none; break-inside:avoid; border:1px solid #e2e8f0 }
  .header { background:#2563eb !important }
}

---

## ✅ HTML 质量自检清单（生成前逐条确认）
1. □ <!DOCTYPE html> 开头
2. □ <meta charset="UTF-8"> 含 charset= 属性
3. □ 所有标签正确闭合（</h2> 不是 h2>）
4. □ CSS 属性格式: 属性名: 值; （冒号+分号完整）
5. □ line-height 无单位（1.6 不是 16px 或 16）
6. □ box-sizing: border-box（不是 -box 或 :box）
7. □ max-width 不使用 0px
8. □ 表格含 thead + tbody
9. □ 无 markdown 包裹（无 \`\`\` 符号）

请直接输出完整的 HTML 代码。记住：你输出的第一个字符必须是 <。`;

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
const prompt = `你是一个 HTML 游戏代码生成器，不是对话机器人。你的唯一任务是输出完整的游戏 HTML 代码。

用户想玩的游戏是: "${gameName}"

请生成一个完整的、可直接运行的 HTML 游戏页面。

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
8. 游戏页面打开后直接显示游戏界面（而非摘要或介绍页），用户点击链接后可以立即开始游戏
9. 游戏内可以有"开始"按钮或覆盖层来开始游戏（这是正常的游戏交互，不是摘要页）

## ⚠️ 关键禁止项

以下行为严禁发生:
- 绝对禁止输出任何中文说明文字，例如"已生成游戏文件"、"功能包括"、"直接在浏览器中打开"
- 绝对禁止输出文件路径（如 /opt/YooClaw/...）
- 你的回答第一个字符必须是 <
- 你的回答必须以 </html> 结束

你是一个代码生成器，不是对话助手。不要描述、解释或总结任何内容，直接输出 HTML 游戏代码。`;

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
        { role: 'system', content: '你是 YooClaw 游戏代码生成器。你只能输出纯 HTML 代码，第一个字符必须是<。禁止输出任何中文文字、说明、文件路径、摘要或描述。你不是对话助手，你是一个代码输出机器。' },
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
   - ${methods.includes('SWOT') ? 'SWOT 分析 — 用 HTML table 呈现，表格带边框(border:1px solid #d1d5db)、单元格内边距(padding:10px 14px)、表头背景色(#f8fafc)、文字自动换行(word-break:break-all)、表格宽度100%' : ''}
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
const gamePrompt = `你是一个 HTML 游戏代码生成器，不是对话机器人。你的唯一任务是输出完整的游戏 HTML 代码。

用户想玩的游戏是: "${gameName}"

请生成一个完整的、可直接运行的 HTML 游戏页面。

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
8. 游戏页面打开后直接显示游戏界面（而非摘要或介绍页），用户点击链接后可以立即开始游戏
9. 游戏内可以有"开始"按钮或覆盖层来开始游戏（这是正常的游戏交互，不是摘要页）

## ⚠️ 关键禁止项

以下行为严禁发生:
- 绝对禁止输出任何中文说明文字，例如"已生成游戏文件"、"功能包括"、"直接在浏览器中打开"
- 绝对禁止输出文件路径（如 /opt/YooClaw/...）
- 你的回答第一个字符必须是 <
- 你的回答必须以 </html> 结束

你是一个代码生成器，不是对话助手。不要描述、解释或总结任何内容，直接输出 HTML 游戏代码。`;
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
            { role: 'system', content: '你是 YooClaw 游戏代码生成器。你只能输出纯 HTML 代码，第一个字符必须是<。禁止输出任何中文文字、说明、文件路径、摘要或描述。你不是对话助手，你是一个代码输出机器。' },
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
    const { siteName, siteDesc, template, slug: customSlug, customDomain } = req.body || {};

    if (!siteName || typeof siteName !== 'string' || !siteName.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Site name is required' } });
    }

    const name = siteName.trim();
    const slug = customSlug || generateSlug(name);

    console.log(`[Portal] User:${userId} Deploying "${name}" (slug: ${slug}, template: ${template})`);

    const apiBase = process.env.FRONTEND_URL
      || (req.get('host') ? `https://${req.get('host')}` : null)
      || `http://localhost:${APP_PORT}`;

    const htmlContent = generatePortalHtml(name, siteDesc || '', template || 'intel-station', apiBase, slug, req.body.widgets);
    const site = await createReportSite(userId, slug, name, name, htmlContent, 'portal', customDomain || '');

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

// Re-deploy an existing portal (regenerates HTML from latest code)
app.post('/api/v1/sites/portal/redeploy', authMiddleware, async (req, res) => {
  try {
    const { userId } = (req as any).user as JwtPayload;
    const { slug, customDomain } = req.body || {};

    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Slug is required' } });
    }

    const existing = await getReportSiteBySlug(slug, 'portal');
    if (!existing || existing.user_id !== userId) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Portal not found' } });
    }

    console.log(`[Portal] User:${userId} Re-deploying portal "${existing.title}" (slug: ${slug})`);

    const apiBase = process.env.FRONTEND_URL
      || (req.get('host') ? `https://${req.get('host')}` : null)
      || `http://localhost:${APP_PORT}`;

    // Auto-extract widgets from existing HTML if not provided (for batch redeploy)
    let widgets: any[] = req.body.widgets || [];
    if (widgets.length === 0) {
      try {
        const match = existing.html_content.match(/var WIDGETS=(\[[\s\S]*?\]);/);
        if (match) { widgets = JSON.parse(match[1]); }
      } catch (e) { /* keep empty */ }
    }
    const htmlContent = generatePortalHtml(existing.title, '', 'intel-station', apiBase, slug, widgets);
    const cd = customDomain || (existing as any).custom_domain || '';
    await createReportSite(userId, slug, existing.title, existing.title, htmlContent, 'portal', cd);

    res.json({
      data: {
        id: existing.id,
        slug: slug,
        title: existing.title,
        url: `/p/${slug}`,
        updated: true,
      },
    });
  } catch (err: any) {
    console.error('[Portal Redeploy Error]', err.message);
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
    // Prevent browser caching of dynamic portal pages
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
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
    const systemMsg = sysPrompt || `你是 YooClaw AI 助手，专门生成专业美观的行业分析报告 HTML 页面。你只输出纯 HTML 代码，不要包含任何 markdown 标记或额外说明文字。`;
    const defaultPrompt = `请研究以下公司：${name}${businessDesc ? `（${businessDesc}）` : ''}
${searchResults || '\n请使用你的知识储备进行回答。'}
请用完整的 HTML 格式输出行业研究报告，包含以下章节（用 <h2> 标题和 <p>/<ul>/<table> 等 HTML 标签）：

<h2>公司概况</h2>
<h2>市场规模与趋势</h2>
<h2>财务与经营分析</h2>
<h2>竞争格局</h2>
<h2>近期动态</h2>
<h2>机遇与挑战</h2>

要求：
- 每个章节用 <h2> 标题，内容用 <p> 段落和 <ul>/<li> 列表
- 关键数字用 <strong>加粗</strong>
- 包含具体数据，每个章节不少于 3 个要点
- 只输出纯 HTML 代码，不要 markdown 标记，不要额外说明文字`;
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

    // 明确检查：如果 AI 返回为空，直接发 error
    if (fullText.length === 0) {
      console.error('[PubResearch] AI returned empty content for', name);
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'AI 未返回内容，请稍后重试（可能是网络超时）' })}\n\n`);
      res.end();
      return;
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
    const defaultReportPrompt = `我正在研究"${name}"，请根据以下研究资料，用 HTML 格式撰写一份完整的行业分析报告。

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

请用 HTML 格式输出，包含完整的 HTML 页面结构。`
      : defaultReportPrompt;
    const reportSysMsg = `You are an HTML code generator. You are NOT a conversational assistant. Your ONLY job is to output raw HTML code.

STRICT RULES:
1. Your VERY FIRST character of output MUST be '<' (start of HTML tag)
2. DO NOT output any text descriptions, explanations, or summaries
3. DO NOT say things like "报告已更新保存至..." or "Here is the report..."
4. DO NOT use markdown code blocks (no \`\`\`)
5. ONLY output raw HTML code starting with <!DOCTYPE html>
6. NO conversational text before, during, or after the HTML code

WRONG (DO NOT DO THIS):
"报告已生成，保存至 /path/to/file.html"
"以下是报告内容："
\`\`\`html
<html>...
\`\`\`

RIGHT (DO THIS):
<!DOCTYPE html>
<html>
...

Remember: You are a code generator, not a chat assistant. Output ONLY HTML code.`;
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

    // 明确检查：如果 AI 返回为空，直接发 error，避免"未获取到链接"
    if (fullHtml.length === 0) {
      console.error('[PubReport] AI returned empty content for', name);
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'AI 未返回内容，请稍后重试（可能是网络超时）' })}\n\n`);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({ type: 'progress_update', percent: 100 })}\n\n`);

    // 如果 AI 返回了非 HTML 内容（markdown/纯文本），先转换为 HTML 再交给 cleanAiHtml
    let preProcessed = fullHtml;
    if (fullHtml.length > 0 && !/<[a-zA-Z]/.test(fullHtml)) {
      console.log(`[PubReport] 未检测到 HTML 标签，先将 markdown 转为 HTML...`);
      preProcessed = markdownToHtml(fullHtml, name);
    }

    const finalHtml = cleanAiHtml(preProcessed, `${name} - 行业分析报告`);
    
    // 如果 AI 返回 text/markdown instead of HTML, wrap in a professional page
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


// Portal Intel API - fetch intelligence data from sources (server-side)
const portalIntelCache = new Map<string, { data: any; expiry: number }>();
const PORTAL_INTEL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes (was 5 min)
const PORTAL_INTEL_CACHE_FILE = path.join(__dirname, '..', 'cache', 'portal-intel-cache.json');

// Load persisted cache from file on startup
function loadPortalIntelCache() {
  try {
    if (fs.existsSync(PORTAL_INTEL_CACHE_FILE)) {
      const raw = fs.readFileSync(PORTAL_INTEL_CACHE_FILE, 'utf-8');
      const entries = JSON.parse(raw);
      const now = Date.now();
      let loaded = 0;
      const entriesArr = Array.isArray(entries) ? entries : [];
      entriesArr.forEach((entry: any) => {
        if (entry.expiry > now) {
          portalIntelCache.set(entry.key, { data: entry.data, expiry: entry.expiry });
          loaded++;
        }
      });
      console.log(`[PortalIntelCache] Loaded ${loaded} entries from file (${entriesArr.length} total, ${entriesArr.length - loaded} expired)`);
    }
  } catch (err: any) {
    console.warn('[PortalIntelCache] Failed to load from file:', err.message);
  }
}

// Persist cache to file (async save via setTimeout to not block)
function savePortalIntelCache() {
  try {
    const dir = path.dirname(PORTAL_INTEL_CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const entries: any[] = [];
    portalIntelCache.forEach((value, key) => {
      entries.push({ key, data: value.data, expiry: value.expiry });
    });
    fs.writeFileSync(PORTAL_INTEL_CACHE_FILE, JSON.stringify(entries), 'utf-8');
  } catch (err: any) {
    console.warn('[PortalIntelCache] Failed to save to file:', err.message);
  }
}

// ========== Shared: Core AI Intel Fetcher (used by both endpoint & cache warmer) ==========
// Fetches intelligence data from Metaso or DeepSeek API for a single source.
// Returns array of intel items [{title, summary, source, date, link}].
// Does NOT handle caching — caller is responsible for cache management.
async function fetchIntelForSource(src: any): Promise<any[]> {
  const kwArr = Array.isArray(src.keywords)
    ? src.keywords
    : (typeof src.keywords === 'string' ? src.keywords.split(/[,，、]/).map((s: string) => s.trim()).filter(Boolean) : []);
  const kw = kwArr.join('、');
  const sp = src.customPrompt || '你是一个专业的情报分析助手。';
  const up = '请搜索并整理关于【' + kw + '】的最新资讯，列出最重要的10条。' +
    '要求：1.每条包含标题、摘要(50字内)、来源/时间(如有)、url(原始链接，如有)。' +
    '2.按重要性排序。3.输出严格JSON数组：[{"title":"","summary":"","source":"","url":""}]。' +
    '4.如果无法提供真实url，url字段留空字符串。5.仅输出JSON数组，不要任何其他文字。';
  const prompt = { systemPrompt: sp, userPrompt: up };
  const provider = src.aiProvider || 'deepseek';
  const apiKey = src.apiKey || (provider === 'metaso' ? process.env.METASO_API_KEY : process.env.DEEPSEEK_API_KEY) || '';
  const model = src.aiModel || 'deepseek-v4-flash';
  if (!apiKey) throw new Error('未配置API Key');

  let results: any[];
  if (provider === 'metaso') {
    const apiUrl = 'https://metaso.cn/api/open/search/v2';
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 25000);
    const response = await fetch(apiUrl, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ question: kwArr.join(' OR '), lang: 'zh' }),
    });
    clearTimeout(to);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error('秘塔API错误: ' + response.status + ' ' + errText.substring(0, 200));
    }
    const data = await response.json();
    const rawData = (data.data && data.data.references) ? data.data.references : (data.data || data.results || data.items || []);
    results = Array.isArray(rawData) ? rawData : (rawData.results || rawData.items || rawData.references || [rawData]);
    results = results.slice(0, 10).map(function (r: any) {
      return {
        title: r.title || r.name || '',
        summary: r.snippet || r.summary || r.content || r.aiSummary || '',
        source: r.url || r.link || r.source || '秘塔搜索',
        date: r.date || r.publishedAt || r.publishTime || '',
        link: r.url || r.link || '',
      };
    });
  } else {
    const apiUrl = 'https://api.deepseek.com/chat/completions';
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 25000);
    const response = await fetch(apiUrl, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model, max_tokens: 4096, temperature: 0.7,
        messages: [
          { role: 'system', content: prompt.systemPrompt },
          { role: 'user', content: prompt.userPrompt },
        ],
      }),
    });
    clearTimeout(to);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error('API错误: ' + response.status);
    }
    const data = await response.json();
    let content = data.choices[0].message.content;
    content = content.replace('```json', '').replace(/```/g, '').trim();
    try {
      results = JSON.parse(content);
    } catch (e) {
      const match = content.match(/\[\s*(?:\{[\s\S]*?\}|\[[\s\S]*?\])+\s*\]/);
      if (match) {
        try { results = JSON.parse(match[0]); } catch (e2) { results = []; }
      } else {
        throw new Error('无法解析AI返回数据');
      }
    }
    results = (results || []).map(function (r: any) {
      return {
        title: r.title || '',
        summary: r.summary || '',
        source: r.source || '',
        date: r.date || r.time || '',
        link: r.url || r.link || 'https://www.baidu.com/s?wd=' + encodeURIComponent(r.title || ''),
      };
    });
  }
  return results;
}

// ========== POST /api/portal-intel ==========
// Returns intelligence data for requested sources. Uses 30-min in-memory cache.
app.post('/api/portal-intel', async (req, res) => {
  try {
    const { sources } = req.body || {};
    if (!Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({ error: 'sources array is required' });
    }

    const results: any[] = [];
    const now = Date.now();

    const processSource = async (src: any, idx: number) => {
      const cacheKey = JSON.stringify({ name: src.name, keywords: src.keywords, aiProvider: src.aiProvider });
      const cached = portalIntelCache.get(cacheKey);
      if (cached && cached.expiry > now) {
        return { sourceIdx: idx, data: cached.data, fromCache: true };
      }
      try {
        const intelData = await fetchIntelForSource(src);
        portalIntelCache.set(cacheKey, { data: intelData, expiry: now + PORTAL_INTEL_CACHE_TTL });
        setTimeout(() => savePortalIntelCache(), 100);
        return { sourceIdx: idx, data: intelData, fromCache: false };
      } catch (err: any) {
        console.error('[PortalIntel] Source fetch failed:', err.message);
        return { sourceIdx: idx, error: err.message, data: [] };
      }
    };

    // Process in chunks of 3 (concurrency control)
    for (let i = 0; i < sources.length; i += 3) {
      const chunk = sources.slice(i, i + 3).map((src: any, chunkIdx: number) => processSource(src, i + chunkIdx));
      const chunkResults = await Promise.all(chunk);
      results.push(...chunkResults);
    }

    res.json({ success: true, results });
  } catch (err: any) {
    console.error('[PortalIntel Error]', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ========== Background Cache Warmer ==========
// Collects all unique intel sources across all portal sites and pre-warms the cache.
// Runs on startup + every 20 minutes. Uses max 2 concurrent API calls (less aggressive
// than the request-time endpoint which uses 3).
let cacheWarmingActive = false;

async function warmAllPortalCaches() {
  if (cacheWarmingActive) {
    console.log('[CacheWarmer] Already in progress, skipping...');
    return;
  }
  cacheWarmingActive = true;
  try {
    const portalSites = await getAllPortalSites();
    if (portalSites.length === 0) {
      console.log('[CacheWarmer] No portal sites found');
      cacheWarmingActive = false;
      return;
    }

    // Collect unique sources across all portals
    const sourceMap = new Map<string, any>();
    portalSites.forEach((site: any) => {
      const match = site.html_content?.match(/var WIDGETS=(\[[\s\S]*?\]);/);
      if (!match) return;
      try {
        const widgets = JSON.parse(match[1]);
        widgets.forEach((w: any) => {
          if (w.type === 'intel-monitor' || w.type === 'monitor') {
            const sources = w.config?.sources || w.sources || [];
            sources.forEach((src: any) => {
              const cacheKey = JSON.stringify({
                name: src.name,
                keywords: src.keywords,
                aiProvider: src.aiProvider,
              });
              if (!sourceMap.has(cacheKey)) {
                sourceMap.set(cacheKey, src);
              }
            });
          }
        });
      } catch (e) {
        // Skip sites with corrupted WIDGETS JSON
      }
    });

    if (sourceMap.size === 0) {
      console.log('[CacheWarmer] No intel sources found in any portal');
      cacheWarmingActive = false;
      return;
    }

    // Skip already-cached sources
    const now = Date.now();
    const toWarm: { key: string; src: any }[] = [];
    sourceMap.forEach((src, key) => {
      const cached = portalIntelCache.get(key);
      if (!cached || cached.expiry <= now) {
        toWarm.push({ key, src });
      }
    });

    if (toWarm.length === 0) {
      console.log(`[CacheWarmer] All ${sourceMap.size} sources already cached, nothing to warm`);
      cacheWarmingActive = false;
      return;
    }

    console.log(`[CacheWarmer] Warming ${toWarm.length} sources (${sourceMap.size - toWarm.length}/${sourceMap.size} already cached) from ${portalSites.length} portals`);

    // Warm in chunks of 2 (less aggressive than request endpoint's 3)
    let warmed = 0;
    let failed = 0;
    for (let i = 0; i < toWarm.length; i += 2) {
      const chunk = toWarm.slice(i, i + 2);
      const chunkResults = await Promise.allSettled(
        chunk.map(async ({ key, src }) => {
          const intelData = await fetchIntelForSource(src);
          portalIntelCache.set(key, { data: intelData, expiry: Date.now() + PORTAL_INTEL_CACHE_TTL });
          return { key, src, count: intelData.length };
        })
      );
      chunkResults.forEach((r) => {
        if (r.status === 'fulfilled') {
          warmed++;
          console.log(`[CacheWarmer] Warmed: ${r.value.src.name || 'unnamed'} (${r.value.count} items)`);
        } else {
          failed++;
          console.warn(`[CacheWarmer] Failed: ${r.reason?.message || r.reason}`);
        }
      });
    }

    savePortalIntelCache();
    console.log(`[CacheWarmer] Complete. Warmed ${warmed}, failed ${failed}. Total cache entries: ${portalIntelCache.size}`);
  } catch (err: any) {
    console.error('[CacheWarmer] Error:', err.message);
  } finally {
    cacheWarmingActive = false;
  }
}

// AI Chat endpoint for portal AI assistant
// Flow: 1) search web via curl (free, no key) → 2) feed results to DeepSeek → 3) return answer
app.post('/api/ai-chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
    if (!deepseekApiKey) {
      return res.status(500).json({ error: 'AI service not configured' });
    }

    // Step 1: Web search via DuckDuckGo using curl (more reliable than fetch on this server)
    let searchContext = '';
    try {
      const query = encodeURIComponent(message);
      const ddgUrl = 'https://html.duckduckgo.com/html/?q=' + query;
      const curlCmd = `curl -s -m 10 "${ddgUrl}" -H "User-Agent: Mozilla/5.0" -H "Accept-Language: zh-CN"`;
      const { stdout: html, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        exec(curlCmd, { maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      });
      if (html && html.length > 100) {
        // Parse DuckDuckGo HTML results
        const results: { title: string; url: string }[] = [];
        const linkRegex = /<a class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        let match;
        while ((match = linkRegex.exec(html)) !== null && results.length < 6) {
          const rawUrl = decodeURIComponent(match[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, ''));
          const title = match[2].replace(/<[^>]+>/g, '').trim();
          if (title) results.push({ title, url: rawUrl });
        }
        if (results.length === 0) {
          // Try alternate DuckDuckGo result format
          const linkRegex2 = /<a rel="nofollow" class="result__snippet" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
          while ((match = linkRegex2.exec(html)) !== null && results.length < 6) {
            const title = match[2].replace(/<[^>]+>/g, '').trim();
            if (title) results.push({ title, url: match[1] });
          }
        }
        if (results.length > 0) {
          searchContext = '\n\n【网络搜索结果】\n' + results.map((r, i) => `[${i + 1}] ${r.title}\n链接: ${r.url}`).join('\n\n') + '\n';
          console.log(`[AiChat Search] DuckDuckGo returned ${results.length} results`);
        }
      }
    } catch (e: any) {
      console.error('[AiChat Search] DuckDuckGo failed:', e.message);
    }

    // Step 1b: Try Metaso as additional fallback (if key exists and curl available)
    if (!searchContext) {
      const metasoApiKey = process.env.METASO_API_KEY;
      if (metasoApiKey) {
      let tmpFile = '';
        try {
          const jsonBody = JSON.stringify({ question: message, lang: 'zh' });
          tmpFile = `/tmp/metaso_search_${Date.now()}.json`;
          fs.writeFileSync(tmpFile, jsonBody);
          const curlCmd = `curl -s -m 15 -X POST "https://metaso.cn/api/open/search/v2" -H "Content-Type: application/json" -H "Authorization: Bearer ${metasoApiKey}" -d @${tmpFile}`;
          const { stdout: searchJson, stderr: curlStderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            exec(curlCmd, { maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
              if (err) { console.error('[AiChat Search] Curl error:', err.message, curlStderr); reject(err); }
              else resolve({ stdout, stderr });
            });
          });
          console.log('[AiChat Search] Metaso raw response:', searchJson.substring(0, 200));
          const searchData = JSON.parse(searchJson);
          const rawResults = (searchData.data && searchData.data.references) ? searchData.data.references : (searchData.data || []);
          const results = Array.isArray(rawResults) ? rawResults.slice(0, 6) : [];
          if (results.length > 0) {
            searchContext = '\n\n【网络搜索结果】\n' + results.map((r: any, i: number) => {
              const title = r.title || r.name || '';
              const snippet = r.snippet || r.summary || '';
              const url = r.url || r.link || '';
              return `[${i + 1}] ${title}${snippet ? '\n摘要: ' + snippet : ''}\n链接: ${url}`;
            }).join('\n\n') + '\n';
            console.log(`[AiChat Search] Metaso returned ${results.length} results`);
          }
        } catch (e2: any) {
          console.error('[AiChat Search] Metaso failed:', e2.message);
        } finally {
          if (tmpFile) { try { fs.unlinkSync(tmpFile); console.log('[AiChat Search] Cleaned up temp file:', tmpFile); } catch (e3) { console.error('[AiChat Search] Failed to cleanup:', e3.message); } }
        }
      }
    }

    // Step 2: Build messages with date + search context
    const chatHistory = Array.isArray(history) ? history.slice(-8) : [];
    const now = new Date();
    const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const dateStr = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + weekDays[now.getDay()];

    let systemContent = '你是一个专业的行业分析AI助手。请用简洁、专业的中文回答用户的问题。回答应基于事实和数据，如果不能确定，请如实说明。';
    systemContent += '\n\n【当前时间】今天是' + dateStr + '，请以这个日期为准回答用户问题。';
    if (searchContext) {
      systemContent += '\n\n以下是网络搜索到的相关资料，请【仅基于】这些内容回答用户问题。如果搜索结果无法回答，请如实告知无法获取实时数据，严禁编造任何数据。' + searchContext;
    } else {
      systemContent += '\n\n【重要警告】未获取到实时搜索结果，请你绝对不要编造任何数据、数字或事实。如果无法回答，请直接告知“无法获取实时数据”。';
    }

    const messages = [
      { role: 'system', content: systemContent },
      ...chatHistory,
      { role: 'user', content: message }
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + deepseekApiKey },
      body: JSON.stringify({ model: 'deepseek-chat', messages, max_tokens: 2048, temperature: 0.7 })
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error('[AiChat Error]', response.status, errText.substring(0, 200));
      return res.status(response.status).json({ error: 'AI service error' });
    }
    const data = await response.json();
    const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '抱歉，未能生成回复。';
    res.json({ reply });
  } catch (err: any) {
    console.error('[AiChat Error]', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

// Save widget config from live portal (public, no auth)
app.post('/api/p/config/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { widgetIdx, widget } = req.body || {};

    if (typeof widgetIdx !== 'number' || !widget) {
      return res.status(400).json({ error: 'widgetIdx and widget are required' });
    }

    const site = await getReportSiteBySlug(slug, 'portal');
    if (!site) {
      return res.status(404).json({ error: 'Portal not found' });
    }

    let widgets: any[] = [];
    try {
      const match = site.html_content.match(/var WIDGETS=(\[[\s\S]*?\]);/);
      if (match) { widgets = JSON.parse(match[1]); }
    } catch (e) { /* keep empty */ }

    if (widgetIdx >= 0 && widgetIdx < widgets.length) {
      widgets[widgetIdx] = { ...widgets[widgetIdx], ...widget };
    } else {
      return res.status(400).json({ error: 'Invalid widgetIdx' });
    }

    const apiBase = process.env.FRONTEND_URL || `https://${req.get('host')}` || `http://localhost:${APP_PORT}`;
    const htmlContent = generatePortalHtml(site.title, '', 'intel-station', apiBase, slug, widgets);
    await createReportSite(site.user_id, slug, site.title, site.company_name, htmlContent, 'portal');

    res.json({ data: { success: true, slug } });
  } catch (err: any) {
    console.error('[Portal Config Save Error]', err.message);
    res.status(500).json({ error: err.message });
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

// ========== Video Generation (dreamina CLI) ==========

const DREAMINA_BIN = '/root/.local/bin/dreamina';
const execAsync = promisify(exec);
const VIDEO_DIR = process.env.VIDEO_DIR || path.join(__dirname, '..', 'public', 'videos');

// Ensure videos directory exists on startup
if (!fs.existsSync(VIDEO_DIR)) {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  console.log('[VideoGen] Created video directory:', VIDEO_DIR);
}


// Check login status — admin token always active, no OAuth needed
app.get("/api/v1/videos/status", authMiddleware, async (req, res) => {
  try {
    const { stdout } = await execAsync(`${DREAMINA_BIN} user_credit 2>&1`, { timeout: 10000, cwd: "/tmp" });
    res.json({ data: { loggedIn: true, credit: stdout.trim() } });
  } catch {
    res.json({ data: { loggedIn: true, credit: "" } });
  }
});

// Generate video using dreamina CLI
app.post('/api/v1/videos/generate', authMiddleware, async (req, res) => {
  try {
    const { prompt, duration, resolution, ratio } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Video prompt is required' } });
    }


    const dur = Number(duration) || 5;
    const reso = resolution || '720p';
    const rat = ratio || '16:9';
    
    console.log(`[VideoGen] Generating: "${prompt.slice(0, 80)}..." (${dur}s, ${reso}, ${rat})`);

    const cmd = `${DREAMINA_BIN} text2video --prompt="${prompt.trim().replace(/"/g, '\\"')}" --duration=${dur} --ratio=${rat} --video_resolution=${reso} --poll=300`;
    console.log('[VideoGen] Running:', cmd.slice(0, 150));
    
    const { stdout } = await execAsync(cmd + ' 2>&1', { timeout: 360000, maxBuffer: 10 * 1024 * 1024, cwd: '/tmp' });

    console.log('[VideoGen] Output:', stdout.slice(0, 500));

    // Parse video output - look for video URL
    let videoUrl = '';
    let submitId = '';
    
    // Try JSON parsing first
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        videoUrl = parsed.video_url || parsed.url || '';
        submitId = parsed.submit_id || parsed.id || '';
      } catch {}
    }
    
    // Try URL patterns
    if (!videoUrl) {
      const urlMatch = stdout.match(/https?:\/\/[^\s"']+\.(mp4|mov|webm)[^\s"']*/i);
      if (urlMatch) videoUrl = urlMatch[0];
    }
    
    if (videoUrl) {
      const videoId = submitId || crypto.randomUUID();
      const extMatch = videoUrl.match(/\.(mp4|webm|mov)/i);
      const ext = extMatch ? extMatch[1] : 'mp4';
      const localFilename = `${videoId}.${ext}`;
      const localPath = path.join(VIDEO_DIR, localFilename);
      
      // Download video from Jimeng CDN to local server
      let localUrl = videoUrl; // fallback to Jimeng URL
      try {
        console.log(`[VideoGen] Downloading video from Jimeng CDN...`);
        const downloadRes = await fetch(videoUrl);
        if (downloadRes.ok) {
          const buffer = Buffer.from(await downloadRes.arrayBuffer());
          fs.writeFileSync(localPath, buffer);
          const fileSizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
          console.log(`[VideoGen] Downloaded: ${localFilename} (${fileSizeMB} MB)`);
          localUrl = `${process.env.FRONTEND_URL || 'https://yooclaw.yookeer.com'}/videos/${localFilename}`;
        } else {
          console.error(`[VideoGen] Download failed: HTTP ${downloadRes.status}`);
        }
      } catch (downloadErr: any) {
        console.error('[VideoGen] Download error:', downloadErr.message);
        // Fall through — use Jimeng URL as fallback
      }
      
      res.json({
        data: {
          id: videoId,
          title: prompt.trim().slice(0, 30),
          url: localUrl,
          status: 'completed',
        },
      });
    } else {
      // Return the raw output as info
      res.json({
        data: {
          id: crypto.randomUUID(),
          title: prompt.trim().slice(0, 30),
          url: '',
          status: 'processing',
          message: '视频已提交即梦生成，请稍后查看: ' + stdout.slice(0, 200),
        },
      });
    }
  } catch (err: any) {
    console.error('[VideoGen Error]', err.message);
    res.status(500).json({ error: { code: 'GENERATE_FAILED', message: '视频生成失败: ' + err.message } });
  }
});

// ========== Serve generated videos as static files ==========
app.use('/videos', express.static(VIDEO_DIR, {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    } else if (filePath.endsWith('.webm')) {
      res.setHeader('Content-Type', 'video/webm');
    }
    res.setHeader('Cache-Control', 'public, max-age=604800');
  }
}));

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

  // Load persisted intelligence cache from file
  loadPortalIntelCache();
  // Periodic cache save every 5 minutes
  setInterval(() => savePortalIntelCache(), 5 * 60 * 1000);
  // Background cache warming: startup (deferred 30s) + every 20 minutes
  setTimeout(() => warmAllPortalCaches(), 30000);
  setInterval(() => warmAllPortalCaches(), 20 * 60 * 1000);

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

// ========== Intel Station Portal Generator (Three-Column Layout) ==========
function generateIntelStationHtml(siteName: string, siteDesc: string, apiBase: string, slug: string, widgets?: any[]): string {
  const sn = siteName.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const wlist = (widgets && widgets.length > 0) ? widgets : [{ type: 'intel-monitor', title: '情报监控', config: { sources: [] } }];
  const wlistJson = JSON.stringify(wlist).replace(/'/g, '\\x27');
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>` + sn + `</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--cyan:#00d4ff;--purple:#a855f7;--neon-blue:#00f0ff;--neon-purple:#d946ef;--neon-pink:#f472b6;--bg-primary:#020617;--bg-secondary:#0f172a;--bg-card:rgba(15,23,42,0.6);--border:rgba(255,255,255,0.1);--text-primary:#e2e8f0;--text-secondary:#94a3b8}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei","PingFang SC",sans-serif;background:var(--bg-primary);color:var(--text-primary);display:flex;flex-direction:column;overflow:hidden;-webkit-font-smoothing:antialiased;position:relative}
body::before{content:'';position:fixed;top:0;left:0;right:0;bottom:0;background:radial-gradient(ellipse at 20% 50%,rgba(0,212,255,0.03) 0%,transparent 50%),radial-gradient(ellipse at 80% 50%,rgba(168,85,247,0.03) 0%,transparent 50%);pointer-events:none;z-index:0}
::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(0,212,255,0.3);border-radius:10px}
::-webkit-scrollbar-thumb:hover{background:rgba(0,212,255,0.5)}

/* ===== NEON ANIMATIONS ===== */
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.2)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes neonScan{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
@keyframes borderGlow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}

/* ===== TOP BAR ===== */
.top-bar{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;background:rgba(2,6,23,0.95);border-bottom:1px solid var(--border);backdrop-filter:blur(16px);z-index:100;flex-shrink:0;box-shadow:0 2px 20px rgba(0,0,0,0.3),0 1px 0 rgba(0,212,255,0.05);position:relative;overflow:hidden}
.top-bar::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(0,212,255,0.4),rgba(168,85,247,0.4),rgba(0,212,255,0.4),transparent);animation:neonScan 4s linear infinite;pointer-events:none}
.top-logo{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:700;color:var(--cyan)}
.top-logo .logo-icon{width:32px;height:32px;background:linear-gradient(135deg,var(--cyan),var(--purple));border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 0 16px rgba(0,212,255,0.3),0 0 32px rgba(168,85,247,0.2);position:relative;overflow:hidden}
.top-logo .logo-icon::after{content:'';position:absolute;inset:0;background:linear-gradient(135deg,transparent 40%,rgba(255,255,255,0.2) 50%,transparent 60%);animation:neonScan 2s linear infinite}
.top-status{display:flex;align-items:center;gap:16px}
.status-dot{width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 8px rgba(16,185,129,0.6),0 0 16px rgba(16,185,129,0.3);animation:pulse 2s infinite}
.status-text{font-size:12px;color:var(--text-secondary)}
.top-tabs{display:flex;gap:4px}
.tab-btn{padding:6px 14px;border:1px solid var(--border);background:transparent;color:var(--text-secondary);border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;transition:all .2s;font-family:inherit}
.tab-btn:hover{border-color:rgba(0,212,255,0.4);color:var(--cyan);box-shadow:0 0 12px rgba(0,212,255,0.12),inset 0 1px 0 rgba(255,255,255,0.03)}
.tab-btn.active{background:linear-gradient(135deg,rgba(0,212,255,0.15),rgba(168,85,247,0.15));border-color:rgba(0,212,255,0.5);color:var(--cyan);box-shadow:0 0 16px rgba(0,212,255,0.15),0 0 8px rgba(168,85,247,0.1),inset 0 1px 0 rgba(255,255,255,0.05)}
.top-actions{display:flex;gap:8px}
.btn-deploy{padding:8px 18px;background:linear-gradient(135deg,var(--cyan),var(--purple));border:none;border-radius:8px;color:#020617;font-size:12px;font-weight:700;cursor:pointer;transition:all .2s;font-family:inherit;letter-spacing:0.3px;box-shadow:0 0 12px rgba(0,212,255,0.2)}
.btn-deploy:hover{transform:translateY(-1px);box-shadow:0 4px 20px rgba(0,212,255,0.3),0 0 30px rgba(168,85,247,0.2)}

/* ===== MAIN LAYOUT ===== */
.main-layout{display:grid;grid-template-columns:320px 1fr 340px;grid-template-rows:1fr auto;grid-template-areas:"left center right""left bottom right";flex:1;overflow:hidden;position:relative;z-index:1}
.main-layout::before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(0,212,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,255,0.02) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0}

/* ===== LEFT COLUMN - Source Cards ===== */
.left-col{grid-area:left;background:var(--bg-secondary);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;box-shadow:inset -1px 0 0 var(--border),2px 0 10px rgba(0,0,0,0.1)}
.left-header{padding:16px 18px;border-bottom:1px solid var(--border);flex-shrink:0;position:relative;display:flex;align-items:center;justify-content:space-between}
.left-header::after{content:'';position:absolute;bottom:-1px;left:0;width:60px;height:2px;background:linear-gradient(90deg,var(--cyan),var(--purple));border-radius:1px}
.left-header h3{font-size:13px;font-weight:700;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:0.5px}
.source-groups{flex:1;overflow-y:auto;padding:12px}
.source-card{display:flex;align-items:flex-start;gap:10px;padding:12px;margin-bottom:8px;border:1px solid var(--border);border-radius:10px;cursor:pointer;transition:all .25s;background:rgba(15,23,42,0.4);position:relative;overflow:hidden}
.source-card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(0,212,255,0.15),transparent);opacity:0;transition:opacity .25s}
.source-card:hover{border-color:rgba(0,212,255,0.4);background:rgba(0,212,255,0.05);box-shadow:0 0 16px rgba(0,212,255,0.1),inset 0 1px 0 rgba(255,255,255,0.03);transform:translateX(2px)}
.source-card:hover::before{opacity:1}
.source-card.active{border-color:rgba(0,212,255,0.5);background:rgba(0,212,255,0.08);box-shadow:0 0 20px rgba(0,212,255,0.15),0 0 8px rgba(168,85,247,0.08)}
.source-card .sc-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;background:rgba(0,212,255,0.1);box-shadow:0 0 8px rgba(0,212,255,0.08)}
.source-card .sc-body{flex:1;min-width:0}
.source-card .sc-name{font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:4px}
.source-card .sc-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.source-card .sc-provider{font-size:9px;padding:2px 6px;border-radius:4px;font-weight:600;background:rgba(0,212,255,0.12);color:var(--cyan)}
.source-card .sc-provider.metaso{background:rgba(168,85,247,0.12);color:var(--purple)}
.source-card .sc-kwcount{font-size:10px;color:var(--text-secondary)}
.source-card .sc-freq{font-size:10px;color:var(--text-secondary)}
.source-card .sc-edit{font-size:16px;color:var(--text-secondary);opacity:0;transition:opacity .2s;flex-shrink:0}
.source-card:hover .sc-edit{opacity:1}
.add-source-btn{width:100%;padding:10px;border:1px dashed var(--border);border-radius:10px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:12px;font-weight:500;transition:all .2s;font-family:inherit;margin-top:4px}
.add-source-btn:hover{border-color:rgba(0,212,255,0.3);color:var(--cyan);background:rgba(0,212,255,0.05);box-shadow:0 0 8px rgba(0,212,255,0.05)}

/* ===== CENTER COLUMN - Intel Feed ===== */
.center-col{grid-area:center;display:flex;flex-direction:column;overflow:hidden;background:var(--bg-primary)}
.center-header{padding:16px 24px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;position:relative}
.center-header::after{content:'';position:absolute;bottom:-1px;left:0;width:80px;height:2px;background:linear-gradient(90deg,var(--cyan),var(--purple));border-radius:1px}
.center-header h2{font-size:15px;font-weight:700;background:linear-gradient(135deg,var(--text-primary),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.intel-feed{flex:1;overflow-y:auto;padding:16px 24px}
.intel-card{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px;transition:all .3s;cursor:pointer;position:relative;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.2)}
.intel-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:transparent;transition:background .3s}
.intel-card::after{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(0,212,255,0.4),rgba(168,85,247,0.4),transparent);opacity:0;transition:opacity .3s}
.intel-card:hover{border-color:rgba(0,212,255,0.5);transform:translateX(3px);box-shadow:0 4px 24px rgba(0,212,255,0.12),0 0 24px rgba(168,85,247,0.1),inset 0 1px 0 rgba(255,255,255,0.04)}
.intel-card:hover::before{background:linear-gradient(180deg,var(--cyan),var(--purple))}
.intel-card:hover::after{opacity:1}
.intel-card-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px}
.intel-card-title{font-size:14px;font-weight:600;color:var(--text-primary);line-height:1.5;flex:1;padding-right:12px;text-decoration:none;transition:color .2s}
.intel-card-title:hover{color:var(--cyan);text-decoration:none}
.intel-card-source{font-size:10px;padding:3px 8px;border-radius:4px;background:rgba(0,212,255,0.1);color:var(--cyan);white-space:nowrap;flex-shrink:0}
.intel-card-summary{font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:10px}
.intel-card-footer{display:flex;align-items:center;justify-content:space-between}
.intel-card-tags{display:flex;gap:4px;flex-wrap:wrap}
.intel-tag{font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(168,85,247,0.1);color:var(--purple)}
.intel-card-time{font-size:10px;color:var(--text-secondary)}
.intel-loading{text-align:center;padding:40px;color:var(--text-secondary);font-size:13px}
.intel-loading .spinner{display:inline-block;width:20px;height:20px;border:2px solid rgba(0,212,255,0.3);border-top-color:var(--cyan);border-radius:50%;animation:spin 0.8s linear infinite;margin-right:10px;vertical-align:middle}

/* ===== CENTER TABS ===== */
.center-tabs{display:flex;gap:2px;background:rgba(15,23,42,0.4);border-radius:10px;padding:3px;border:1px solid var(--border)}
.ct-tab{padding:6px 18px;border-radius:8px;font-size:13px;font-weight:500;color:var(--text-secondary);cursor:pointer;transition:all .25s;white-space:nowrap;font-family:inherit;background:transparent;border:none}
.ct-tab:hover{color:var(--cyan);background:rgba(0,212,255,0.06)}
.ct-tab.active{color:var(--cyan);background:linear-gradient(135deg,rgba(0,212,255,0.15),rgba(168,85,247,0.12));box-shadow:0 0 12px rgba(0,212,255,0.1),inset 0 1px 0 rgba(255,255,255,0.05);font-weight:600}
/* ===== INTEL SUB-FILTERS ===== */
.subfilter-btn{padding:4px 12px;border:1px solid var(--border);background:transparent;color:var(--text-secondary);border-radius:6px;cursor:pointer;font-size:11px;font-weight:500;transition:all .2s;font-family:inherit}
.subfilter-btn:hover{border-color:rgba(0,212,255,0.4);color:var(--cyan)}
.subfilter-btn.active{background:linear-gradient(135deg,rgba(0,212,255,0.15),rgba(168,85,247,0.15));border-color:rgba(0,212,255,0.5);color:var(--cyan)}
.intel-subfilters{display:flex;gap:6px;flex-wrap:wrap;padding:8px 0 12px 0;border-bottom:1px solid var(--border);margin-bottom:12px}
/* ===== REPORT FEED ===== */
.report-feed{flex:1;overflow-y:auto;padding:16px 24px}
.report-card{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;cursor:pointer;transition:all .3s;position:relative;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.2)}
.report-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,#10b981,#34d399);transition:all .3s}
.report-card:hover{border-color:rgba(16,185,129,0.4);transform:translateX(3px);box-shadow:0 4px 24px rgba(16,185,129,0.12),0 0 24px rgba(52,211,153,0.08),inset 0 1px 0 rgba(255,255,255,0.04)}
.report-card-icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;background:linear-gradient(135deg,rgba(16,185,129,0.14),rgba(52,211,153,0.06));box-shadow:0 0 10px rgba(16,185,129,0.12)}
.report-card-body{flex:1;min-width:0}
.report-card-title{font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px}
.report-card-meta{display:flex;align-items:center;gap:10px}
.report-card-date{font-size:10px;color:var(--text-secondary)}
.report-card-tag{font-size:9px;padding:2px 8px;border-radius:4px;background:rgba(16,185,129,0.1);color:#34d399}
/* ===== AI CHAT ===== */
.ai-chat{flex:1;display:flex;flex-direction:column;overflow:hidden}
.ai-chat-messages{flex:1;overflow-y:auto;padding:16px 24px}
.ai-msg{margin-bottom:12px;max-width:85%;line-height:1.6}
.ai-msg-user{display:flex;justify-content:flex-end}
.ai-msg-user>div{background:linear-gradient(135deg,var(--cyan),var(--purple));color:#020617;padding:10px 14px;border-radius:14px 14px 4px 14px;font-size:13px;font-weight:500;box-shadow:0 2px 12px rgba(0,212,255,0.15)}
.ai-msg-bot{background:rgba(15,23,42,0.6);border:1px solid var(--border);padding:10px 14px;border-radius:14px 14px 14px 4px;font-size:13px;color:var(--text-secondary)}
/* Report card inner layout */
.report-card-inner{display:flex;align-items:center;gap:12px}
.no-data-msg{text-align:center;padding:40px 20px;color:var(--text-secondary);font-size:13px;line-height:1.8}

/* ===== RIGHT COLUMN - Dashboard ===== */
.right-col{grid-area:right;background:var(--bg-secondary);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;box-shadow:inset 1px 0 0 var(--border),-2px 0 10px rgba(0,0,0,0.1)}
.right-header{padding:16px 18px;border-bottom:1px solid var(--border);flex-shrink:0;position:relative}
.right-header::after{content:'';position:absolute;bottom:-1px;left:0;width:60px;height:2px;background:linear-gradient(90deg,var(--purple),var(--cyan));border-radius:1px}
.right-header h3{font-size:13px;font-weight:700;background:linear-gradient(135deg,var(--purple),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:0.5px}
.dashboard-content{flex:1;overflow-y:auto;padding:16px 18px}
.dashboard-section{margin-bottom:20px;position:relative;background:rgba(15,23,42,0.4);border:1px solid var(--border);border-radius:12px;padding:14px;transition:all .3s}
.dashboard-section:hover{border-color:rgba(0,212,255,0.2);box-shadow:0 0 16px rgba(0,212,255,0.05)}
.dashboard-section::before{content:'';position:absolute;top:-1px;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,rgba(0,212,255,0.2),rgba(168,85,247,0.2),transparent)}
.dashboard-section h4{font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:12px;letter-spacing:0.5px;text-transform:uppercase}
/* Sentiment Gauge */
.sentiment-gauge{position:relative;width:100%;max-width:260px;height:160px;margin:0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
.sentiment-gauge canvas{display:block;max-width:100%;height:auto}
.sentiment-label{font-size:16px;font-weight:700;color:rgba(255,255,255,0.9);text-shadow:0 0 16px rgba(0,212,255,0.3);margin-top:4px;text-align:center}
/* Keyword Cloud */
.keyword-cloud{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
.kw-cloud-item{font-size:11px;padding:4px 10px;border-radius:12px;background:rgba(0,212,255,0.08);color:var(--cyan);border:1px solid rgba(0,212,255,0.2);transition:all .3s;cursor:default;box-shadow:0 0 6px rgba(0,212,255,0.1)}
.kw-cloud-item:hover{transform:scale(1.1);background:rgba(0,212,255,0.15);box-shadow:0 0 16px rgba(0,212,255,0.25),0 0 8px rgba(0,212,255,0.15)}
.kw-cloud-item.important{font-size:13px;font-weight:600;background:rgba(168,85,247,0.15);color:var(--purple);border-color:rgba(168,85,247,0.35);box-shadow:0 0 10px rgba(168,85,247,0.2)}
.kw-cloud-item.important:hover{box-shadow:0 0 20px rgba(168,85,247,0.3),0 0 10px rgba(168,85,247,0.2)}
/* KPI Trend */
.kpi-trend{position:relative;height:100px;margin-bottom:12px;overflow:hidden}
.kpi-trend canvas{display:block;width:100%!important;height:100px}
/* AI Briefing */
.ai-briefing{background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.15);border-radius:10px;padding:14px;box-shadow:0 0 16px rgba(0,212,255,0.06),inset 0 1px 0 rgba(255,255,255,0.03);position:relative;overflow:hidden}
.ai-briefing::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(0,212,255,0.3),rgba(168,85,247,0.3),transparent)}
.ai-briefing-header{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.ai-briefing-header .ai-icon{width:24px;height:24px;background:linear-gradient(135deg,var(--cyan),var(--purple));border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 0 12px rgba(0,212,255,0.25),0 0 20px rgba(168,85,247,0.15)}
.ai-briefing-header .ai-title{font-size:12px;font-weight:600;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.briefing-text{font-size:11px;color:var(--text-secondary);line-height:1.6}
.briefing-text p{margin-bottom:6px}

/* ===== BOTTOM BAR - AI Command Center ===== */
.bottom-bar{grid-area:bottom;display:flex;align-items:center;justify-content:center;gap:0;padding:10px 24px 8px;background:rgba(2,6,23,0.98);border-top:1px solid var(--border);backdrop-filter:blur(20px);flex-shrink:0;position:relative;overflow:hidden;flex-direction:column}
.bottom-bar::before{content:'';position:absolute;inset:0;border-radius:0;background:linear-gradient(135deg,rgba(0,212,255,0.06),rgba(168,85,247,0.06));pointer-events:none;z-index:0}
.cmd-outer{position:relative;width:100%;max-width:600px;padding:2px;border-radius:30px;background:linear-gradient(135deg,#00d4ff,#a855f7,#00d4ff);background-size:200% 200%;animation:borderGlow 3s ease infinite;box-shadow:0 0 20px rgba(0,212,255,0.15),0 0 40px rgba(168,85,247,0.1);z-index:1;transition:all .3s}
.cmd-outer:focus-within{background:linear-gradient(135deg,#00f0ff,#d946ef,#00f0ff);background-size:200% 200%;animation:borderGlow 2s ease infinite;box-shadow:0 0 30px rgba(0,212,255,0.25),0 0 60px rgba(168,85,247,0.15),0 0 100px rgba(0,212,255,0.08)}
.cmd-wrapper{display:flex;align-items:center;gap:8px;width:100%;padding:4px 8px 4px 16px;background:linear-gradient(135deg,rgba(0,212,255,0.06),rgba(168,85,247,0.06));border-radius:28px;position:relative;z-index:1;transition:all .3s}
.cmd-wrapper:focus-within{background:linear-gradient(135deg,rgba(0,212,255,0.1),rgba(168,85,247,0.1))}
.cmd-label{display:none}
.cmd-input{flex:1;padding:6px 12px;border:none;background:transparent;color:var(--text-primary);font-size:13px;outline:none;font-family:inherit;min-width:0}
.cmd-input::placeholder{color:rgba(255,255,255,0.65);font-size:13px;font-weight:400}
.cmd-input:focus{outline:none}
.cmd-btn{width:32px;height:32px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .2s;flex-shrink:0}
.cmd-btn.mic{background:rgba(255,255,255,0.08);color:#ffffff}
.cmd-btn.mic:hover{background:rgba(0,212,255,0.2);color:#ffffff}
.cmd-btn.send{background:linear-gradient(135deg,var(--cyan),var(--purple));color:#020617;font-weight:700;box-shadow:0 2px 12px rgba(0,212,255,0.3)}
.cmd-btn.send:hover{transform:scale(1.05);box-shadow:0 4px 20px rgba(0,212,255,0.4),0 0 30px rgba(168,85,247,0.25)}
.cmd-hint{font-size:13px;color:rgba(255,255,255,0.35);margin-top:5px;text-align:center;letter-spacing:0.3px}

/* ===== MODAL ===== */
.modal-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .25s}
.modal-overlay.open{opacity:1;pointer-events:auto}
.modal-bg{position:absolute;inset:0;background:rgba(2,6,23,0.85);backdrop-filter:blur(8px)}
.modal-panel{position:relative;width:100%;max-width:560px;max-height:88vh;background:linear-gradient(135deg,#0f172a,#1e293b);border:1px solid rgba(255,255,255,0.12);border-top:3px solid var(--cyan);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transform:scale(.92) translateY(20px);transition:transform .35s cubic-bezier(.34,1.56,.64,1);box-shadow:0 24px 64px rgba(0,0,0,0.6),0 0 40px rgba(0,212,255,0.1)}
.modal-overlay.open .modal-panel{transform:scale(1) translateY(0)}
.modal-hd{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0}
.mh-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;background:rgba(0,212,255,0.12);box-shadow:0 0 12px rgba(0,212,255,0.1)}
.mh-info{flex:1;min-width:0}
.mh-title{font-size:14px;font-weight:700;color:var(--text-primary)}
.mh-sub{font-size:11px;color:var(--text-secondary);margin-top:2px}
.modal-close{width:32px;height:32px;border-radius:8px;border:none;background:transparent;color:var(--text-secondary);font-size:20px;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center}
.modal-close:hover{background:rgba(239,68,68,0.15);color:#ef4444}
.modal-bd{flex:1;overflow-y:auto;padding:20px}
.modal-ft{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border);flex-shrink:0}
.btn-cancel{padding:8px 18px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:12px;font-weight:500;transition:all .2s;font-family:inherit}
.btn-cancel:hover{border-color:rgba(255,255,255,0.2);color:var(--text-primary)}
.btn-save{padding:8px 18px;border:none;border-radius:8px;background:linear-gradient(135deg,var(--cyan),var(--purple));color:#020617;cursor:pointer;font-size:12px;font-weight:700;transition:all .2s;font-family:inherit;box-shadow:0 0 12px rgba(0,212,255,0.2)}
.btn-save:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,212,255,0.3),0 0 20px rgba(168,85,247,0.2)}
.btn-save:disabled{opacity:0.5;cursor:not-allowed;transform:none;box-shadow:none}
/* Modal Form Fields */
.mb-group{margin-bottom:14px}
.mb-label{display:block;font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:6px}
.mb-label span{font-weight:400;color:var(--text-secondary);opacity:0.6}
.mb-input{width:100%;padding:8px 12px;background:rgba(2,6,23,0.5);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:12px;outline:none;font-family:inherit;transition:border .2s}
.mb-input:focus{border-color:var(--cyan)}
.mb-select{width:100%;padding:8px 12px;background:rgba(2,6,23,0.5);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:12px;outline:none;font-family:inherit;transition:border .2s;cursor:pointer}
.mb-select:focus{border-color:var(--cyan)}
.mb-area{width:100%;padding:8px 12px;background:rgba(2,6,23,0.5);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:12px;outline:none;font-family:inherit;transition:border .2s;resize:vertical}
.mb-area:focus{border-color:var(--cyan)}
.mb-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
/* Keyword Tags in Modal */
.kw-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.kw-t{display:flex;align-items:center;gap:4px;padding:4px 10px;background:rgba(0,212,255,0.1);border:1px solid rgba(0,212,255,0.2);border-radius:10px;font-size:11px;color:var(--cyan);box-shadow:0 0 6px rgba(0,212,255,0.05)}
.kw-x{background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:13px;padding:0 2px;transition:color .2s}
.kw-x:hover{color:#ef4444}
.kw-add-row{display:flex;gap:6px}
.kw-add-input{flex:1;padding:6px 10px;background:rgba(2,6,23,0.5);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:11px;outline:none;font-family:inherit;transition:border .2s}
.kw-add-input:focus{border-color:var(--cyan)}
.kw-add-btn{padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:rgba(0,212,255,0.05);color:var(--cyan);cursor:pointer;font-size:14px;font-weight:700;transition:all .2s}
.kw-add-btn:hover{background:rgba(0,212,255,0.15);border-color:rgba(0,212,255,0.3)}
/* Delete source button */
.src-del{font-size:11px;color:var(--text-secondary);cursor:pointer;padding:4px 8px;border-radius:4px;transition:all .2s}
.src-del:hover{color:#ef4444;background:rgba(239,68,68,0.1)}
.btn-add-src{width:100%;margin-top:8px;padding:10px;border:1px dashed var(--border);border-radius:8px;background:transparent;color:var(--cyan);cursor:pointer;font-size:12px;font-weight:600;transition:all .2s;font-family:inherit}
.btn-add-src:hover{border-color:var(--cyan);background:rgba(0,212,255,0.05);box-shadow:0 0 8px rgba(0,212,255,0.08)}

/* Source Row Header */
.src-top{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.st-name-input{flex:1;padding:6px 10px;background:rgba(2,6,23,0.5);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:12px;font-weight:600;outline:none;font-family:inherit;transition:border .2s}
.st-name-input:focus{border-color:var(--cyan)}
.src-mini{border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px;background:rgba(15,23,42,0.3);transition:border .2s}
.src-mini:hover{border-color:rgba(0,212,255,0.2)}

/* ===== RESPONSIVE ===== */
@media(max-width:1280px){.main-layout{grid-template-columns:280px 1fr 300px;grid-template-rows:1fr auto;grid-template-areas:"left center right""left bottom right"}}
@media(max-width:1024px){.main-layout{grid-template-columns:1fr;height:100%;grid-template-rows:1fr auto;grid-template-areas:"center""bottom"}.left-col,.right-col{display:none}}
@media(max-width:768px){.top-bar{padding:10px 16px}.center-header{padding:12px 16px}.intel-feed{padding:12px 16px}}
</style>
</head>
<body>
<!-- ===== TOP BAR ===== -->
<div class="top-bar">
  <div class="top-logo">
    <div class="logo-icon">&#x1F680;</div>
    <span>` + sn + `</span>
  </div>
  <div class="top-status">
    <div class="status-dot"></div>
    <span class="status-text">实时监控中</span>
  </div>
  <div class="top-actions">
    <button class="btn-deploy" onclick="deployPortal()">部署更新</button>
  </div>
</div>

<!-- ===== MAIN LAYOUT ===== -->
<div class="main-layout">
  <!-- Left Column - Filter -->
  <div class="left-col">
    <div class="left-header">
      <h3>&#x1F6F0; 监控源</h3>
    </div>
    <div class="source-groups" id="sourceGroups">
      <!-- Dynamic content -->
    </div>
  </div>

  <!-- Center Column - Intel Feed -->
  <div class="center-col">
    <div class="center-header">
      <div class="center-tabs" id="centerTabs">
        <span class="ct-tab active" onclick="switchCenterTab('intel')">&#x1F4CA; 动态情报流</span>
        <span class="ct-tab" onclick="switchCenterTab('reports')">&#x1F4C8; 行业分析报告</span>
        <span class="ct-tab" onclick="switchCenterTab('ai')">&#x1F916; AI助手</span>
      </div>
      <span class="status-text" id="feedStatus">加载中...</span>
    </div>
    <div class="intel-subfilters" id="intelSubFilters" style="display:none"></div>
    <div class="intel-loading" id="intelLoading">
      <div class="spinner"></div>正在获取情报数据...
    </div>
    <div class="intel-feed" id="intelFeed"></div>
    <div class="report-feed" id="reportFeed" style="display:none">
      <div class="intel-loading" id="reportLoading">
        <div class="spinner"></div>加载报告中...
      </div>
    </div>
    <div class="ai-chat" id="aiChat" style="display:none">
      <div class="ai-chat-messages" id="aiChatMessages">
        <div class="ai-msg ai-msg-bot">&#x1F44B; 你好！我是AI助手，可以帮你分析行业趋势、解读情报数据、回答相关问题。请随时向我提问。</div>
      </div>
    </div>
  </div>

  <!-- Right Column - Dashboard -->
  <div class="right-col">
    <div class="right-header">
      <h3>&#x1F9E0; AI 摘要看板</h3>
    </div>
    <div class="dashboard-content" id="dashboardContent">
      <!-- Sentiment Gauge -->
      <div class="dashboard-section">
        <h4>&#x1F4C8; 情绪分析</h4>
        <div class="sentiment-gauge">
          <canvas id="sentimentCanvas" width="260" height="130"></canvas>
          <div class="sentiment-label" id="sentimentLabel">中性 52%</div>
        </div>
      </div>
      <!-- Keyword Cloud -->
      <div class="dashboard-section">
        <h4>&#x1F524; 关键词云</h4>
        <div class="keyword-cloud" id="keywordCloud">
          <!-- Dynamic keywords -->
        </div>
      </div>
      <!-- KPI Trend -->
      <div class="dashboard-section">
        <h4>&#x1F4C9; 关注度趋势</h4>
        <div class="kpi-trend">
          <canvas id="kpiCanvas" width="300" height="100"></canvas>
        </div>
      </div>
      <!-- AI Briefing -->
      <div class="dashboard-section">
        <h4>&#x1F916; AI 简报</h4>
        <div class="ai-briefing" id="aiBriefing">
          <div class="ai-briefing-header">
            <div class="ai-icon">&#x1F9E0;</div>
            <div class="ai-title">智能摘要</div>
          </div>
          <div class="briefing-text" id="briefingText">
            <p>正在分析情报数据...</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== BOTTOM BAR - AI Command Center ===== -->
  <div class="bottom-bar">
    <div class="cmd-outer">
      <div class="cmd-wrapper">
        <input class="cmd-input" id="cmdInput" placeholder="请在这里提问或给我指令" onkeydown="if(event.key==='Enter'){event.preventDefault();sendCommand()}">
        <button class="cmd-btn mic" onclick="toggleMic()">&#x1F399;</button>
        <button class="cmd-btn send" onclick="sendCommand()">&#x27A4;</button>
      </div>
    </div>
    <div class="cmd-hint">你可以问AI：给我总结一下今天所有的最新情报</div>
  </div>
</div>

<!-- ===== MODAL ===== -->
<div class="modal-overlay" id="modalOverlay" onclick="closeSourceModal(event)">
  <div class="modal-bg"></div>
  <div class="modal-panel" id="modalPanel" onclick="event.stopPropagation()">
    <div class="modal-hd">
      <div class="mh-icon" id="modalIcon">&#x1F6F0;</div>
      <div class="mh-info">
        <div class="mh-title" id="modalTitle">编辑监控源</div>
        <div class="mh-sub" id="modalSub">修改情报监控源配置</div>
      </div>
      <button class="modal-close" onclick="closeSourceModalDirect()">&times;</button>
    </div>
    <div class="modal-bd" id="modalBody"></div>
    <div class="modal-ft" id="modalFooter">
      <button class="btn-cancel" onclick="closeSourceModalDirect()">取消</button>
      <button class="btn-save" id="btnSave">保存配置</button>
    </div>
  </div>
</div>

<script>
var API='` + apiBase + `';
var DEFAULT_DEEPSEEK_KEY='${process.env.DEEPSEEK_API_KEY || ""}';
var DEFAULT_METASO_KEY='${process.env.METASO_API_KEY || ""}';
var WIDGETS=` + wlistJson + `;
var PORTAL_SLUG='` + slug.replace(/'/g, "\\'") + `';
var currentSourceFilters=['全部'];
var allIntelData=[];
var currentFilter='all';
var aiChatHistory=[];
var currentCenterTab='intel';

function $(id){return document.getElementById(id)}

/* ===== INIT ===== */
(function(){
  setTimeout(function(){loadIntelData()},500);
  setTimeout(function(){initDashboard()},300);
})();

/* ===== LOAD INTEL DATA ===== */
async function loadIntelData(){
  var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  if(monitors.length===0){
    $('intelLoading').innerHTML='<p style="color:var(--text-secondary)">暂无监控源配置</p>';
    return;
  }
  $('intelLoading').style.display='block';
  $('feedStatus').textContent='获取情报中...';
  // Check localStorage cache first (30min TTL matches backend)
  var cacheKey='portal-intel-'+PORTAL_SLUG;
  var cachedData=null;
  try{
    var cachedRaw=localStorage.getItem(cacheKey);
    if(cachedRaw){
      cachedData=JSON.parse(cachedRaw);
      if(cachedData&&cachedData.expiry>Date.now()){
        allIntelData=cachedData.data||[];
        renderSourceFilters(monitors);
        buildIntelSubFilters(monitors);
        renderIntelFeed(allIntelData);
        updateDashboard(allIntelData);
        $('feedStatus').textContent='已加载 '+allIntelData.length+' 条情报（缓存，后台更新中...）';
        $('intelLoading').style.display='none';
        console.log('[loadIntelData] Loaded '+allIntelData.length+' items from localStorage cache');
      } else {cachedData=null;}
    }
  }catch(e){cachedData=null;}
  try {
    var sources=[];
    monitors.forEach(function(mw){
      (mw.config&&mw.config.sources||mw.sources||[]).forEach(function(src){sources.push(src)});
    });
    if(sources.length===0){
      if(!cachedData) $('intelLoading').innerHTML='<p style="color:var(--text-secondary)">暂无监控源</p>';
      return;
    }
    sources.forEach(function(src){
      if(!src.apiKey)src.apiKey=src.aiProvider==='metaso'?DEFAULT_METASO_KEY:DEFAULT_DEEPSEEK_KEY;
    });
    var result=await fetch(API+'/api/portal-intel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sources:sources})});
    if(!result.ok)throw new Error('API error: '+result.status);
    var data=await result.json();
    allIntelData=[];
    (data.results||[]).forEach(function(r){
      var srcConfig=sources[r.sourceIdx];
      var sourceName=(srcConfig?(srcConfig.name||'未命名'):'未知来源').trim();
      (r.data||[]).forEach(function(item){
        item._sourceName=sourceName;
        allIntelData.push(item);
      });
    });
    // Save to localStorage (30min TTL)
    try{localStorage.setItem(cacheKey,JSON.stringify({data:allIntelData,expiry:Date.now()+30*60*1000}));}catch(e){}
    renderSourceFilters(monitors);
    buildIntelSubFilters(monitors);
    // 如果当前有过滤条件激活，重新应用过滤；否则渲染全部
    if(currentSourceFilters.length===0||currentSourceFilters[0]==='全部'){
      renderIntelFeed(allIntelData);
    } else {
      var filtered=allIntelData.filter(function(item){
        return currentSourceFilters.indexOf(item._sourceName) >= 0;
      });
      console.log('[loadIntelData] filter active, rendering', filtered.length, 'of', allIntelData.length);
      renderIntelFeed(filtered);
    }
    updateDashboard(allIntelData);
    $('feedStatus').textContent='已加载 '+allIntelData.length+' 条情报';
    $('intelLoading').style.display='none';
  } catch(e) {
    if(!cachedData){
      $('intelLoading').innerHTML='<p style="color:#ef4444">加载失败: '+e.message+'</p>';
      $('feedStatus').textContent='加载失败';
    } else {
      $('feedStatus').textContent='已加载 '+allIntelData.length+' 条情报（缓存，更新失败：'+e.message+'）';
    }
  }
}

/* ===== RENDER SOURCE FILTERS ===== */
function renderSourceFilters(monitors){
  var widgetSources=[];
  monitors.forEach(function(mw,monitorIdx){
    var wi=WIDGETS.indexOf(mw);if(wi===-1)wi=monitorIdx;
    var srcs=mw.config&&mw.config.sources||mw.sources||[];
    srcs.forEach(function(src,si){widgetSources.push({widgetIndex:wi,sourceIndex:si,source:src})});
  });
  if(widgetSources.length===0){
    $('sourceGroups').innerHTML='<div style="text-align:center;padding:24px;color:var(--text-secondary);font-size:12px">暂无监控源<br><br><button class="add-source-btn" onclick="addNewSource()">+ 添加第一个监控源</button></div>';
    return;
  }
  var html='';
  widgetSources.forEach(function(ws){
    var src=ws.source;
    var providerLabel=src.aiProvider||'deepseek';
    var kws=(src.keywords||[]);
    var freqLabel={hourly:'每小时',daily:'每日',weekly:'每周',monthly:'每月'}[src.updateFrequency]||'每日';
    html+='<div class="source-card" onclick="openSourceModal('+ws.widgetIndex+','+ws.sourceIndex+')" title="点击编辑此监控源">';
    html+='<div class="sc-icon">&#x1F6F0;</div>';
    html+='<div class="sc-body">';
    html+='<div class="sc-name">'+escHtml(src.name||'未命名')+'</div>';
    html+='<div class="sc-meta">';
    html+='<span class="sc-provider'+(providerLabel==='metaso'?' metaso':'')+'">'+escHtml(providerLabel)+'</span>';
    html+='<span class="sc-kwcount">'+kws.length+' 关键词</span>';
    html+='<span class="sc-freq">'+freqLabel+'</span>';
    html+='</div></div>';
    html+='<div class="sc-edit">&#x270E;</div>';
    html+='</div>';
  });
  html+='<button class="add-source-btn" onclick="addNewSource()">+ 添加监控源</button>';
  $('sourceGroups').innerHTML=html;
}

/* ===== RENDER INTEL FEED ===== */
function renderIntelFeed(data){
  console.log('[renderIntelFeed] called with data.length=', data.length, 'first _sourceName=', data.length>0?data[0]._sourceName:'N/A');
  if(data.length===0){$('intelFeed').innerHTML='<div class="intel-loading">暂无情报数据</div>';return}
  var html='';
  data.forEach(function(item,i){
    var keywords=(item.keywords||[]).slice(0,3);
    var url=item.url||item.link||item.sourceUrl||item.href||'';
    var clickAttr=url?' data-url="'+escHtml(url)+'" onclick="if(this.dataset.url)window.open(this.dataset.url,&#39;_blank&#39;)"':'';
    html+='<div class="intel-card"'+clickAttr+'>';
    html+='<div class="intel-card-header">';
    if(url){
      html+='<span class="intel-card-title" style="color:var(--cyan);cursor:pointer">'+(item.title||'无标题')+'</span>';
    } else {
      html+='<span class="intel-card-title" style="cursor:default">'+(item.title||'无标题')+'</span>';
    }
    html+='<div class="intel-card-source">'+(item.source||'未知来源')+'</div>';
    html+='</div>';
    if(item.summary)html+='<div class="intel-card-summary">'+(item.summary||'')+'</div>';
    html+='<div class="intel-card-footer">';
    html+='<div class="intel-card-tags">';
    keywords.forEach(function(kw){html+='<span class="intel-tag">'+escHtml(kw)+'</span>'});
    html+='</div>';
    html+='<div class="intel-card-time">'+(item.date||'刚刚')+'</div>';
    html+='</div>';
    html+='</div>';
  });
  $('intelLoading').style.display='none';
  $('intelFeed').innerHTML=html;
  // 更新状态文字，反映当前过滤结果
  if(typeof currentSourceFilters!=='undefined'&&currentSourceFilters.length>0&&currentSourceFilters[0]!=='全部'){
    $('feedStatus').textContent='已过滤：显示 '+data.length+' 条（共 '+allIntelData.length+' 条）';
  } else {
    $('feedStatus').textContent='已加载 '+data.length+' 条情报';
  }
}

/* ===== INTEL SUB-FILTERS ===== */
function buildIntelSubFilters(monitors){
  var sourceNames=['全部'];
  monitors.forEach(function(mw){
    (mw.config&&mw.config.sources||mw.sources||[]).forEach(function(src){
      var name=(src.name||'未命名').trim();
      if(sourceNames.indexOf(name)===-1)sourceNames.push(name);
    });
  });
  var el=$('intelSubFilters');
  if(!el)return;
  if(sourceNames.length<=1){el.style.display='none';return}
  var html='';
  sourceNames.forEach(function(name,i){
    html+='<button class="subfilter-btn'+(i===0?' active':'')+'" data-source="'+escHtml(name)+'" onclick="filterBySourceFromBtn(this)">'+escHtml(name)+'</button>';
  });
  el.innerHTML=html;
  if(currentCenterTab==='intel')el.style.display='';
}

function filterBySourceFromBtn(btn){
  var sourceName=btn.getAttribute('data-source');
  if(!sourceName)return;
  filterBySource(sourceName);
}
function filterBySource(sourceName){
  console.log('[filterBySource] sourceName=', sourceName, 'currentSourceFilters=', JSON.stringify(currentSourceFilters));
  if(sourceName==='全部'){
    currentSourceFilters=['全部'];
  } else {
    var allIdx=currentSourceFilters.indexOf('全部');
    if(allIdx >= 0)currentSourceFilters.splice(allIdx,1);
    var idx=currentSourceFilters.indexOf(sourceName);
    if(idx >= 0){
      currentSourceFilters.splice(idx,1);
    }else{
      currentSourceFilters.push(sourceName);
    }
  }
  // Sync UI: set 'active' class based on currentSourceFilters
  document.querySelectorAll('.subfilter-btn').forEach(function(b){
    var sn=(b.getAttribute('data-source')||'').trim();
    if(!sn)return;
    if(currentSourceFilters.indexOf(sn)>=0)b.classList.add('active');
    else b.classList.remove('active');
  });
  console.log('[filterBySource] after sync, currentSourceFilters=', JSON.stringify(currentSourceFilters));
  if(currentSourceFilters.length===0||currentSourceFilters[0]==='全部'){
    renderIntelFeed(allIntelData);
    return;
  }
  var filtered=allIntelData.filter(function(item){
    return currentSourceFilters.indexOf((item._sourceName||'').trim()) >= 0;
  });
  console.log('[filterBySource] filtered count=', filtered.length, 'allIntelData count=', allIntelData.length);
  renderIntelFeed(filtered);
  // 延迟检查：确认 DOM 没有被 loadIntelData 覆盖
  setTimeout(function(){
    var feed=$('intelFeed');
    if(feed&&feed.children.length!==filtered.length){
      console.warn('[filterBySource] DOM was overwritten! children=',feed.children.length,'expected=',filtered.length);
    }
  },1000);
}

/* ===== CENTER TAB SWITCHING ===== */
var currentCenterTab='intel';
function switchCenterTab(tab){
  if(currentCenterTab===tab)return;
  currentCenterTab=tab;
  var tabs=document.querySelectorAll('#centerTabs .ct-tab');
  tabs.forEach(function(t){t.classList.remove('active')});
  if(tab==='intel'){
    tabs[0].classList.add('active');
    $('intelFeed').style.display='';$('reportFeed').style.display='none';$('aiChat').style.display='none';
    $('intelSubFilters').style.display='';
    $('feedStatus').textContent=allIntelData.length?'已加载 '+allIntelData.length+' 条情报':'加载中...';
    // 恢复底部输入框为普通模式
    var cmd=$('cmdInput');
    if(cmd){cmd.placeholder='请在这里提问或给我指令';cmd.dataset.mode='command'}
  } else if(tab==='reports'){
    tabs[1].classList.add('active');
    $('intelFeed').style.display='none';$('reportFeed').style.display='';$('aiChat').style.display='none';
    $('intelSubFilters').style.display='none';
    $('feedStatus').textContent='报告中';
    var cmd=$('cmdInput');
    if(cmd){cmd.placeholder='请在这里提问或给我指令';cmd.dataset.mode='command'}
    loadReports();
  } else if(tab==='ai'){
    tabs[2].classList.add('active');
    $('intelFeed').style.display='none';$('reportFeed').style.display='none';$('aiChat').style.display='';
    $('intelSubFilters').style.display='none';
    $('feedStatus').textContent='AI助手';
    // 切换底部输入框为AI模式
    var cmd=$('cmdInput');
    if(cmd){cmd.placeholder='输入你的问题，按Enter发送...';cmd.dataset.mode='ai'}
  }
}

/* ===== LOAD REPORTS ===== */
var allReports=[];
var reportsLoaded=false;
async function loadReports(){
  if(!PORTAL_SLUG){$('reportFeed').innerHTML='<div class="no-data-msg">无法获取门户标识</div>';return}
  if(reportsLoaded&&allReports.length>0){renderReportCards(allReports);return}
  $('reportLoading').style.display='block';
  try {
    var r=await fetch(API+'/api/p/reports/'+PORTAL_SLUG);
    if(!r.ok)throw new Error('API error: '+r.status);
    var data=await r.json();
    allReports=data.data||[];
    reportsLoaded=true;
    renderReportCards(allReports);
    $('feedStatus').textContent=allReports.length+' 份报告';
  } catch(e){
    $('reportFeed').innerHTML='<div class="no-data-msg">加载报告失败: '+e.message+'</div>';
    $('feedStatus').textContent='加载失败';
  }
}

function renderReportCards(reports){
  $('reportLoading').style.display='none';
  if(!reports||reports.length===0){
    $('reportFeed').innerHTML='<div class="no-data-msg">&#x1F4D1; 暂无行业分析报告<br><span style="font-size:11px;opacity:0.6">在Portal Builder中生成报告后，这里将自动显示</span></div>';
    return;
  }
  var html='';
  reports.forEach(function(report){
    var dateStr='';
    if(report.createdAt){
      var d=new Date(report.createdAt);
      dateStr=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    }
    var reportUrl=report.url||('/web/'+report.slug);
    html+='<div class="report-card" onclick="window.open(&#39;'+escHtml(reportUrl)+'&#39;,&#39;_blank&#39;)">';
    html+='<div class="report-card-inner">';
    html+='<div class="report-card-icon">&#x1F4CA;</div>';
    html+='<div class="report-card-body">';
    html+='<div class="report-card-title">'+escHtml(report.companyName||report.title||'行业分析报告')+'</div>';
    html+='<div class="report-card-meta">';
    html+='<span class="report-card-date">'+dateStr+'</span>';
    html+='<span class="report-card-tag">行业分析</span>';
    html+='</div></div></div></div>';
  });
  $('reportFeed').innerHTML=html;
}

function appendChatMessage(role,text){
  var el=document.createElement('div');
  el.className='ai-msg ai-msg-'+role;
  var inner=document.createElement('div');
  inner.textContent=text;
  el.appendChild(inner);
  $('aiChatMessages').appendChild(el);
  $('aiChatMessages').scrollTop=$('aiChatMessages').scrollHeight;
}

/* ===== MODAL: Source Edit ===== */
var _activeWi=-1,_activeSi=-1;

function openSourceModal(wi,si){
  _activeWi=wi;_activeSi=si;
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.config&&w.config.sources||w.sources||[];
  var src=srcs[si];
  if(!src){closeSourceModalDirect();return}
  $('modalIcon').textContent='\uD83D\uDEE0';
  $('modalTitle').textContent=src.name||'编辑监控源';
  $('modalSub').textContent='配置情报监控源参数';
  renderSourceForm(wi,si);
  $('btnSave').onclick=function(){saveSourceConfig(wi,si)};
  $('modalOverlay').classList.add('open');
  document.body.style.overflow='hidden';
}

function closeSourceModal(e){
  if(e&&e.target!==$('modalOverlay'))return;
  closeSourceModalDirect();
}

function closeSourceModalDirect(){
  $('modalOverlay').classList.remove('open');
  document.body.style.overflow='';
  _activeWi=-1;_activeSi=-1;
}

document.addEventListener('keydown',function(e){
  if(e.key==='Escape')closeSourceModalDirect();
});

function renderSourceForm(wi,si){
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.config&&w.config.sources||w.sources||[];
  var src=srcs[si];
  if(!src)return;
  var kws=src.keywords||[];
  var s='';
  s+='<div class="src-mini">';
  s+='<div class="src-top"><input class="st-name-input" id="srcName_'+wi+'_'+si+'" value="'+escHtml(src.name||'')+'" placeholder="监控源名称">';
  s+='<span class="src-del" onclick="deleteSource('+wi+','+si+')" title="删除此监控源">\u2715 删除</span></div>';
  s+='<div class="mb-row"><div class="mb-group"><label class="mb-label">AI 引擎</label>';
  s+='<select class="mb-select" id="srcProvider_'+wi+'_'+si+'">';
  ['deepseek','metaso','codebuddy','custom'].forEach(function(p){
    s+='<option value="'+p+'"'+(src.aiProvider===p?' selected':'')+'>'+p+'</option>';
  });
  s+='</select></div>';
  s+='<div class="mb-group"><label class="mb-label">AI 模型</label>';
  s+='<input class="mb-input" id="srcModel_'+wi+'_'+si+'" value="'+escHtml(src.aiModel||'')+'" placeholder="例如: deepseek-v3.1">';
  s+='</div></div>';
  s+='<div class="mb-row"><div class="mb-group"><label class="mb-label">API Key</label>';
  s+='<input class="mb-input" type="password" id="srcApiKey_'+wi+'_'+si+'" value="'+escHtml(src.apiKey||'')+'" placeholder="可选">';
  s+='</div><div class="mb-group"><label class="mb-label">更新频率</label>';
  s+='<select class="mb-select" id="srcFreq_'+wi+'_'+si+'">';
  var freqs=['hourly','daily','weekly','monthly'];
  var freqLabels={hourly:'每小时',daily:'每日',weekly:'每周',monthly:'每月'};
  freqs.forEach(function(f){
    s+='<option value="'+f+'"'+(src.updateFrequency===f?' selected':'')+'>'+freqLabels[f]+'</option>';
  });
  s+='</select></div></div>';
  s+='<div class="mb-group"><label class="mb-label">监控关键词</label>';
  s+='<div class="kw-tags" id="kwTags_'+wi+'_'+si+'">';
  kws.forEach(function(k){
    s+='<span class="kw-t">'+escHtml(k)+'<button class="kw-x" onclick="removeKeyword('+wi+','+si+',this.parentElement)" title="移除">&times;</button></span>';
  });
  s+='</div>';
  s+='<div class="kw-add-row"><input class="kw-add-input" id="kwInput_'+wi+'_'+si+'" placeholder="输入关键词后回车添加..." onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();addKeyword('+wi+','+si+')}">';
  s+='<button class="kw-add-btn" onclick="addKeyword('+wi+','+si+')">+</button></div>';
  s+='</div>';
  s+='<div class="mb-group"><label class="mb-label">自定义提示词 <span>（可选）</span></label>';
  s+='<textarea class="mb-area" id="srcPrompt_'+wi+'_'+si+'" style="min-height:80px" placeholder="自定义此监控源的分析提示词...">'+escHtml(src.customPrompt||'')+'</textarea>';
  s+='</div>';
  s+='</div>';
  $('modalBody').innerHTML=s;
  $('modalBody').scrollTop=0;
}

function saveSourceConfig(wi,si){
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.config&&w.config.sources||w.sources||[];
  if(!srcs[si])return;
  var name=($('srcName_'+wi+'_'+si)||{}).value||'';
  var provider=($('srcProvider_'+wi+'_'+si)||{}).value||'deepseek';
  var model=($('srcModel_'+wi+'_'+si)||{}).value||'';
  var apiKey=($('srcApiKey_'+wi+'_'+si)||{}).value||'';
  var freq=($('srcFreq_'+wi+'_'+si)||{}).value||'daily';
  var prompt=($('srcPrompt_'+wi+'_'+si)||{}).value||'';
  var keywords=[];
  var kwContainer=$('kwTags_'+wi+'_'+si);
  if(kwContainer){
    kwContainer.querySelectorAll('.kw-t').forEach(function(tag){
      var kwText=tag.childNodes[0]?tag.childNodes[0].textContent.replace('\u00d7','').trim():'';
      if(kwText)keywords.push(kwText);
    });
  }
  srcs[si].name=name;
  srcs[si].aiProvider=provider;
  srcs[si].aiModel=model;
  srcs[si].apiKey=apiKey;
  srcs[si].updateFrequency=freq;
  srcs[si].customPrompt=prompt;
  srcs[si].keywords=keywords;
  if(w.config&&w.config.sources)w.config.sources=srcs;
  else w.sources=srcs;
  var slug=window.location.pathname.split('/').pop();
  var monitorWidget={type:'intel-monitor',idx:wi,title:w.title,sources:srcs};
  fetch(API+'/api/p/config/'+slug,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({widgetIdx:wi,widget:{type:'monitor',idx:wi,title:w.title||'情报监控',sources:srcs}})}).then(function(r){
    if(r.ok){
      var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
      renderSourceFilters(monitors);
      closeSourceModalDirect();
    }else{
      alert('保存失败，请重试');
    }
  }).catch(function(){alert('网络错误，请重试');});
}

function addNewSource(){
  var w=WIDGETS.find(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  if(!w){
    alert('请先在建站页面添加情报监控组件');
    return;
  }
  var srcs=w.config&&w.config.sources||w.sources||[];
  srcs.push({name:'新监控源',aiProvider:'deepseek',aiModel:'',apiKey:'',keywords:[],updateFrequency:'daily',customPrompt:''});
  if(w.config&&w.config.sources)w.config.sources=srcs;
  else w.sources=srcs;
  var newSi=srcs.length-1;
  var allMonitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  var wi=WIDGETS.indexOf(w);
  if(wi===-1)wi=0;
  renderSourceFilters(allMonitors);
  setTimeout(function(){openSourceModal(wi,newSi)},100);
}

function deleteSource(wi,si){
  if(!confirm('确定要删除这个监控源吗？此操作不可撤销。'))return;
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.config&&w.config.sources||w.sources||[];
  srcs.splice(si,1);
  if(w.config&&w.config.sources)w.config.sources=srcs;
  else w.sources=srcs;
  var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  renderSourceFilters(monitors);
  closeSourceModalDirect();
}

function addKeyword(wi,si){
  var inp=$('kwInput_'+wi+'_'+si);
  if(!inp)return;
  var kw=inp.value.trim();
  if(!kw)return;
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.config&&w.config.sources||w.sources||[];
  if(!srcs[si])return;
  if(!srcs[si].keywords)srcs[si].keywords=[];
  if(srcs[si].keywords.indexOf(kw)===-1)srcs[si].keywords.push(kw);
  renderSourceForm(wi,si);
}

function removeKeyword(wi,si,el){
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.config&&w.config.sources||w.sources||[];
  if(!srcs[si])return;
  var kwText=el.childNodes[0]?el.childNodes[0].textContent.replace('\u00d7','').trim():'';
  var kws=srcs[si].keywords||[];
  var ki=kws.indexOf(kwText);
  if(ki!==-1)kws.splice(ki,1);
  renderSourceForm(wi,si);
}

/* ===== UTILS ===== */
function escHtml(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function initDashboard(){
  renderSentimentGauge(52);
  renderKPITrend();
  updateBriefing();
  // 关键词云等数据加载后由 updateDashboard(data) 渲染，此处不填充默认词
}

function updateDashboard(data){
  var sentiment=Math.floor(Math.random()*40+40);
  renderSentimentGauge(sentiment);
  renderKeywordCloud(data);
  updateBriefing(data);
}

function renderSentimentGauge(value){
  var canvas=$('sentimentCanvas');
  if(!canvas)return;
  var ctx=canvas.getContext('2d');
  var w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  var cx=w/2,cy=h-10,r=Math.min(w/2-10,h-20);
  ctx.beginPath();
  ctx.arc(cx,cy,r,Math.PI,0,false);
  ctx.strokeStyle='rgba(255,255,255,0.1)';
  ctx.lineWidth=14;
  ctx.stroke();
  var endAngle=Math.PI+(value/100)*Math.PI;
  ctx.beginPath();
  ctx.arc(cx,cy,r,Math.PI,endAngle,false);
  var gradient=ctx.createLinearGradient(0,cy,w,0);
  gradient.addColorStop(0,'#00d4ff');
  gradient.addColorStop(1,'#a855f7');
  ctx.strokeStyle=gradient;
  ctx.lineWidth=14;
  ctx.lineCap='round';
  ctx.stroke();
  $('sentimentLabel').textContent=(value>60?'积极':value>40?'中性':'消极')+' '+value+'%';
}

function renderKeywordCloud(data){
  var container=$('keywordCloud');
  if(!container)return;
  var keywords=['AI','芯片','新能源','股价','财报','市场份额','技术创新','政策支持','竞争','风险'];
  if(data&&data.length>0){
    var kwCount={};
    data.forEach(function(item){(item.keywords||[]).forEach(function(kw){kwCount[kw]=(kwCount[kw]||0)+1})});
    keywords=Object.keys(kwCount).sort(function(a,b){return kwCount[b]-kwCount[a]}).slice(0,10);
  }
  var html='';
  keywords.forEach(function(kw,i){
    var cls=i<3?' important':'';
    html+='<span class="kw-cloud-item'+cls+'">'+escHtml(kw)+'</span>';
  });
  container.innerHTML=html;
}

function renderKPITrend(){
  var canvas=$('kpiCanvas');
  if(!canvas)return;
  var ctx=canvas.getContext('2d');
  // Match canvas pixel size to container width
  var container=canvas.parentElement;
  if(container){var cw=container.clientWidth||300;canvas.width=cw;canvas.style.width=cw+'px';}
  var w=canvas.width,h=canvas.height;
  var data=[];
  for(var i=0;i<12;i++)data.push(Math.random()*80+20);
  ctx.strokeStyle='rgba(255,255,255,0.05)';
  ctx.lineWidth=1;
  for(var i=0;i<4;i++){ctx.beginPath();ctx.moveTo(0,(h/4)*i);ctx.lineTo(w,(h/4)*i);ctx.stroke()}
  ctx.beginPath();
  data.forEach(function(v,i){
    var x=(w/(data.length-1))*i;
    var y=h-(v/100)*h;
    if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  });
  var gradient=ctx.createLinearGradient(0,0,w,0);
  gradient.addColorStop(0,'#00d4ff');
  gradient.addColorStop(1,'#a855f7');
  ctx.strokeStyle=gradient;
  ctx.lineWidth=2;
  ctx.stroke();
  ctx.lineTo(w,h);
  ctx.lineTo(0,h);
  ctx.closePath();
  var fillGradient=ctx.createLinearGradient(0,0,0,h);
  fillGradient.addColorStop(0,'rgba(0,212,255,0.1)');
  fillGradient.addColorStop(1,'rgba(0,212,255,0)');
  ctx.fillStyle=fillGradient;
  ctx.fill();
}

function updateBriefing(data){
  var container=$('briefingText');
  if(!container)return;
  var texts=[
    '&#x1F4CA; 基于当前情报分析，市场情绪偏向 <strong style="color:var(--cyan)">谨慎乐观</strong>',
    '&#x1F50D; 关键词 "<strong>AI</strong>" 提及率较上周上升 <strong style="color:#10b981">23%</strong>',
    '&#x26A0;&#xFE0F; 需关注 "<strong>政策</strong>" 相关动态，可能影响行业走势',
    '&#x1F4A1; 建议：持续监控竞争对手动向，关注技术创新趋势'
  ];
  if(data&&data.length>0){
    texts[0]='&#x1F4CA; 已分析 <strong style="color:var(--cyan)">'+data.length+'</strong> 条情报，覆盖多个信息源';
  }
  container.innerHTML=texts.map(function(t){return '<p>'+t+'</p>'}).join('');
}

/* ===== COMMAND CENTER ===== */
var aiChatHistory=[];
function sendCommand(){
  var input=$('cmdInput');
  if(!input)return;
  var cmd=input.value.trim();
  if(!cmd)return;
  if(currentCenterTab==='ai'){
    // AI 模式：发送AI消息
    input.value='';
    input.disabled=true;
    appendChatMessage('user',cmd);
    aiChatHistory.push({role:'user',content:cmd});
    var thinkId='think_'+Date.now();
    var thinkEl=document.createElement('div');
    thinkEl.className='ai-msg ai-msg-bot';
    thinkEl.id=thinkId;
    thinkEl.textContent='思考中...';
    $('aiChatMessages').appendChild(thinkEl);
    $('aiChatMessages').scrollTop=$('aiChatMessages').scrollHeight;
    try {
      fetch(API+'/api/ai-chat',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({message:cmd,history:aiChatHistory.slice(-10)})
      }).then(function(response){
        if(!response.ok)throw new Error('API error: '+response.status);
        return response.json();
      }).then(function(data){
        var reply=data.reply||data.data||data.text||'抱歉，AI暂时无法回复。';
        aiChatHistory.push({role:'assistant',content:reply});
        var el=document.getElementById(thinkId);
        if(el&&el.parentNode)el.parentNode.removeChild(el);
        appendChatMessage('bot',reply);
        input.disabled=false;
        input.focus();
      }).catch(function(e){
        var el=document.getElementById(thinkId);
        if(el&&el.parentNode)el.parentNode.removeChild(el);
        appendChatMessage('bot','抱歉，请求失败: '+e.message);
        input.disabled=false;
        input.focus();
      });
    } catch(e){
      var el=document.getElementById(thinkId);
      if(el&&el.parentNode)el.parentNode.removeChild(el);
      appendChatMessage('bot','抱歉，请求失败: '+e.message);
      input.disabled=false;
      input.focus();
    }
  } else {
    // 普通命令模式
    input.value='';
    alert('指令已发送: '+cmd+'\\n\\n(AI 命令中心功能开发中...)');
  }
}
function toggleMic(){alert('语音输入功能开发中...');}
function deployPortal(){alert('部署功能开发中...');}
</script>
</body>
</html>`;
}
