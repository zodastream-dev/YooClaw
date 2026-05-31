import express from 'express';
import cors from 'cors';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import fs from 'fs';
import { exec, spawn } from 'child_process';
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
  // MP Subscription
  subscribeMp,
  unsubscribeMp,
  getUserMpSubscriptions,
  getUserMpSubscriptionCount,
  getMpSubscriberCount,
  checkUserSubscribed,
  // WeRead Account Pool
  addWereadAccount,
  getWereadAccountByVid,
  updateWereadAccountFeedCount,
  getAllActiveWereadAccounts,
  setWereadAccountStatus,
  // Video Management
  saveVideo,
  getUserVideos,
  deleteVideo,
  getVideoById,
} from './db.js';

import { callIntel } from "./intel-pipeline.js";
import { generateIntelStationHtml } from './templates/intel-station/index.js';

import {
  TRIPLE_BACKTICK,
  PROMPT_REPORT_HTML,
  PROMPT_GAME_GENERATOR,
  PROMPT_RESEARCH_ANALYST,
  PROMPT_RESEARCH_WITH_SEARCH,
  PROMPT_DEEP_REPORT_HTML,
  PROMPT_AI_CHAT_SIMPLE,
  PROMPT_REPORT_DEFAULT,
  PROMPT_PORTAL_BUILDER_SYS,
  PROMPT_PORTAL_BUILDER_USER,
  PROMPT_REPORT_SYS_MSG,
  makeIntelPrompt,
  MAKE_REPORT_HTML_PROMPT,
  MAKE_GAME_HTML_PROMPT,
  MAKE_RESEARCH_PROMPT,
  MAKE_EXTERNAL_SEARCH_PROMPT,
  MAKE_REPORT_PROMPT,
  MAKE_DEFAULT_RESEARCH_PROMPT,
  MAKE_DEFAULT_REPORT_PROMPT,
} from './prompts.js';
import {
  klingCreate,
  klingQuery,
  klingWaitForVideo,
  klingDownloadVideo,
  saveKlingImage,
  type KlingVideoParams,
} from './kling.js';

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

