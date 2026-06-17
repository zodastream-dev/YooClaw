// V2.1 Daily Briefing — 晨报生成 + PushPlus 微信推送 + SMTP 邮件推送 + 7:30AM 自排程调度器
import { getAllPortalSites, getReportSiteBySlug, saveDailyBriefing } from './db.js';
import fs from 'fs';
import path from 'path';
import tls from 'tls';

// ========== Types ==========
interface IntelItem {
  title: string;
  summary: string;
  source: string;
  _valueScore: number;
  _provider: string;
  url?: string;
  date?: string;
}

interface PushConfig {
  enabled: boolean;
  email?: string;
}

type PortalIntelCache = Map<string, { data: any[]; expiry: number }>;

// ========== Push Config Storage ==========
const PUSH_CONFIG_FILE = path.join(process.cwd(), 'cache', 'portal-push-config.json');

function loadPushConfig(): Record<string, PushConfig> {
  try {
    if (fs.existsSync(PUSH_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(PUSH_CONFIG_FILE, 'utf-8'));
    }
  } catch (e: any) { console.warn('[PushConfig] Load failed:', e.message); }
  return {};
}

function savePushConfig(config: Record<string, PushConfig>): void {
  try {
    const dir = path.dirname(PUSH_CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PUSH_CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e: any) { console.error('[PushConfig] Save failed:', e.message); }
}

export function getPushConfig(slug: string): PushConfig {
  const config = loadPushConfig();
  return config[slug] || { enabled: true };
}

export function setPushConfig(slug: string, cfg: Partial<PushConfig>): PushConfig {
  const config = loadPushConfig();
  const existing = config[slug] || { enabled: true };
  config[slug] = { ...existing, ...cfg };
  savePushConfig(config);
  return config[slug];
}

// ========== Prompts ==========

function makeBriefingPrompt(
  portalName: string,
  highValueIntel: IntelItem[]
): { system: string; user: string } {
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });
  const intelText = highValueIntel.map((item, i) =>
    `${i + 1}. [价值分${item._valueScore}] ${item.title}
   摘要：${item.summary}
   来源：${item.source}`
  ).join('\n\n');

  const system = `你是顶级战略顾问，为「${portalName}」的高管撰写每日晨报内参。
你的文字风格：像资深幕僚而非新闻聚合器——精准、冷静、有判断力。

写作原则：
1. 开篇用一段「核心判断」（2-3句话），概括今日最重要信号和趋势
2. 然后逐条展开每条情报：每条自成一节，用 ### 标记小节标题
3. 每节结构：事实陈述 → 背景解读 → 研判（这意味着什么/建议关注什么）
4. 用 Markdown 格式：**加粗关键数据**、用 > 引用原文关键信息
5. 如需决策建议，用 📌 标记
6. 总长度 500-1000 字（不含标题），内容充实，不要缩水

禁止：
- 不要写"根据搜索结果""据悉""据报道"等冗余措辞
- 不要复读摘要，要提炼核心并给出判断
- 不要用模糊词汇（"可能""或将""有望"），有把握就说，没把握就写"待确认"

输出格式：
## 📊 {昨日日期} 政策简报

**核心判断**：（一段2-3句话）

### 情报一：xxx
（事实 + 背景 + 研判）

### 情报二：xxx
（事实 + 背景 + 研判）

...以此类推`;

  const user = `请撰写昨日（${yesterday}）的政策简报，覆盖当日最重要的政策信号和行业动态。

以下是昨日价值最高的情报（共${highValueIntel.length}条）。请基于这些内容生成高管晨报内参。

情报列表：
${intelText}

请直接输出晨报，不要任何前缀说明。`;

  return { system, user };
}

// ========== DeepSeek Generation ==========

async function generateBriefing(
  portalName: string,
  highValueIntel: IntelItem[],
  model = 'deepseek-v4-pro'
): Promise<string> {
  const { system, user } = makeBriefingPrompt(portalName, highValueIntel);

  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (process.env.DEEPSEEK_API_KEY || ''),
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) throw new Error('Briefing generation failed: HTTP ' + resp.status);
  const data = await resp.json();
  return data.choices[0].message.content.trim();
}

// ========== PushPlus 微信推送 ==========