// ========== WeWe-RSS Integration ==========
const WEWE_RSS_URL = process.env.WEWE_RSS_URL || 'http://127.0.0.1:4000';
const WEWE_RSS_AUTH = process.env.WEWE_RSS_AUTH_CODE || 'wewe-rss-admin-2024';

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
      '--host', '127.0.0.1',
      '--session-id', 'yooclaw',
      '--dangerously-skip-permissions',
    ], {
      stdio: 'pipe',
      env: { ...process.env, CODEBUDDY_API_KEY },
    });
    codebuddyProcess = proc;
    // Log startup output for diagnostics
    proc.stdout?.on('data', (d: Buffer) => console.log(`[CodeBuddy stdout] ${d.toString().trim()}`));
    proc.stderr?.on('data', (d: Buffer) => console.error(`[CodeBuddy stderr] ${d.toString().trim()}`));
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

  // 1. Remove markdown code fences (${TRIPLE_BACKTICK}html ... ${TRIPLE_BACKTICK})
  let html = raw
    .replace(/^${TRIPLE_BACKTICK}html\s*/i, '')
    .replace(/^${TRIPLE_BACKTICK}\s*/i, '')
    .replace(/${TRIPLE_BACKTICK}\s*$/i, '')
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
  // Map template to colorScheme for intel-station
  let colorScheme = 'tech-blue';
  if (template === 'intel-station-white-base' || template === 'white-base') {
    colorScheme = 'white-base';
  } else if (template === 'intel-station-sky-blue' || template === 'sky-blue') {
    colorScheme = 'sky-blue';
  }
  // All templates now use intel-station layout
  return generateIntelStationHtml(siteName, siteDesc, apiBase, slug, widgets, colorScheme);
  
  // Dead code below kept for reference - legacy templates no longer used
  
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
        objects: (s.objects || []).map((o: any) => ({ name: (o.name || '').replace(/'/g,'\\x27'), keywords: (o.keywords || []).map((k: string) => k.replace(/'/g,'\\x27')) })),
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

  const defaultSysPrompt = PROMPT_PORTAL_BUILDER_SYS;
  const defaultUserPrompt = PROMPT_PORTAL_BUILDER_USER;

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
var DEFAULT_TAVILY_KEY='${process.env.TAVILY_API_KEY || ""}';
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
      ['deepseek','metaso','tavily','multi-engine','wechat','weibo','zhihu','xiaohongshu','codebuddy','custom'].forEach(function(p){
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


// makeIntelPrompt 已迁移到 ./prompts.ts

async function fetchSourceIntel(src){
  var prompt=makeIntelPrompt(src.keywords,src.customPrompt);
  var provider=src.aiProvider||'deepseek';
  var apiKey=src.apiKey||(provider==='metaso'?DEFAULT_METASO_KEY:provider==='tavily'?DEFAULT_TAVILY_KEY:DEFAULT_DEEPSEEK_KEY)||'';
  var _kwArr=Array.isArray(src.keywords)?src.keywords:(typeof src.keywords==='string'?src.keywords.split(/[,，、]/).map(function(s){return s.trim()}).filter(Boolean):[]);
  var model=src.aiModel||'deepseek-v4-flash';
  if(!apiKey)throw new Error('未配置API Key');
  if(provider==='metaso'){
    var apiUrl='https://metaso.cn/api/open/search/v2';
    var msResponse=await fetch(apiUrl,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
      body:JSON.stringify({question:_kwArr.length>0?_kwArr.join(' OR '):src.name.split(/[、，, ]/)
.filter(Boolean).slice(0,3).join(' OR '),lang:'zh'})
    });
    if(!msResponse.ok){var msErr=await msResponse.text();throw new Error('秘塔API错误: '+msResponse.status+' '+msErr.substring(0,200))}
    var msData=await msResponse.json();
    var rawData=(msData.data&&msData.data.references)?msData.data.references:(msData.data||msData.results||msData.items||[]);
    var results=Array.isArray(rawData)?rawData:(rawData.results||rawData.items||rawData.references||[rawData]);
    return results.slice(0,10).map(function(r){return{title:r.title||r.name||'',summary:r.snippet||r.summary||r.content||r.aiSummary||'',source:r.url||r.link||r.source||'秘塔搜索',date:r.date||r.publishedAt||r.publishTime||'',link:r.url||r.link||''};});
  } else if(provider==='tavily'){
    var tQuery=_kwArr.length>0?_kwArr.join(' OR '):src.name.split(/[、，, ]/).filter(Boolean).slice(0,3).join(' OR ');
    var tResponse=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},body:JSON.stringify({query:tQuery,search_depth:'basic',max_results:10,topic:'news',include_answer:false})});
    if(!tResponse.ok){var tErr=await tResponse.text();throw new Error('Tavily API错误: '+tResponse.status+' '+tErr.substring(0,200))}
    var tData=await tResponse.json();
    return (tData.results||[]).slice(0,10).map(function(r){return{title:r.title||r.name||'',summary:r.content||r.snippet||'',source:r.url||r.link||'Tavily',date:r.published_date||'',link:r.url||r.link||''};});
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
  const prompt = MAKE_REPORT_HTML_PROMPT(companyName);

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
        { role: 'system', content: PROMPT_REPORT_HTML },
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
const prompt = MAKE_GAME_HTML_PROMPT(gameName);

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
        { role: 'system', content: PROMPT_GAME_GENERATOR },
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
    if (!h || !b || !s) { console.warn('[JWT] Token missing parts'); return null; }
    if (crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url') !== s) {
      console.warn('[JWT] Signature mismatch — token may be from a different secret or tampered');
      return null;
    }
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString()) as JwtPayload;
    return payload;
  } catch (e: any) {
    console.warn('[JWT] verifyToken error:', e.message);
    return null;
  }
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
app.use(express.json({ limit: "50mb" }));
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
        { role: 'system', content: PROMPT_RESEARCH_ANALYST },
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
      const researchPrompt = MAKE_RESEARCH_PROMPT(name, businessDesc);

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

        const externalSearchPrompt = MAKE_EXTERNAL_SEARCH_PROMPT(name, businessDesc);

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
              { role: 'system', content: PROMPT_RESEARCH_WITH_SEARCH },
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
      const reportPrompt = MAKE_REPORT_PROMPT(name, methods, perspectiveText, researchData, formData.businessDesc);

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
            { role: 'system', content: PROMPT_DEEP_REPORT_HTML },
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
        isPublished: s.is_published,
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
    } catch (e) {
      console.warn(`[Stream] Failed to get user message for ${runId}:`, (e as Error).message);
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
          { role: 'system', content: PROMPT_AI_CHAT_SIMPLE },
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

    const apiBase = process.env.API_URL || process.env.FRONTEND_URL
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

    const apiBase = process.env.API_URL || process.env.FRONTEND_URL
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

// Public redeploy from portal page (no auth — called by portal JS)
app.post('/api/portal-redeploy', async (req, res) => {
  try {
    const { slug } = req.body || {};
    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Slug is required' } });
    }

    const existing = await getReportSiteBySlug(slug, 'portal');
    if (!existing) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Portal not found' } });
    }

    console.log(`[Portal] Public redeploy for "${existing.title}" (slug: ${slug})`);

    const apiBase = process.env.API_URL || process.env.FRONTEND_URL
      || (req.get('host') ? `https://${req.get('host')}` : null)
      || `http://localhost:${APP_PORT}`;

    let widgets: any[] = [];
    try {
      const match = existing.html_content.match(/var WIDGETS=(\[[\s\S]*?\]);/);
      if (match) { widgets = JSON.parse(match[1]); }
    } catch (e) { /* keep empty */ }

    const htmlContent = generatePortalHtml(existing.title, '', 'intel-station', apiBase, slug, widgets);
    await createReportSite(existing.user_id, slug, existing.title, existing.title, htmlContent, 'portal', (existing as any).custom_domain || '');

    res.json({ data: { slug, title: existing.title, updated: true } });
  } catch (err: any) {
    console.error('[Portal Public Redeploy Error]', err.message);
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
    const systemMsg = sysPrompt || PROMPT_REPORT_DEFAULT;
    const defaultPrompt = MAKE_DEFAULT_RESEARCH_PROMPT(name, businessDesc, searchResults);
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
    const defaultReportPrompt = MAKE_DEFAULT_REPORT_PROMPT(name, methods, researchData);
    const reportUserPrompt = userPrompt
      ? `我正在研究"${name}"，请根据以下研究资料撰写分析报告。

研究资料:
${researchData || '（暂无）'}

用户要求：
${userPrompt.replace(/\{company\}/g, name).replace(/\{name\}/g, name)}

请用 HTML 格式输出，包含完整的 HTML 页面结构。`
      : defaultReportPrompt;
    const reportSysMsg = PROMPT_REPORT_SYS_MSG;
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
const pausedPortals = new Set<string>(); // Per-portal pause state (Set of paused portal slugs)

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
  const provider = src.aiProvider || 'deepseek';
  const apiKey = src.apiKey || (provider === 'metaso' ? process.env.METASO_API_KEY : provider === 'tavily' ? process.env.TAVILY_API_KEY : process.env.DEEPSEEK_API_KEY) || '';
  const model = src.aiModel || 'deepseek-v4-flash';
  if (!apiKey) throw new Error('未配置API Key');

  // -- Single-call helper: delegates to intel-pipeline --
  const callOnce = async (effectiveKwArr: string[], objectName?: string): Promise<any[]> => {
    return callIntel(effectiveKwArr, src, objectName);
  };

  // -- Objects expansion --
  const objects: Array<{ name: string; keywords?: string[] }> = src.objects || [];
  if (objects.length > 0) {
    const allResults: any[] = [];
    // Process objects in chunks of 4 for faster first load
    for (let i = 0; i < objects.length; i += 4) {
      const chunk = objects.slice(i, i + 4);
      const chunkResults = await Promise.allSettled(chunk.map(async (obj) => {
        const objKwArr = (obj.keywords && obj.keywords.length > 0) ? obj.keywords : kwArr;
        const data = await callOnce(objKwArr, obj.name);
        return data.map((item: any) => ({ ...item, _object: obj.name }));
      }));
      for (const r of chunkResults) {
        if (r.status === 'fulfilled') allResults.push(...r.value);
        else console.error('[fetchIntelForSource] Object failed:', r.reason?.message);
      }
    }
    return allResults;
  }

  // -- No objects: single call --
  return callOnce(kwArr);
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
      const cacheKey = JSON.stringify({ name: src.name, keywords: src.keywords, aiProvider: src.aiProvider, objects: src.objects });
      const cached = portalIntelCache.get(cacheKey);
      // Only serve from cache if non-empty (empty may be transient failure)
      if (cached && cached.expiry > now && Array.isArray(cached.data) && cached.data.length > 0) {
        return { sourceIdx: idx, data: cached.data, fromCache: true };
      }
      if (cached && cached.expiry > now && Array.isArray(cached.data) && cached.data.length === 0) {
        console.log(`[PortalIntel] Cached data is empty for "${src.name}", re-fetching...`);
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

// ========== POST/GET /api/portal-intel/pause ==========
// Per-portal pause/resume for background intel tasks (cache warmer).
// Each portal independently controls whether its sources are warmed.
app.get('/api/portal-intel/pause', (req, res) => {
  const slug = (req.query.slug as string) || '';
  if (slug) {
    res.json({ paused: pausedPortals.has(slug), pausedPortals: [...pausedPortals] });
  } else {
    res.json({ pausedPortals: [...pausedPortals] });
  }
});

app.post('/api/portal-intel/pause', (req, res) => {
  const { slug, pause } = req.body || {};
  if (slug && typeof pause === 'boolean') {
    if (pause) pausedPortals.add(slug);
    else pausedPortals.delete(slug);
    console.log(`[PortalIntel] Portal ${slug} ${pause ? 'PAUSED' : 'RESUMED'} (${pausedPortals.size} paused total)`);
  }
  res.json({ success: true, pausedPortals: [...pausedPortals] });
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

    // Collect unique sources across all portals, tracking which portals use each source
    const sourceMap = new Map<string, any>();
    const sourcePortals = new Map<string, Set<string>>(); // cacheKey → Set of portal slugs
    portalSites.forEach((site: any) => {
      const slug = site.slug;
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
                objects: src.objects,
              });
              if (!sourceMap.has(cacheKey)) {
                sourceMap.set(cacheKey, src);
                sourcePortals.set(cacheKey, new Set());
              }
              sourcePortals.get(cacheKey)!.add(slug);
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

    // Skip already-cached sources AND sources whose ALL portals are paused
    const now = Date.now();
    const toWarm: { key: string; src: any }[] = [];
    sourceMap.forEach((src, key) => {
      // Check if ALL portals using this source are paused
      const portals = sourcePortals.get(key);
      if (portals && portals.size > 0 && [...portals].every(p => pausedPortals.has(p))) {
        console.log(`[CacheWarmer] Skipping "${src.name}" — all portals paused (${[...portals].join(', ')})`);
        return;
      }
      const cached = portalIntelCache.get(key);
      const isEmpty = cached && Array.isArray(cached.data) && cached.data.length === 0;
      if (!cached || cached.expiry <= now || isEmpty) {
        if (isEmpty) console.log(`[CacheWarmer] Re-warming empty cache for: ${src.name || 'unnamed'}`);
        toWarm.push({ key, src });
      }
    });

    if (toWarm.length === 0) {
      console.log(`[CacheWarmer] All ${sourceMap.size} sources already cached, nothing to warm`);
      cacheWarmingActive = false;
      return;
    }

    console.log(`[CacheWarmer] Warming ${toWarm.length} sources (${sourceMap.size - toWarm.length}/${sourceMap.size} already cached) from ${portalSites.length} portals`);

    // Warm in chunks of 3
    let warmed = 0;
    let failed = 0;
    for (let i = 0; i < toWarm.length; i += 3) {
      const chunk = toWarm.slice(i, i + 3);
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

// AI Chat endpoint for portal AI assistant — transparent proxy through CodeBuddy CLI
app.post('/api/ai-chat', async (req, res) => {
  try {
    const { message, history, stream: useStream } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (!CODEBUDDY_API_KEY) {
      return res.status(500).json({ error: 'AI service not configured' });
    }

    // Build conversation context
    const chatHistory = Array.isArray(history) ? history.slice(-10) : [];
    const systemMsg = '你是一个集成在YooClaw情报门户中的AI助手。请用中文回答，简洁专业，使用Markdown格式呈现结构化内容。';
    let userMsg = message;
    if (chatHistory.length > 0) {
      const ctxParts = chatHistory.map((m: any) =>
        `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`
      ).join('\n');
      userMsg = `【对话历史】\n${ctxParts}\n\n【当前问题】\n${message}`;
    }

    if (useStream) {
      // SSE Streaming — proxy through CodeBuddy CLI
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const sendSSE = (data: any) => res.write('data: ' + JSON.stringify(data) + '\n\n');

      try {
        for await (const ev of streamCodebuddy(systemMsg, userMsg)) {
          if (ev.content) sendSSE({ token: ev.content });
        }
        sendSSE({ done: true });
        res.end();
      } catch (err: any) {
        console.error('[AiChat Stream Error]', err.message);
        try { sendSSE({ error: err.message }); res.end(); } catch { /* headers may be closed */ }
      }
    } else {
      // Non-streaming fallback
      const reply = await fetchCodebuddyNonStream(systemMsg, userMsg);
      res.json({ reply });
    }
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

    const apiBase = process.env.API_URL || process.env.FRONTEND_URL || `https://${req.get('host')}` || `http://localhost:${APP_PORT}`;
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


// In-memory video task store (survives across requests, reset on server restart)
const VALID_GEN_TYPES = ['text2video', 'image2video', 'multimodal2video', 'multiframe2video', 'frames2video', 'image_upscale', 'multi_clip'] as const;
const VALID_MODEL_VERSIONS = ['seedance2.0fast', 'seedance2.0', 'seedance2.0_vip', 'seedance2.0fast_vip', '3.0', '3.5pro'] as const;

interface VideoTask {
  submitId: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  genType: string;
  prompt: string;
  startTime: number;
  polls: number;
  videoUrl: string | null;
  userId: string;
  duration: string;
  resolution: string;
  ratio: string;
  modelVersion: string;
  tempImagePaths: string[]; // for cleanup (single or multi)
  queueInfo: any;
  errorMessage?: string;
}
const videoTasks = new Map<string, VideoTask>();

// Multi-clip task: tracks multiple parallel dreamina submissions + FFmpeg concat
interface ClipTask {
  index: number;
  submitId: string;
  prompt: string;
  duration: number;
  inputType: 'text' | 'image' | 'multi_image';
  imagePath: string | null; // temp image path for image2video clips (dreamina)
  imagePaths: string[] | null; // temp image paths for multiframe2video clips (dreamina)
  imageUrl: string | null; // public URL for kling image2video
  imageUrls: string[] | null; // public URLs for kling multi-image2video
  klingEndpoint: string | null; // kling endpoint for polling (text2video/image2video/multi-image2video)
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoPath: string | null; // local path after download
  cdnUrl: string | null;
}
interface MultiClipTask {
  parentId: string;
  clips: ClipTask[];
  ratio: string;
  resolution: string;
  modelVersion: string;
  startTime: number;
  status: 'processing' | 'concatenating' | 'completed' | 'failed' | 'cancelled';
  polls: number;
  videoUrl: string | null;
  userId: string;
  tempImagePaths: string[];
  queueInfo: any;
  errorMessage?: string;
  prompt: string; // combined title
  duration: string; // total duration
  genType: 'multi_clip';
  provider: 'dreamina' | 'kling';
  klingModel?: string;
  sound?: boolean;
}
const multiClipTasks = new Map<string, MultiClipTask>();

/** Build FFmpeg xfade crossfade filter for multi-clip concatenation */
function buildXfadeFilter(durations: number[], xfadeDuration: number = 1, fps: number = 24): string {
  const n = durations.length;
  const parts: string[] = [];

  // Normalize each input
  for (let i = 0; i < n; i++) {
    parts.push(`[${i}:v]settb=AVTB,fps=${fps},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
  }

  // Chain xfade
  let prevLabel = 'v0';
  const xfadeLen = xfadeDuration;
  for (let i = 1; i < n; i++) {
    // Cumulative duration of clips 0..i minus (i) * xfadeDuration gives the offset into the chained output
    let cumulativeSec = 0;
    for (let j = 0; j <= i; j++) cumulativeSec += durations[j];
    const offset = cumulativeSec - i * xfadeLen;
    const outLabel = i < n - 1 ? `x${i}` : 'outv';
    parts.push(`[${prevLabel}][v${i}]xfade=transition=fade:duration=${xfadeLen}:offset=${offset},format=yuv420p[${outLabel}]`);
    prevLabel = outLabel;
  }

  return parts.join(';');
}

/** Build ffmpeg concat command for multi-clip */
function buildConcatCommand(inputPaths: string[], durations: number[], outputPath: string): string {
  const xfadeFilter = buildXfadeFilter(durations, 1, 24);
  const inputs = inputPaths.map(p => `-i "${p}"`).join(' ');
  return `ffmpeg ${inputs} -filter_complex "${xfadeFilter}" -map "[outv]" -c:v libx264 -preset fast -crf 23 -an -y "${outputPath}"`;
}

/** Save a base64 image string to a temp file, return the file path */
function saveBase64TempImage(base64Str: string, prefix: string): string {
  const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, '');
  const ext = (base64Str.match(/^data:image\/(\w+);base64,/) || [])[1] || 'png';
  const tmpPath = path.join('/tmp', `${prefix}-${crypto.randomUUID()}.${ext}`);
  fs.writeFileSync(tmpPath, Buffer.from(base64Data, 'base64'));
  console.log(`[VideoGen] Saved temp image: ${tmpPath} (${(base64Data.length / 1024).toFixed(1)} KB)`);
  return tmpPath;
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

// Kling image upload — accept base64, save to kling-imgs/, return public URL
app.post('/api/v1/images/upload', authMiddleware, (req, res) => {
  const { image } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '需要 base64 图片' } });
  }
  const result = saveKlingImage(image);
  if (!result) {
    return res.status(500).json({ error: { code: 'UPLOAD_FAILED', message: '图片保存失败' } });
  }
  res.json({ data: { url: result.url } });
});

// Multi-type generation (video, image upscale, etc.)
// Two-phase: Phase 1 submits with --poll=0, Phase 2 polls query_result in background
app.post('/api/v1/videos/generate', authMiddleware, async (req, res) => {
  try {
    const { genType, modelVersion, prompt, duration, resolution, ratio, image, images, transitionPrompts, transitionDurations, clips } = req.body || {};
    const user = (req as any).user;

    // Determine generation type
    const gt = (genType && VALID_GEN_TYPES.includes(genType)) ? genType : (image || images ? 'image2video' : 'text2video');

    // ===== Multi-clip: session video generation with FFmpeg concat =====
    if (gt === 'multi_clip') {
      const prov = ((req.body as any).provider === 'kling' ? 'kling' : 'dreamina') as 'dreamina' | 'kling';
      const klingModel = (req.body as any).klingModel || 'kling-v3';
      const klingSound = !!(req.body as any).sound;

      const clipArray: { prompt: string; duration: number; inputType?: 'text' | 'image' | 'multi_image'; image?: string; images?: string[] }[] = clips || [];
      if (!Array.isArray(clipArray) || clipArray.length < 2) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '至少需要 2 个片段' } });
      }
      if (clipArray.length > 6) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '最多支持 6 个片段' } });
      }
      // Kling multi-image limit: 2-5 images (vs dreamina's 2-20)
      const multiImageMax = prov === 'kling' ? 5 : 20;
      const durMin = prov === 'kling' ? 5 : 3;
      const durMax = prov === 'kling'
        ? (klingModel === 'kling-v1-6' ? 20 : (klingModel === 'kling-v3' || klingModel === 'kling-v3-omni' ? 15 : 10))
        : 15;
      for (let i = 0; i < clipArray.length; i++) {
        const c = clipArray[i];
        const clipInputType = c.inputType === 'multi_image' ? 'multi_image' : (c.inputType === 'image' ? 'image' : 'text');
        if (clipInputType === 'text' && (!c.prompt || typeof c.prompt !== 'string' || !c.prompt.trim())) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: `片段 ${i + 1} 需要输入提示词` } });
        }
        if (clipInputType === 'image' && !c.image) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: `片段 ${i + 1} 图生模式需要上传图片` } });
        }
        if (clipInputType === 'multi_image') {
          if (!c.images || !Array.isArray(c.images) || c.images.length < 2) {
            return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: `片段 ${i + 1} 多图模式需要至少 2 张图片` } });
          }
          if (c.images.length > multiImageMax) {
            return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: `片段 ${i + 1} 多图模式最多 ${multiImageMax} 张图片` } });
          }
        }
        const d = Number(c.duration) || 5;
        if (d < durMin || d > durMax) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: `片段 ${i + 1} 时长需在 ${durMin}-${durMax} 秒之间` } });
        }
        // Save images — dreamina: temp files; kling: uploaded to public dir
        let imagePath: string | null = null;
        let imagePaths: string[] | null = null;
        let imageUrl: string | null = null;
        let imageUrls: string[] | null = null;
        if (clipInputType === 'image' && c.image) {
          if (prov === 'kling') {
            const result = saveKlingImage(c.image, `mc-kl`);
            if (!result) return res.status(500).json({ error: { code: 'UPLOAD_FAILED', message: '图片上传失败' } });
            imageUrl = result.url;
          } else {
            const imgBuf = Buffer.from(c.image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            const imgFn = `mc-img-${crypto.randomUUID().slice(0, 8)}.png`;
            imagePath = path.join('/tmp', imgFn);
            fs.writeFileSync(imagePath, imgBuf);
          }
        }
        if (clipInputType === 'multi_image' && c.images) {
          if (prov === 'kling') {
            imageUrls = c.images.map((img: string) => {
              const result = saveKlingImage(img, 'mc-kl');
              if (!result) throw new Error('Multi-image upload failed');
              return result.url;
            });
          } else {
            imagePaths = c.images.map((img: string) => {
              const imgBuf = Buffer.from(img.replace(/^data:image\/\w+;base64,/, ''), 'base64');
              const imgFn = `mc-mi-${crypto.randomUUID().slice(0, 8)}.png`;
              const p = path.join('/tmp', imgFn);
              fs.writeFileSync(p, imgBuf);
              return p;
            });
          }
        }
        clipArray[i] = { prompt: c.prompt?.trim() || '', duration: d, inputType: clipInputType, image: c.image || null, imagePath, images: c.images || null, imagePaths, imageUrl, imageUrls };
      }

      const mv = (modelVersion && VALID_MODEL_VERSIONS.includes(modelVersion)) ? modelVersion : 'seedance2.0fast';
      const reso = resolution || '720p';
      const rat = ratio || '16:9';
      const parentId = crypto.randomUUID();
      const totalDur = clipArray.reduce((sum, c) => sum + c.duration, 0);
      const combinedPrompt = clipArray.map((c, i) => `片段${i + 1}: ${c.prompt.slice(0, 50)}`).join(' | ');

      // Create clip tasks (not yet submitted)
      const clipTasks: ClipTask[] = clipArray.map((c: any, i) => ({
        index: i,
        submitId: '',
        prompt: c.prompt,
        duration: c.duration,
        inputType: c.inputType || 'text',
        imagePath: c.imagePath || null,
        imagePaths: c.imagePaths || null,
        imageUrl: c.imageUrl || null,
        imageUrls: c.imageUrls || null,
        klingEndpoint: null,
        status: 'pending' as const,
        videoPath: null,
        cdnUrl: null,
      }));

      const task: MultiClipTask = {
        parentId,
        clips: clipTasks,
        ratio: rat,
        resolution: reso,
        modelVersion: mv,
        startTime: Date.now(),
        status: 'processing',
        polls: 0,
        videoUrl: null,
        userId: user.userId,
        tempImagePaths: [],
        queueInfo: null,
        prompt: combinedPrompt,
        duration: String(totalDur),
        genType: 'multi_clip',
        provider: prov,
        klingModel: prov === 'kling' ? klingModel : undefined,
        sound: prov === 'kling' ? klingSound : undefined,
      };
      multiClipTasks.set(parentId, task);

      // Return immediately
      res.json({ data: { id: parentId, title: `长视频 ${totalDur}秒`, status: 'processing', totalClips: clipArray.length } });

      // Background: submit clips, poll, concat
      const FRONTEND_URL = process.env.FRONTEND_URL || 'https://yooclaw.yookeer.com';
      (async () => {
        try {
          if (prov === 'kling') {
            // ===== KLING MULTI-CLIP FLOW =====
            const model = klingModel;
            const soundVal = klingSound ? 'on' : 'off';
            const modeVal: 'std' | 'pro' = 'pro';

            // Phase A: Submit all clips to Kling API
            for (let i = 0; i < task.clips.length; i++) {
              const clip = task.clips[i];
              if (task.status === 'cancelled') return;
              clip.status = 'processing';

              try {
                let endpoint = '';
                const baseParams: KlingVideoParams = { model_name: model, mode: modeVal, sound: soundVal };
                if (clip.inputType === 'multi_image' && clip.imageUrls && clip.imageUrls.length >= 2) {
                  endpoint = 'multi-image2video';
                  const { task_id } = await klingCreate(endpoint, {
                    ...baseParams,
                    image_list: clip.imageUrls.map(url => ({ image: url })),
                    prompt: clip.prompt,
                    duration: String(clip.duration),
                  });
                  clip.submitId = task_id;
                  clip.klingEndpoint = endpoint;
                } else if (clip.inputType === 'image' && clip.imageUrl) {
                  endpoint = 'image2video';
                  const { task_id } = await klingCreate(endpoint, {
                    ...baseParams,
                    image: clip.imageUrl,
                    prompt: clip.prompt,
                    duration: String(clip.duration),
                  });
                  clip.submitId = task_id;
                  clip.klingEndpoint = endpoint;
                } else {
                  endpoint = 'text2video';
                  const { task_id } = await klingCreate(endpoint, {
                    ...baseParams,
                    prompt: clip.prompt,
                    duration: String(clip.duration),
                    aspect_ratio: rat,
                  });
                  clip.submitId = task_id;
                  clip.klingEndpoint = endpoint;
                }
                console.log(`[MultiClip:Kling] Clip ${i + 1}/${task.clips.length} submitted: ${clip.submitId.slice(0, 12)}...`);
              } catch (subErr: any) {
                console.error(`[MultiClip:Kling] Submit ${i + 1} failed:`, subErr.message);
                clip.status = 'failed';
                task.status = 'failed';
                task.errorMessage = `片段 ${i + 1} 提交失败: ${subErr.message}`;
                return;
              }

              if (i < task.clips.length - 1) {
                await new Promise(r => setTimeout(r, 2000)); // 2s gap
              }
            }

            // Phase B: Poll all Kling clips (10s interval, max 60 polls = 10 min)
            const KLING_MAX_POLLS = 60;
            for (let poll = 0; poll < KLING_MAX_POLLS; poll++) {
              if (task.status === 'cancelled') return;
              task.polls = poll + 1;
              await new Promise(r => setTimeout(r, 10000)); // 10s

              let allDone = true;
              let anyFailed = false;

              for (const clip of task.clips) {
                if (clip.status === 'completed' || clip.status === 'failed') continue;
                allDone = false;

                try {
                  const result = await klingQuery(clip.klingEndpoint || 'text2video', clip.submitId);
                  const taskStatus = result.data?.task_status;
                  console.log(`[MultiClip:Kling] Poll ${poll + 1} clip ${clip.index + 1}: ${taskStatus}`);

                  if (taskStatus === 'succeed') {
                    const videos = result.data?.task_result?.videos || [];
                    const videoUrl = videos[0]?.url || '';
                    if (videoUrl) {
                      const ext = '.mp4';
                      const localFn = `mc-kl-${parentId.slice(0, 8)}-${clip.index}${ext}`;
                      const lp = path.join('/tmp', localFn);
                      const ok = await klingDownloadVideo(videoUrl, lp);
                      if (ok) {
                        clip.videoPath = lp;
                      }
                      clip.cdnUrl = videoUrl;
                    }
                    clip.status = 'completed';
                  } else if (taskStatus === 'failed') {
                    clip.status = 'failed';
                    anyFailed = true;
                    console.error(`[MultiClip:Kling] Clip ${clip.index + 1} failed: ${result.data?.task_status_msg}`);
                  }
                } catch (pollErr: any) {
                  console.warn(`[MultiClip:Kling] Poll clip ${clip.index + 1} error:`, (pollErr as any).message?.slice(0, 100));
                }
              }

              if (anyFailed) {
                task.status = 'failed';
                task.errorMessage = '部分片段生成失败（可灵）';
                return;
              }
              if (allDone) break;
            }

          } else {
            // ===== DREAMINA MULTI-CLIP FLOW (existing) =====
          for (let i = 0; i < task.clips.length; i++) {
            const clip = task.clips[i];
            if (task.status === 'cancelled') return;
            clip.status = 'processing';
            const escP = (clip.prompt || '').replace(/"/g, '\\"');
            let cmd = '';
            if (clip.inputType === 'multi_image' && clip.imagePaths && clip.imagePaths.length >= 2) {
              const imgList = clip.imagePaths.join(',');
              if (clip.imagePaths.length === 2) {
                // 2 images: shorthand --prompt + --duration
                cmd = `${DREAMINA_BIN} multiframe2video --images ${imgList} --prompt="${escP}" --duration=${clip.duration} --poll=0`;
              } else {
                // 3+ images: --transition-prompt per transition (N-1), distribute duration evenly
                const numTransitions = clip.imagePaths.length - 1;
                const durPerTrans = Math.max(0.5, Number((clip.duration / numTransitions).toFixed(1)));
                const tpFlags = Array(numTransitions).fill(`--transition-prompt="${escP}"`).join(' ');
                const tdFlags = Array(numTransitions).fill(`--transition-duration=${durPerTrans}`).join(' ');
                cmd = `${DREAMINA_BIN} multiframe2video --images ${imgList} ${tpFlags} ${tdFlags} --poll=0`;
              }
            } else if (clip.inputType === 'image' && clip.imagePath) {
              cmd = `${DREAMINA_BIN} image2video --image="${clip.imagePath}" --prompt="${escP}" --duration=${clip.duration} --video_resolution=${reso} --model_version=${mv} --poll=0`;
            } else {
              cmd = `${DREAMINA_BIN} text2video --prompt="${escP}" --duration=${clip.duration} --ratio=${rat} --video_resolution=${reso} --model_version=${mv} --poll=0`;
            }
            console.log(`[MultiClip] Submitting clip ${i + 1}/${task.clips.length}:`, cmd.slice(0, 150));

            let submitOut = '';
            try {
              const { stdout } = await execAsync(cmd + ' 2>&1', { timeout: 60000, maxBuffer: 1024 * 1024, cwd: '/tmp' });
              submitOut = stdout;
            } catch (execErr: any) {
              submitOut = execErr.stdout || execErr.stderr || '';
              console.error(`[MultiClip] Submit ${i + 1} failed:`, execErr.message);
              if (submitOut) console.error(`[MultiClip] Submit ${i + 1} output:`, submitOut.slice(0, 500));
            }

            const jsonMatch = submitOut.match(/\{[\s\S]*\}/);
            let sid = '';
            if (jsonMatch) {
              try { const p = JSON.parse(jsonMatch[0]); sid = p.submit_id || ''; } catch {}
            }
            if (!sid) {
              clip.status = 'failed';
              console.error(`[MultiClip] Clip ${i + 1}: no submit_id`);
              task.status = 'failed';
              task.errorMessage = `片段 ${i + 1} 提交失败`;
              return;
            }
            clip.submitId = sid;
            console.log(`[MultiClip] Clip ${i + 1} submitted: ${sid.slice(0, 12)}...`);

            if (i < task.clips.length - 1) {
              await new Promise(r => setTimeout(r, 2000)); // 2s gap
            }
          }

          // Phase B: Poll all clips (every 3 min, up to 120 polls = 6 hr)
          const MAX_POLLS = 120;
          for (let poll = 0; poll < MAX_POLLS; poll++) {
            if (task.status === 'cancelled') return;
            task.polls = poll + 1;
            await new Promise(r => setTimeout(r, 180000)); // 3 min

            let allDone = true;
            let anyFailed = false;

            for (const clip of task.clips) {
              if (clip.status === 'completed' || clip.status === 'failed') continue;
              allDone = false;

              try {
                const qCmd = `${DREAMINA_BIN} query_result --submit_id=${clip.submitId}`;
                const { stdout: qOut } = await execAsync(qCmd + ' 2>&1', { timeout: 30000, maxBuffer: 1024 * 1024, cwd: '/tmp' });
                let result: any;
                try { result = JSON.parse(qOut); } catch { continue; }

                if (result?.queue_info) task.queueInfo = result.queue_info;
                console.log(`[MultiClip] Poll ${poll + 1} clip ${clip.index + 1}: gen_status=${result.gen_status}`);

                if (result.gen_status === 'success') {
                  const videos = result.result_json?.videos || [];
                  const cdnUrl = videos[0]?.video_url || '';
                  if (cdnUrl) {
                    try {
                      const d = await fetch(cdnUrl, { signal: AbortSignal.timeout(120000) as any });
                      if (d.ok) {
                        const buf = Buffer.from(await d.arrayBuffer());
                        const ext = (cdnUrl.match(/\.(mp4|webm|mov)/i) || ['.mp4'])[0];
                        const localFn = `mc-${parentId.slice(0, 8)}-${clip.index}${ext}`;
                        const lp = path.join('/tmp', localFn);
                        fs.writeFileSync(lp, buf);
                        clip.videoPath = lp;
                        clip.cdnUrl = cdnUrl;
                        console.log(`[MultiClip] Downloaded clip ${clip.index + 1}: ${localFn} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
                      } else {
                        clip.cdnUrl = cdnUrl;
                      }
                    } catch (dlErr: any) {
                      console.warn(`[MultiClip] Download clip ${clip.index + 1} failed:`, dlErr.message);
                      clip.cdnUrl = cdnUrl;
                    }
                  }
                  clip.status = 'completed';
                } else if (result.gen_status === 'fail') {
                  clip.status = 'failed';
                  anyFailed = true;
                }
              } catch (pollErr: any) {
                // Retry on transient errors
                console.warn(`[MultiClip] Poll clip ${clip.index + 1} error:`, (pollErr as any).message?.slice(0, 100));
              }
            }

            if (anyFailed) {
              task.status = 'failed';
              task.errorMessage = '部分片段生成失败';
              return;
            }
            if (allDone) break;
          }

          } // end kling if / dreamina else

          // Check all completed (shared)
          const allCompleted = task.clips.every(c => c.status === 'completed');
          if (!allCompleted) {
            task.status = 'failed';
            task.errorMessage = '部分片段超时未完成';
            return;
          }

          // ===== Phase C: FFmpeg concat (shared by both providers) =====
          task.status = 'concatenating';
          console.log(`[MultiClip] Starting FFmpeg concat for ${task.clips.length} clips...`);

          // Build input paths (use downloaded files, fallback to CDN URLs)
          const inputPaths: string[] = [];
          const useCDNFallback: string[] = []; // CDN URLs if local not available
          for (const clip of task.clips) {
            if (clip.videoPath && fs.existsSync(clip.videoPath)) {
              inputPaths.push(clip.videoPath);
            } else if (clip.cdnUrl) {
              // Download from CDN as fallback
              try {
                const d = await fetch(clip.cdnUrl, { signal: AbortSignal.timeout(120000) as any });
                if (d.ok) {
                  const buf = Buffer.from(await d.arrayBuffer());
                  const lp = path.join('/tmp', `mc-fb-${parentId.slice(0, 8)}-${clip.index}.mp4`);
                  fs.writeFileSync(lp, buf);
                  inputPaths.push(lp);
                } else {
                  useCDNFallback.push(clip.cdnUrl);
                }
              } catch {
                useCDNFallback.push(clip.cdnUrl);
              }
            } else {
              task.status = 'failed';
              task.errorMessage = `片段 ${clip.index + 1} 无可用视频`;
              return;
            }
          }

          if (inputPaths.length < 2) {
            task.status = 'failed';
            task.errorMessage = '可用于拼接的片段不足';
            return;
          }

          // Probe actual video durations (dreamina may generate different length than requested)
          const durations: number[] = [];
          for (let i = 0; i < inputPaths.length; i++) {
            try {
              const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPaths[i]}"`, { timeout: 10000 });
              const d = parseFloat(stdout.trim());
              durations.push(d > 0 ? d : task.clips[i].duration);
              console.log(`[MultiClip] Clip ${i} actual duration: ${d.toFixed(2)}s (requested: ${task.clips[i].duration}s)`);
            } catch {
              durations.push(task.clips[i].duration); // fallback to requested
            }
          }

          const outputFn = `multi-${parentId.slice(0, 10)}.mp4`;
          const outputPath = path.join(VIDEO_DIR, outputFn);
          const concatCmd = buildConcatCommand(inputPaths, durations, outputPath);

          console.log(`[MultiClip] FFmpeg command: ${concatCmd.slice(0, 200)}...`);
          try {
            await execAsync(concatCmd, { timeout: 300000, maxBuffer: 10 * 1024 * 1024, cwd: '/tmp' });
          } catch (ffErr: any) {
            console.error(`[MultiClip] FFmpeg failed:`, ffErr.message);
            // Log ffmpeg stderr from caught error
            if ((ffErr as any).stderr) console.error(`[MultiClip] FFmpeg stderr:`, (ffErr as any).stderr.slice(-500));
            task.status = 'failed';
            task.errorMessage = '视频拼接失败，请重试';
            return;
          }

          if (!fs.existsSync(outputPath)) {
            task.status = 'failed';
            task.errorMessage = '拼接输出文件未生成';
            return;
          }

          const stats = fs.statSync(outputPath);
          console.log(`[MultiClip] Concatenated video: ${outputFn} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
          task.videoUrl = `${FRONTEND_URL}/videos/${outputFn}`;
          task.status = 'completed';

          // Save to DB
          try {
            await saveVideo({
              userId: task.userId,
              title: `长视频 ${task.duration}秒`,
              prompt: task.prompt,
              duration: task.duration,
              resolution: task.resolution,
              ratio: task.ratio,
              inputType: 'multi_clip',
              videoUrl: task.videoUrl,
              videoPath: outputPath,
              submitId: parentId,
            });
          } catch (dbErr: any) { console.error('[MultiClip] DB save failed:', dbErr.message); }

          // Clean up temp files
          for (const clip of task.clips) {
            if (clip.videoPath) { try { fs.unlinkSync(clip.videoPath); } catch {} }
            if (clip.imagePath) { try { fs.unlinkSync(clip.imagePath); } catch {} }
            if (clip.imagePaths) { clip.imagePaths.forEach(p => { try { fs.unlinkSync(p); } catch {} }); }
          }
        } catch (err: any) {
          console.error('[MultiClip] Background error:', err.message);
          if (task.status === 'processing' || task.status === 'concatenating') {
            task.status = 'failed';
            task.errorMessage = '视频生成异常';
          }
        }
      })();
      return; // Early return for multi_clip
    }

    const mv = (modelVersion && VALID_MODEL_VERSIONS.includes(modelVersion)) ? modelVersion : 'seedance2.0fast';
    const dur = Number(duration) || 5;
    const reso = resolution || '720p';
    const rat = ratio || '16:9';
    const promptStr = (prompt && typeof prompt === 'string') ? prompt.trim() : '';

    // Validate prompt for types that need it
    const needsPrompt = ['text2video', 'image2video', 'multimodal2video', 'frames2video'].includes(gt);
    if (needsPrompt && !promptStr) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Prompt is required for this generation type' } });
    }

    // Parse images array or single image
    const imageList: string[] = [];
    if (images && Array.isArray(images)) {
      for (const img of images) {
        if (typeof img === 'string' && img) imageList.push(img);
      }
    } else if (image && typeof image === 'string') {
      imageList.push(image);
    }

    // Validate image count per type
    const minImages: Record<string, number> = {
      image2video: 1, multimodal2video: 1, multiframe2video: 2, frames2video: 2, image_upscale: 1,
    };
    const maxImages: Record<string, number> = {
      image2video: 1, multimodal2video: 9, multiframe2video: 20, frames2video: 2, image_upscale: 1,
    };
    if (minImages[gt] && imageList.length < minImages[gt]) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: `${gt} requires at least ${minImages[gt]} image(s)` } });
    }
    if (maxImages[gt] && imageList.length > maxImages[gt]) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: `${gt} supports at most ${maxImages[gt]} image(s)` } });
    }

    // Save all images to temp files (dreamina only; Kling uses URLs)
    const tempPaths: string[] = [];
    const singleProv = ((req.body as any).provider === 'kling' ? 'kling' : 'dreamina') as 'dreamina' | 'kling';

    if (singleProv === 'kling') {
      // ===== KLING SINGLE VIDEO FLOW =====
      const klingSingleModel = (req.body as any).klingModel || 'kling-v3';
      const klingSingleSound = !!(req.body as any).sound;
      const klingSingleMode: 'std' | 'pro' = 'pro';
      const negPrompt = (req.body as any).negativePrompt || '';

      // Map genType to Kling endpoint
      const klingEndpoint = gt === 'multi_image2video' ? 'multi-image2video'
        : (gt === 'image2video' ? 'image2video' : 'text2video');

      // Build params
      const klingParams: KlingVideoParams = {
        model_name: klingSingleModel,
        mode: klingSingleMode,
        sound: klingSingleSound ? 'on' : 'off',
        duration: String(dur),
        aspect_ratio: rat,
        negative_prompt: negPrompt,
      };

      if (gt === 'image2video' || gt === 'multi_image2video') {
        if (imageList.length === 0) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '需要上传图片' } });
        }
        // Upload images to kling-imgs first
        const urls: string[] = [];
        for (const img of imageList) {
          const result = saveKlingImage(img, 'single-kl');
          if (!result) return res.status(500).json({ error: { code: 'UPLOAD_FAILED', message: '图片上传失败' } });
          urls.push(result.url);
        }
        if (gt === 'multi_image2video') {
          klingParams.image_list = urls.map(url => ({ image: url }));
        } else {
          klingParams.image = urls[0];
        }
        if (promptStr) klingParams.prompt = promptStr;
      } else {
        klingParams.prompt = promptStr;
      }

      // Camera control
      const cc = (req.body as any).cameraControl;
      if (cc && cc.type) klingParams.camera_control = cc;

      try {
        const { task_id: klingTaskId } = await klingCreate(klingEndpoint, klingParams);
        const parentId = crypto.randomUUID();
        const klingTask: VideoTask = {
          id: parentId,
          submitId: klingTaskId,
          prompt: promptStr,
          genType: gt,
          modelVersion: klingSingleModel,
          duration: String(dur),
          resolution: reso,
          ratio: rat,
          image: imageList.length > 0 ? 'kling' : null,
          startTime: Date.now(),
          status: 'processing',
          polls: 0,
          queueInfo: null,
          videoUrl: null,
          tempImagePaths: [],
        };
        videoTasks.set(parentId, klingTask);

        res.json({ data: { id: parentId, title: promptStr.slice(0, 50) || '视频生成', url: '', status: 'processing' } });

        // Background: poll Kling, download, save
        (async () => {
          try {
            const videoUrl = await klingWaitForVideo(klingEndpoint, klingTaskId, 10000, 60);
            if (!videoUrl) {
              klingTask.status = 'failed';
              return;
            }
            const outputFn = `kling-${klingTaskId.slice(0, 10)}.mp4`;
            const outputPath = path.join(VIDEO_DIR, outputFn);
            const ok = await klingDownloadVideo(videoUrl, outputPath);
            if (!ok) {
              klingTask.status = 'failed';
              return;
            }
            klingTask.videoUrl = `${FRONTEND_URL}/videos/${outputFn}`;
            klingTask.status = 'completed';

            try {
              await saveVideo({
                userId: user.userId,
                title: promptStr.slice(0, 100) || 'Kling 视频',
                prompt: promptStr,
                duration: String(dur),
                resolution: reso,
                ratio: rat,
                inputType: gt,
                videoUrl: klingTask.videoUrl,
                videoPath: outputPath,
                submitId: parentId,
              });
            } catch (dbErr: any) { console.error('[Kling:Single] DB save failed:', dbErr.message); }
          } catch (err: any) {
            console.error('[Kling:Single] Background error:', err.message);
            klingTask.status = 'failed';
          }
        })();
        return;
      } catch (klingErr: any) {
        console.error('[Kling:Single] Create failed:', klingErr.message);
        return res.status(500).json({ error: { code: 'GENERATE_FAILED', message: `Kling API: ${klingErr.message}` } });
      }
    }

    // Dreamina flow continues
    for (let i = 0; i < imageList.length; i++) {
      tempPaths.push(saveBase64TempImage(imageList[i], `gen-${gt}`));
    }

    // Build dreamina command
    let submitCmd: string;
    const escPrompt = promptStr.replace(/"/g, '\\"');
    switch (gt) {
      case 'text2video':
        submitCmd = `${DREAMINA_BIN} text2video --prompt="${escPrompt}" --duration=${dur} --ratio=${rat} --video_resolution=${reso} --model_version=${mv} --poll=0`;
        break;
      case 'image2video':
        submitCmd = `${DREAMINA_BIN} image2video --image="${tempPaths[0]}" --prompt="${escPrompt}" --duration=${dur} --video_resolution=${reso} --model_version=${mv} --poll=0`;
        break;
      case 'multimodal2video': {
        const imgFlags = tempPaths.map(p => `--image "${p}"`).join(' ');
        submitCmd = `${DREAMINA_BIN} multimodal2video ${imgFlags} --prompt="${escPrompt}" --duration=${dur} --ratio=${rat} --video_resolution=${reso} --model_version=${mv} --poll=0`;
        break;
      }
      case 'multiframe2video': {
        const imgList = tempPaths.join(',');
        if (tempPaths.length === 2 && !transitionPrompts?.length) {
          submitCmd = `${DREAMINA_BIN} multiframe2video --images ${imgList} --prompt="${escPrompt}" --duration=${dur} --poll=0`;
        } else {
          const tpFlags = (transitionPrompts || []).map((tp: string) => `--transition-prompt "${tp.replace(/"/g, '\\"')}"`).join(' ');
          const tdFlags = (transitionDurations || []).map((td: string) => `--transition-duration "${td}"`).join(' ');
          submitCmd = `${DREAMINA_BIN} multiframe2video --images ${imgList} ${tpFlags} ${tdFlags} --poll=0`;
        }
        break;
      }
      case 'frames2video':
        submitCmd = `${DREAMINA_BIN} frames2video --first="${tempPaths[0]}" --last="${tempPaths[1]}" --prompt="${escPrompt}" --duration=${dur} --model_version=${mv} --poll=0`;
        break;
      case 'image_upscale':
        submitCmd = `${DREAMINA_BIN} image_upscale --image="${tempPaths[0]}" --resolution_type=2k --poll=0`;
        break;
      default:
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: `Unsupported generation type: ${gt}` } });
    }

    console.log(`[VideoGen] ${gt} submit:`, submitCmd.slice(0, 200));

    // Execute dreamina CLI; if it exits non-zero, still try to recover submit_id from stdout
    let submitOut = '';
    try {
      const { stdout } = await execAsync(submitCmd + ' 2>&1', { timeout: 60000, maxBuffer: 1024 * 1024, cwd: '/tmp' });
      submitOut = stdout;
    } catch (execErr: any) {
      submitOut = execErr.stdout || '';
      console.error(`[VideoGen] Submit command exited non-zero:`, execErr.message);
      if (submitOut) console.error(`[VideoGen] stdout from failed command:`, submitOut.slice(0, 500));
    }
    console.log('[VideoGen] Submit response:', submitOut.slice(0, 300));

    // Extract submit_id and check for errors
    let submitId = '';
    let submitFailReason = '';
    let submitLogId = '';
    const jsonMatch = submitOut.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        submitId = parsed.submit_id || '';
        submitFailReason = parsed.fail_reason || '';
        submitLogId = parsed.logid || '';
      } catch {}
    }
    if (!submitId) {
      for (const p of tempPaths) { try { fs.unlinkSync(p); } catch {} }
      console.error(`[VideoGen] No submit_id in output:`, submitOut.slice(0, 500));
      return res.status(500).json({ error: { code: 'GENERATE_FAILED', message: '视频生成服务暂时不可用，请稍后重试' } });
    }
    // Check if submit failed (dreamina returned fail_reason or no logid)
    if (submitFailReason) {
      console.error(`[VideoGen] Submit failed for ${submitId}: ${submitFailReason}`);
      for (const p of tempPaths) { try { fs.unlinkSync(p); } catch {} }
      return res.status(500).json({ error: { code: 'SUBMIT_FAILED', message: submitFailReason || '图片上传失败，请重试' } });
    }
    if (!submitLogId && gt !== 'text2video') {
      console.warn(`[VideoGen] Submit ${submitId} missing logid — task may not be properly registered`);
      // Still accept but log warning; text2video sometimes omits logid
    }

    // Store task in memory
    const task: VideoTask = {
      submitId,
      status: 'processing',
      genType: gt,
      prompt: promptStr,
      startTime: Date.now(),
      polls: 0,
      videoUrl: null,
      userId: user.userId,
      duration: String(dur),
      resolution: reso,
      ratio: rat,
      modelVersion: mv,
      tempImagePaths: tempPaths,
      queueInfo: null,
    };
    videoTasks.set(submitId, task);

    // Return immediately to frontend
    res.json({ data: { id: submitId, title: promptStr.slice(0, 30), status: 'processing' } });

    // Phase 2: Background polling
    const FRONTEND_URL = process.env.FRONTEND_URL || 'https://yooclaw.yookeer.com';
    const MAX_POLLS = 120;

    (async () => {
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise(r => setTimeout(r, 180000));
        const t = videoTasks.get(submitId);
        if (!t) return;
        // Stop polling if user cancelled (dreamina CLI has no cancel API)
        if (t.status === 'cancelled') {
          console.log(`[VideoGen] Task ${submitId.slice(0, 8)}... cancelled by user, stopping background poll`);
          return;
        }
        t.polls = i + 1;

        try {
          const queryCmd = `${DREAMINA_BIN} query_result --submit_id=${submitId}`;
          const { stdout: queryOut } = await execAsync(queryCmd + ' 2>&1', { timeout: 30000, maxBuffer: 1024 * 1024, cwd: '/tmp' });
          let result: any;
          try { result = JSON.parse(queryOut); } catch { continue; }

          if (result?.queue_info) t.queueInfo = result.queue_info;
          console.log(`[VideoGen] Poll #${i + 1}/${MAX_POLLS}: gen_status=${result.gen_status}`);

          if (result.gen_status === 'success') {
            // For image_upscale, result is an image URL; all others are video
            if (gt === 'image_upscale') {
              const imgs = result.result_json?.images || [];
              t.videoUrl = imgs[0]?.url || imgs[0]?.video_url || '';
            } else {
              const videos = result.result_json?.videos || [];
              // Manual download via fetch()
              const cdnUrl = videos[0]?.video_url || '';
              if (cdnUrl) {
                try {
                  const d = await fetch(cdnUrl, { signal: AbortSignal.timeout(120000) as any });
                  if (d.ok) {
                    const buf = Buffer.from(await d.arrayBuffer());
                    const ext = (cdnUrl.match(/\.(mp4|webm|mov)/i) || ['.mp4'])[0];
                    const localFn = submitId + ext;
                    const lp = path.join(VIDEO_DIR, localFn);
                    fs.writeFileSync(lp, buf);
                    console.log(`[VideoGen] Downloaded: ${localFn} (${(buf.length/1024/1024).toFixed(1)}MB)`);
                    t.videoUrl = `${FRONTEND_URL}/videos/${localFn}`;
                  } else {
                    console.warn(`[VideoGen] CDN HTTP ${d.status}, using CDN URL`);
                    t.videoUrl = cdnUrl;
                  }
                } catch(dlErr: any) {
                  console.warn('[VideoGen] Manual download failed:', dlErr.message);
                  t.videoUrl = cdnUrl || '';
                }
              } else {
                t.videoUrl = '';
              }
            }
            t.status = 'completed';
            console.log(`[VideoGen] Completed: ${t.videoUrl?.slice(0, 80)}`);

            try {
              await saveVideo({
                userId: t.userId,
                title: t.prompt?.slice(0, 60) || (gt === 'image_upscale' ? '图片放大' : '视频'),
                prompt: t.prompt || gt,
                duration: t.duration,
                resolution: t.resolution,
                ratio: t.ratio,
                inputType: gt,
                videoUrl: t.videoUrl || '',
                videoPath: '',
                submitId,
              });
            } catch (dbErr: any) { console.error('[VideoGen] DB save failed:', dbErr.message); }

            for (const p of t.tempImagePaths) { try { fs.unlinkSync(p); } catch {} }
            return;
          }

          if (result.gen_status === 'fail') {
            t.status = 'failed';
            t.errorMessage = result.fail_reason || result.gen_message || result.error_message || result.msg || '生成失败';
            for (const p of t.tempImagePaths) { try { fs.unlinkSync(p); } catch {} }
            return;
          }
        } catch (pollErr: any) {
          const out = (pollErr as any).stdout || '';
          const errOut = (pollErr as any).stderr || '';
          console.error(`[VideoGen] Poll error for ${submitId}:`, pollErr.message);
          if (out) console.error(`[VideoGen] stdout:`, out.slice(0, 1000));
          if (errOut) console.error(`[VideoGen] stderr:`, errOut.slice(0, 1000));
          // If dreamina says 'record not found', mark as failed immediately
          if (out.includes('record not found') || errOut.includes('record not found')) {
            const t = videoTasks.get(submitId);
            if (t) {
              t.status = 'failed';
              t.errorMessage = '即梦服务器端已找不到任务记录，可能已过期';
              console.error(`[VideoGen] Task ${submitId} record not found, marking failed`);
              for (const p of t.tempImagePaths) { try { fs.unlinkSync(p); } catch {} }
              return;
            }
          }
          // Try to parse output even if command exited non-zero
          try {
            const result2 = JSON.parse(out);
            if (result2?.gen_status === 'success') {
              console.log(`[VideoGen] Recovered success from failed command for ${submitId}`);
              // process success same as above...
            }
          } catch {}
        }
      }

      const t = videoTasks.get(submitId);
      if (t && t.status === 'processing') {
        t.status = 'failed';
        for (const p of t.tempImagePaths) { try { fs.unlinkSync(p); } catch {} }
      }
    })();
  } catch (err: any) {
    console.error('[VideoGen Error]', err.message);
    // Don't expose internal command details or stack traces to frontend
    res.status(500).json({ error: { code: 'GENERATE_FAILED', message: '视频生成服务暂时不可用，请稍后重试' } });
  }
});

// Get video task status (polled by frontend every 30s)
app.get('/api/v1/videos/status/:submitId', authMiddleware, async (req, res) => {
  const { submitId } = req.params;

  // Check multi-clip tasks first
  const mcTask = multiClipTasks.get(submitId);
  if (mcTask) {
    const elapsedMinutes = Math.floor((Date.now() - mcTask.startTime) / 60000);
    const completedClips = mcTask.clips.filter(c => c.status === 'completed').length;
    const totalClips = mcTask.clips.length;

    let queueMessage = '';
    if (mcTask.status === 'processing') {
      const qi = mcTask.queueInfo || {};
      const queueIdx = qi.queue_idx;
      const queueLen = qi.queue_length;
      if (typeof queueIdx === 'number' && typeof queueLen === 'number' && queueLen > 0 && queueIdx > 0) {
        queueMessage = `片段 ${completedClips}/${totalClips} 完成 · 排队 ${queueIdx}/${queueLen}`;
      } else {
        queueMessage = `片段 ${completedClips}/${totalClips} 完成 · 生成中`;
      }
    } else if (mcTask.status === 'concatenating') {
      queueMessage = `正在拼接 ${totalClips} 个片段...`;
    }

    return res.json({
      data: {
        id: submitId,
        status: mcTask.status,
        genType: 'multi_clip',
        polls: mcTask.polls,
        maxPolls: 120,
        isPolling: mcTask.status === 'processing' || mcTask.status === 'concatenating',
        queueInfo: mcTask.queueInfo || null,
        queueMessage,
        elapsedMinutes,
        estimatedMaxMinutes: totalClips * 20,
        result: mcTask.videoUrl ? { videoUrl: mcTask.videoUrl } : null,
        errorMessage: mcTask.errorMessage || null,
        multiClip: { completedClips, totalClips },
      },
    });
  }

  // Fall through to single-video tasks
  const task = videoTasks.get(submitId);
  if (!task) {
    return res.json({
      data: {
        id: submitId,
        status: 'unknown',
        polls: 0,
        maxPolls: 120,
        isPolling: false,
        queueInfo: null,
        queueMessage: '',
        elapsedMinutes: 0,
        estimatedMaxMinutes: 300,
        result: null,
      },
    });
  }

  const elapsedMinutes = Math.floor((Date.now() - task.startTime) / 60000);
  const estimatedMaxMinutes = 120 * 3; // 120 polls x 3min = 6 hr

  let queueMessage = '';
  if (task.status === 'processing') {
    const qi = task.queueInfo || {};
    // Only use real queue_info from dreamina; don't fabricate default numbers
    const queueIdx = qi.queue_idx;
    const queueLen = qi.queue_length;
    const queueStatus = qi.queue_status;
    if (typeof queueIdx === 'number' && typeof queueLen === 'number' && queueLen > 0 && queueIdx > 0) {
      queueMessage = `排队中 · 当前排位 ${queueIdx}/${queueLen}`;
    } else if (queueStatus === 'generating' || queueStatus === 'processing' || (typeof queueIdx === 'number' && queueIdx === 0)) {
      queueMessage = `视频正在生成中，请稍候`;
    } else {
      queueMessage = `排队中 · 等待资源分配`;
    }
  }

  res.json({
    data: {
      id: submitId,
      status: task.status,
      genType: task.genType,
      polls: task.polls,
      maxPolls: 120,
      isPolling: task.status === 'processing',
      queueInfo: task.queueInfo || null,
      queueMessage,
      elapsedMinutes,
      estimatedMaxMinutes,
      result: task.videoUrl ? { videoUrl: task.videoUrl } : null,
      errorMessage: task.errorMessage || null,
    },
  });
});
// ======================== MP Subscription API Routes ========================