async function pushWechatMessage(
  token: string,
  title: string,
  content: string,
): Promise<boolean> {
  try {
    const resp = await fetch('https://www.pushplus.plus/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        title,
        content,
        template: 'markdown',
        channel: 'wechat',
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      console.error('[BriefingPush] PushPlus HTTP error:', resp.status);
      return false;
    }

    const data = await resp.json();
    if (data.code === 200) {
      console.log('[BriefingPush] Sent successfully:', title);
      return true;
    }
    console.error('[BriefingPush] PushPlus API error:', data.code, data.msg);
    return false;
  } catch (e: any) {
    console.error('[BriefingPush] Failed:', e.message);
    return false;
  }
}

// ========== SMTP Email 发送 ==========

async function sendEmail(
  to: string,
  subject: string,
  mdContent: string,
): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '465');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.log('[BriefingEmail] SMTP not configured, skipping');
    return false;
  }

  const html = mdContent
    .replace(/^## (.+)$/gm, '<h2 style="color:#1a1a2e;font-size:18px">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid #00d4ff;padding-left:12px;color:#555;margin:8px 0">$1</blockquote>')
    .replace(/\n\n/g, '</p><p style="line-height:1.8">')
    .replace(/\n/g, '<br>');

  const body = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Microsoft YaHei',sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8f9fa"><div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,0.08)"><p style="line-height:1.8">${html}</p><hr style="border:none;border-top:1px solid #eee;margin:20px 0"><p style="font-size:12px;color:#999">由 YooClaw 情报分析门户自动生成 · ${new Date().toLocaleDateString('zh-CN')}</p></div></div>`;

  console.log('[BriefingEmail] Attempting SMTP send to:', to, 'via', host);
  try {
    const auth = Buffer.from(`\x00${user}\x00${pass}`).toString('base64');
    const message = [
      `From: ${user}`, `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'Content-Type: text/html; charset=UTF-8', 'MIME-Version: 1.0', '', body, '.',
    ].join('\r\n');

    return new Promise((resolve) => {
      const socket = tls.connect(port, host, { rejectUnauthorized: false }, () => {
        let step = 0;
        socket.on('data', (d: Buffer) => {
          const text = d.toString();
          if (step === 0 && text.includes('220')) { socket.write('EHLO yooclaw\r\n'); step = 1; }
          else if (step === 1 && text.includes('AUTH')) { socket.write('AUTH PLAIN\r\n'); step = 2; }
          else if (step === 2 && text.includes('334')) { socket.write(auth + '\r\n'); step = 3; }
          else if (step === 3 && text.includes('235')) { socket.write(`MAIL FROM:<${user}>\r\n`); step = 4; }
          else if (step === 4 && text.match(/^2\d\d/)) { socket.write(`RCPT TO:<${to}>\r\n`); step = 5; }
          else if (step === 5 && text.match(/^2\d\d/)) { socket.write('DATA\r\n'); step = 6; }
          else if (step === 6 && text.includes('354')) { socket.write(message + '\r\n'); step = 7; }
          else if (step === 7 && text.match(/2\d\d.*queued/)) { socket.write('QUIT\r\n'); socket.end(); console.log('[BriefingEmail] Sent to:', to); resolve(true); }
          else if (step >= 3 && text.match(/^5\d\d/)) { console.error('[BriefingEmail] SMTP error:', text.substring(0, 200)); socket.destroy(); resolve(false); }
        });
        socket.on('error', () => resolve(false));
        socket.setTimeout(15000, () => { socket.destroy(); resolve(false); });
      });
    });
  } catch (e: any) {
    console.error('[BriefingEmail] Failed:', e.message);
    return false;
  }
}

// ========== Per-Portal Briefing Pipeline ==========

const lastBriefingDate = new Map<string, string>(); // slug → YYYY-MM-DD

export async function runDailyBriefing(
  slug: string,
  portalIntelCache: PortalIntelCache,
  force = false,
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);

  if (!force && lastBriefingDate.get(slug) === today) {
    console.log(`[Briefing] ${slug}: already sent today, skipping`);
    return false;
  }

  try {
    const site = await getReportSiteBySlug(slug, 'portal');
    if (!site) { console.log(`[Briefing] ${slug}: portal not found`); return false; }

    // Check push enabled
    const pushCfg = getPushConfig(slug);
    if (!pushCfg.enabled) {
      console.log(`[Briefing] ${slug}: push is disabled`);
      lastBriefingDate.set(slug, today); // mark as handled to prevent retry
      return false;
    }

    // Check at least one channel configured
    const pushToken = process.env.PUSHPLUS_TOKEN || '';
    const pushEmail = pushCfg.email || '';
    if (!pushToken && !pushEmail) {
      console.log(`[Briefing] ${slug}: no push channels configured (no token, no email)`);
      return false;
    }

    // Gather intel from all cached entries related to this portal
    const allIntel: IntelItem[] = [];
    const now = Date.now();
    for (const [, entry] of portalIntelCache) {
      if (entry.expiry <= now) continue;
      if (!Array.isArray(entry.data)) continue;
      for (const item of entry.data) {
        const score = parseInt(item._valueScore) || 0;
        if (score >= 60) {
          allIntel.push({
            title: item.title || '',
            summary: item.summary || '',
            source: item._provider || item.source || '',
            _valueScore: score,
            _provider: item._provider || '',
            url: item.link || item.url || '',
            date: item.date || '',
          });
        }
      }
    }

    // Select top-N by _valueScore, dedup by title
    const seen = new Set<string>();
    const topN = allIntel
      .filter(item => {
        const key = item.title.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b._valueScore - a._valueScore)
      .slice(0, 8);

    if (topN.length < 3) {
      console.log(`[Briefing] ${slug}: only ${topN.length} high-value items (<3), skipping`);
      return false;
    }

    // Push to WeChat + Email
    const portalName = (site as any).title || slug;
    console.log(`[Briefing] ${slug}: generating briefing from ${topN.length} items...`);
    const briefing = await generateBriefing(portalName, topN);
    console.log(`[Briefing] ${slug}: generated (${briefing.length} chars)`);

    // Save to DB for portal display
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await saveDailyBriefing(slug, yesterday, briefing, false).catch(e =>
      console.error(`[Briefing] ${slug}: DB save failed —`, e.message)
    );

    let pushed = false;

    // PushPlus WeChat
    if (pushToken) {
      const wxOk = await pushWechatMessage(
        pushToken,
        `${portalName} · 每日情报晨报 (${today})`,
        briefing,
      );
      if (wxOk) pushed = true;
    }

    // Email
    if (pushEmail) {
      const emailOk = await sendEmail(
        pushEmail,
        `${portalName} · 每日情报晨报 (${today})`,
        briefing,
      );
      if (emailOk) pushed = true;
    }

    if (pushed) {
      lastBriefingDate.set(slug, today);
      // Mark as pushed in DB
      saveDailyBriefing(slug, yesterday, briefing, true).catch(()=>{});
      console.log(`[Briefing] ${slug}: pushed successfully (wechat=${!!pushToken}, email=${!!pushEmail})`);
    }
  } catch (e: any) {
    console.error(`[Briefing] ${slug}: failed —`, e.message);
    return false;
  }
}

// ========== Scheduler ==========

export async function runAllDailyBriefings(
  portalIntelCache: PortalIntelCache,
): Promise<void> {
  console.log('[Briefing] Starting daily briefing round');
  try {
    const allSites = await getAllPortalSites();
    if (allSites.length === 0) {
      console.log('[Briefing] No portal sites found');
      return;
    }

    let pushed = 0;
    for (const site of allSites) {
      const ok = await runDailyBriefing(site.slug, portalIntelCache);
      if (ok) pushed++;
      // Short delay between portals
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log(`[Briefing] Round complete: ${pushed}/${allSites.length} portals pushed`);
  } catch (e: any) {
    console.error('[Briefing] Scheduler error:', e.message);
  }
}

let briefingTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleNextBriefing(
  portalIntelCache: PortalIntelCache,
): void {
  const now = new Date();
  const next730 = new Date(now);
  next730.setHours(7, 30, 0, 0);
  if (now >= next730) {
    next730.setDate(next730.getDate() + 1);
  }

  const msUntil730 = next730.getTime() - now.getTime();
  const hours = Math.floor(msUntil730 / 3600000);
  const mins = Math.floor((msUntil730 % 3600000) / 60000);
  console.log(`[Briefing] Next briefing in ${hours}h ${mins}m (${next730.toLocaleString('zh-CN')})`);

  if (briefingTimer) clearTimeout(briefingTimer);
  briefingTimer = setTimeout(() => {
    runAllDailyBriefings(portalIntelCache).finally(() => {
      scheduleNextBriefing(portalIntelCache);
    });
  }, msUntil730);
}