// Get QR code URL for WeRead login
app.post('/api/mp/qr-login', authMiddleware, async (req, res) => {
  try {
    const response = await fetch(`${WEWE_RSS_URL}/trpc/platform.createLoginUrl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': WEWE_RSS_AUTH,
      },
      body: '{}',
    });
    const data = await response.json() as any;
    const uuid = data?.result?.data?.uuid;
    const scanUrl = data?.result?.data?.scanUrl;

    if (!uuid || !scanUrl) {
      return res.status(502).json({ error: { code: 'UPSTREAM_ERROR', message: 'Failed to create login URL' } });
    }

    res.json({ success: true, data: { uuid, scanUrl } });
  } catch (err: any) {
    console.error('[MP QR Login]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Check QR login result (long-polling, 60s timeout)
app.get('/api/mp/check-login/:uuid', authMiddleware, async (req, res) => {
  try {
    const { uuid } = req.params;
    const encodedInput = encodeURIComponent(JSON.stringify({ id: uuid }));
    const tRPCUrl = `${WEWE_RSS_URL}/trpc/platform.getLoginResult?input=${encodedInput}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(tRPCUrl, {
      headers: { 'Authorization': WEWE_RSS_AUTH },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await response.json() as any;

    if (data?.result?.data) {
      const dataList = Array.isArray(data.result.data) ? data.result.data : [data.result.data];
      const { vid, token, username } = dataList[0] || {};
      if (vid && token) {
        // Save to YooClaw's Supabase
        await addWereadAccount(String(vid), username || 'WeRead Account');
        // Also sync to WeWe-RSS's own accounts table so it can fetch articles
        try {
          await fetch(`${WEWE_RSS_URL}/trpc/account.add`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': WEWE_RSS_AUTH,
            },
            body: JSON.stringify({ id: String(vid), token, name: username || 'WeRead Account', status: 1 }),
          });
        } catch (e: any) {
          console.warn('[MP Check Login] Failed to sync account to WeWe-RSS:', e.message);
        }
        res.json({ success: true, data: { vid, token, username, status: 'logged_in' } });
        return;
      }
    }

    res.json({ success: true, data: { status: 'waiting', message: 'Waiting for scan...' } });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return res.json({ success: true, data: { status: 'timeout', message: 'Login timeout, please try again' } });
    }
    console.error('[MP Check Login]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Subscribe to a WeChat MP by article link
app.post('/api/mp/subscribe', authMiddleware, async (req, res) => {
  try {
    const { wxsLink } = req.body || {};
    const userId = (req as any).user.userId;

    if (!wxsLink || typeof wxsLink !== 'string') {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Article link is required' } });
    }
    if (!wxsLink.startsWith('https://mp.weixin.qq.com/s/')) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid WeChat article link' } });
    }

    const count = await getUserMpSubscriptionCount(userId);
    if (count >= 10) {
      return res.status(400).json({ error: { code: 'LIMIT_EXCEEDED', message: 'Max 10 subscriptions reached' } });
    }

    // Get MP info via WeWe-RSS tRPC
    const mpRes = await fetch(`${WEWE_RSS_URL}/trpc/platform.getMpInfo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': WEWE_RSS_AUTH,
      },
      body: JSON.stringify({ wxsLink }),
    });
    const mpData = await mpRes.json() as any;

    if (!mpData?.result?.data) {
      return res.status(502).json({ error: { code: 'UPSTREAM_ERROR', message: 'Failed to get MP info' } });
    }

    // WeWe-RSS returns an array, e.g. [{"name":"...","id":"...","cover":"..."}]
    const dataList = Array.isArray(mpData.result.data) ? mpData.result.data : [mpData.result.data];
    if (dataList.length === 0) {
      console.error('[MP Subscribe] Empty MP info list from WeWe-RSS:', JSON.stringify(mpData.result.data));
      return res.status(502).json({ error: { code: 'UPSTREAM_ERROR', message: 'Failed to get MP info' } });
    }
    const { id, name, cover } = dataList[0];

    // Validate required fields from upstream
    if (!id || !name) {
      console.error('[MP Subscribe] Incomplete MP info from WeWe-RSS:', JSON.stringify(mpData.result.data));
      return res.status(502).json({ error: { code: 'UPSTREAM_ERROR', message: 'Incomplete MP info from upstream' } });
    }
    const mpId = id;
    const mpName = name || '未知公众号';
    const mpCover = cover || '';

    // Register feed in WeWe-RSS if not exists
    try {
      const checkRes = await fetch(
        `${WEWE_RSS_URL}/trpc/feed.byId?input=${encodeURIComponent(JSON.stringify(mpId))}`,
        { headers: { 'Authorization': WEWE_RSS_AUTH } }
      );
      if (!checkRes.ok) {
        await fetch(`${WEWE_RSS_URL}/trpc/feed.add`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': WEWE_RSS_AUTH,
          },
          body: JSON.stringify({
            id: mpId,
            mpName,
            mpCover,
            mpIntro: '',
            updateTime: Math.floor(Date.now() / 1000),
          }),
        });
      }

      // Trigger article fetch for the newly subscribed MP
      await fetch(`${WEWE_RSS_URL}/trpc/feed.refreshArticles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': WEWE_RSS_AUTH,
        },
        body: JSON.stringify({ mpId }),
      });
    } catch (e) {
      console.warn('[MP Subscribe] Feed registration warning:', e);
    }

    const result = await subscribeMp(userId, mpId, mpName, mpCover);
    if (!result.success) {
      return res.status(400).json({ error: { code: 'CONFLICT', message: result.message } });
    }

    res.json({
      success: true,
      data: { mpId, mpName, mpCover, subscribedAt: new Date().toISOString() },
    });
  } catch (err: any) {
    console.error('[MP Subscribe] Error:', err.message, '| stack:', err.stack?.split('\n')[1]?.trim());
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Unsubscribe from a WeChat MP
app.delete('/api/mp/subscribe/:mpId', authMiddleware, async (req, res) => {
  try {
    const { mpId } = req.params;
    const userId = (req as any).user.userId;

    const result = await unsubscribeMp(userId, mpId);

    if (result.deleted) {
      try {
        await fetch(`${WEWE_RSS_URL}/trpc/feed.delete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': WEWE_RSS_AUTH,
          },
          body: JSON.stringify(mpId),
        });
      } catch (e) {
        console.warn('[MP Unsubscribe] Failed to delete feed from WeWe-RSS:', e);
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[MP Unsubscribe]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Get my MP subscriptions
app.get('/api/mp/subscriptions', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const subscriptions = await getUserMpSubscriptions(userId);

    res.json({
      success: true,
      data: {
        items: subscriptions.map((s: any) => ({
          mpId: s.mp_id,
          mpName: s.mp_name,
          mpCover: s.mp_cover,
          subscribedAt: s.created_at,
        })),
        count: subscriptions.length,
        limit: 10,
      },
    });
  } catch (err: any) {
    console.error('[MP Subscriptions]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Get articles for a specific MP (must be subscribed)
app.get('/api/mp/articles/:mpId', authMiddleware, async (req, res) => {
  try {
    const { mpId } = req.params;
    const userId = (req as any).user.userId;
    const limit = parseInt(req.query.limit as string) || 20;
    const page = parseInt(req.query.page as string) || 1;

    const isSubscribed = await checkUserSubscribed(userId, mpId);
    if (!isSubscribed) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Please subscribe first' } });
    }

    const feedRes = await fetch(`${WEWE_RSS_URL}/feeds/${mpId}.json?limit=${limit}&page=${page}`, {
      headers: { 'Authorization': WEWE_RSS_AUTH },
    });

    if (!feedRes.ok) {
      return res.json({ success: true, data: { articles: [], total: 0, page } });
    }

    const feedData = await feedRes.json() as any;
    const articles = (feedData?.items || []).map((item: any) => ({
      id: item.id || item.guid,
      title: item.title,
      url: item.link || item.url,
      summary: item.description || item.summary || '',
      publishTime: item.pubDate || item.published || item.date_published,
      author: item.author || feedData?.title || '',
    }));

    res.json({ success: true, data: { articles, total: articles.length, page } });
  } catch (err: any) {
    console.error('[MP Articles]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Get aggregated articles feed from all subscriptions
app.get('/api/mp/articles', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const limit = parseInt(req.query.limit as string) || 50;

    const subscriptions = await getUserMpSubscriptions(userId);
    if (subscriptions.length === 0) {
      return res.json({ success: true, data: { articles: [], total: 0 } });
    }

    const feedPromises = subscriptions.map(async (sub: any) => {
      try {
        const response = await fetch(`${WEWE_RSS_URL}/feeds/${sub.mp_id}.json?limit=10`, {
          headers: { 'Authorization': WEWE_RSS_AUTH },
        });
        if (!response.ok) return [];
        const data = await response.json() as any;
        return (data?.items || []).map((item: any) => ({
          id: item.id || item.guid,
          title: item.title,
          url: item.link || item.url,
          summary: item.description || item.summary || '',
          publishTime: item.pubDate || item.published || item.date_published,
          author: sub.mp_name,
          mpId: sub.mp_id,
        }));
      } catch {
        return [];
      }
    });

    const allArticles = (await Promise.all(feedPromises)).flat();
    allArticles.sort((a: any, b: any) => {
      const dateA = new Date(a.publishTime).getTime() || 0;
      const dateB = new Date(b.publishTime).getTime() || 0;
      return dateB - dateA;
    });

    res.json({
      success: true,
      data: { articles: allArticles.slice(0, limit), total: allArticles.length },
    });
  } catch (err: any) {
    console.error('[MP Aggregated Feed]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});


// Manual refresh: trigger WeWe-RSS to re-fetch all subscribed MP articles
app.post('/api/mp/refresh', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { mpId } = req.body || {};

    // Get user's subscriptions
    const subscriptions = await getUserMpSubscriptions(userId);

    if (mpId) {
      // Refresh a specific MP
      const isSubscribed = await checkUserSubscribed(userId, mpId);
      if (!isSubscribed) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Please subscribe first' } });
      }
      await fetch(`${WEWE_RSS_URL}/trpc/feed.refreshArticles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': WEWE_RSS_AUTH,
        },
        body: JSON.stringify({ mpId }),
      });
      res.json({ success: true, data: { mpId, status: 'refreshed' } });
    } else {
      // Refresh all user's subscriptions one by one
      const results = await Promise.allSettled(
        subscriptions.map((sub: any) =>
          fetch(`${WEWE_RSS_URL}/trpc/feed.refreshArticles`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': WEWE_RSS_AUTH,
            },
            body: JSON.stringify({ mpId: sub.mp_id }),
          }).then(r => r.json())
        )
      );

      const refreshed = results.filter(r => r.status === 'fulfilled').length;
      res.json({
        success: true,
        data: { status: 'all_refreshed', total: subscriptions.length, refreshed },
      });
    }
  } catch (err: any) {
    console.error('[MP Refresh]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// ========== MP: Search by Name (Baidu + WeWe-RSS) ==========

// Helper: unified tRPC mutation call
async function weweTrpcCall(procedure: string, input: unknown): Promise<any> {
  const res = await fetch(`${WEWE_RSS_URL}/trpc/${procedure}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': WEWE_RSS_AUTH,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`WeWe-RSS ${procedure} failed: HTTP ${res.status} - ${errText}`);
  }
  const json = await res.json();
  return json?.result?.data || json;
}

// POST /api/mp/search-by-name — Search MPs by name via Baidu
app.post('/api/mp/search-by-name', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '公众号名称不能为空' } });
    }

    const searchName = name.trim();
    console.log(`[MP Search] Searching for: "${searchName}"`);

    // Step 1: Baidu search for weixin articles
    const baiduQuery = `site:mp.weixin.qq.com "${searchName}"`;
    const baiduUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(baiduQuery)}&rn=20`;

    const baiduRes = await fetch(baiduUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });

    if (!baiduRes.ok) {
      return res.status(502).json({ error: { code: 'SEARCH_FAILED', message: `百度搜索失败: HTTP ${baiduRes.status}` } });
    }

    const html = await baiduRes.text();
    const $ = cheerio.load(html);

    const articleUrls = new Set<string>();
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const match = href.match(/mp\.weixin\.qq\.com\/s\/[^\s&"']+/);
      if (match) articleUrls.add('https://' + match[0]);
    });

    const urls = Array.from(articleUrls).slice(0, 10);
    console.log(`[MP Search] Found ${urls.length} article URLs from Baidu`);

    if (urls.length === 0) {
      return res.json({ success: true, data: { candidates: [], message: '未找到匹配的公众号文章，请尝试更精确的名称' } });
    }

    const mpMap = new Map<string, { id: string; name: string; cover: string; intro: string; updateTime: number }>();
    for (const url of urls) {
      try {
        const results = await weweTrpcCall('platform.getMpInfo', { wxsLink: url });
        const mpList = Array.isArray(results) ? results : (results?.data || [results]).filter(Boolean);
        for (const mp of mpList) {
          if (mp?.id && !mpMap.has(mp.id)) {
            mpMap.set(mp.id, {
              id: mp.id,
              name: mp.name || '',
              cover: mp.cover || '',
              intro: mp.intro || '',
              updateTime: mp.updateTime || 0,
            });
          }
        }
      } catch (err: any) {
        console.warn(`[MP Search] Failed to get MP info for ${url}:`, err.message);
      }
    }

    const candidates = Array.from(mpMap.values());
    console.log(`[MP Search] Found ${candidates.length} unique MPs`);
    res.json({ success: true, data: { candidates } });
  } catch (err: any) {
    console.error('[MP Search Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: `搜索失败: ${err.message}` } });
  }
});

// POST /api/mp/subscribe-by-name — Subscribe by MP info (from search results)
app.post('/api/mp/subscribe-by-name', authMiddleware, async (req, res) => {
  try {
    const { id, mpName, mpCover, mpIntro, updateTime } = req.body || {};
    if (!id || !mpName) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '公众号ID和名称不能为空' } });
    }

    console.log(`[MP Subscribe-By-Name] Subscribing to: ${mpName} (${id})`);
    await weweTrpcCall('feed.add', {
      id, mpName, mpCover: mpCover || '', mpIntro: mpIntro || '', updateTime: updateTime || Date.now(),
    });
    console.log(`[MP Subscribe-By-Name] Success: ${mpName}`);

    // Auto-refresh articles after subscribing
    try {
      await fetch(`${WEWE_RSS_URL}/trpc/feed.refreshArticles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': WEWE_RSS_AUTH },
        body: JSON.stringify({ mpId: id }),
      });
    } catch (e: any) {
      console.warn(`[MP Subscribe-By-Name] Refresh articles failed (non-fatal):`, e.message);
    }

    res.json({ success: true, data: { success: true, message: `已成功订阅「${mpName}」` } });
  } catch (err: any) {
    console.error('[MP Subscribe-By-Name Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: `订阅失败: ${err.message}` } });
  }
});

// POST /api/mp/lookup-by-url — Get MP info from a WeChat article URL
app.post('/api/mp/lookup-by-url', authMiddleware, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !url.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '文章链接不能为空' } });
    }

    console.log(`[MP Lookup] Looking up MP from URL: ${url.trim()}`);
    const results = await weweTrpcCall('platform.getMpInfo', { wxsLink: url.trim() });
    const mpList = Array.isArray(results) ? results : (results?.data || [results]).filter(Boolean);

    if (!mpList.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: '无法从该链接识别公众号信息' } });
    }

    const mp = mpList[0];
    res.json({
      success: true,
      data: {
        id: mp.id, name: mp.name || '', cover: mp.cover || '',
        intro: mp.intro || '', updateTime: mp.updateTime || 0,
      },
    });
  } catch (err: any) {
    console.error('[MP Lookup Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: `查找失败: ${err.message}` } });
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

// Kling reference images static serving
const KLING_IMG_DIR = process.env.KLING_IMG_DIR || path.join(
  path.dirname(VIDEO_DIR),
  'kling-imgs'
);
app.use('/kling-imgs', express.static(KLING_IMG_DIR, {
  maxAge: '1h',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

// ======================== Video Management API Routes ========================

// List user's videos
app.get('/api/v1/videos', authMiddleware, async (req: any, res) => {
  try {
    const user = req.user;
    const videos = await getUserVideos(user.userId);
    // Convert snake_case DB fields to camelCase for frontend
    const items = videos.map(v => ({
      id: v.id,
      userId: v.user_id,
      title: v.title,
      prompt: v.prompt,
      duration: v.duration,
      resolution: v.resolution,
      ratio: v.ratio,
      inputType: v.input_type,
      videoUrl: v.video_url,
      videoPath: v.video_path,
      submitId: v.submit_id,
      createdAt: v.created_at,
    }));
    res.json({ data: { items } });
  } catch (err: any) {
    console.error('[Video List Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list videos' } });
  }
});

// Delete a video
app.delete('/api/v1/videos/:id', authMiddleware, async (req: any, res) => {
  try {
    const user = req.user;
    const { id } = req.params;
    await deleteVideo(id, user.userId);
    res.json({ data: { deleted: true } });
  } catch (err: any) {
    console.error('[Video Delete Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete video' } });
  }
});

// Cancel a running video generation task
app.post('/api/v1/videos/cancel/:submitId', authMiddleware, (req: any, res) => {
  try {
    const { submitId } = req.params;
    const task = videoTasks.get(submitId);
    if (task) {
      task.status = 'cancelled';
      console.log(`[Video Cancel] Task ${submitId.slice(0, 8)}... marked as cancelled`);
    }
    const mcTask = multiClipTasks.get(submitId);
    if (mcTask) {
      mcTask.status = 'cancelled';
      console.log(`[Video Cancel] Multi-clip task ${submitId.slice(0, 8)}... marked as cancelled`);
    }
    res.json({ data: { cancelled: true } });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel' } });
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
