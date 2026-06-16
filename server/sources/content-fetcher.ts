/**
 * V3.0: 全量拉取引擎 — RSS 聚合 + 政府站点爬虫
 *
 * 对指定权威信源做全量采样，不做关键词过滤。
 * 捕获不含监控对象名的弱信号（项目公告、人事任命、监管文书等）。
 */

import { RawSearchItem } from '../search-sources/types.js';

// Today's date string for item freshness
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
}

// RSS feed 源 / 频道列表页
// 主流媒体大多为 JS 渲染，curl 只能抓取服务端 HTML。
// 优先使用有实际文章标题的频道/列表页，避免首页导航链接。
const RSS_FEEDS: { name: string; url: string; label: string }[] = [
  { name: 'ndrc', url: 'https://www.ndrc.gov.cn/fzggw/jgsj/fgs/sjdt/', label: '发改委政策' },
  { name: 'ndrc-news', url: 'https://www.ndrc.gov.cn/xwdt/xwfb/', label: '发改委新闻发布' },
  { name: 'mof', url: 'https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/', label: '财政部新闻' },
  { name: 'people', url: 'https://www.people.com.cn/', label: '人民网' },
  { name: 'xinhua', url: 'https://www.news.cn/finance/', label: '新华网' },
  { name: 'ce', url: 'https://www.ce.cn/cysc/', label: '经济日报' },
  { name: 'financialnews', url: 'https://www.financialnews.com.cn/', label: '金融时报' },
  { name: 'jfdaily', url: 'https://www.jfdaily.com/', label: '解放日报' },
  { name: 'gmw', url: 'https://www.gmw.cn/', label: '光明日报' },
  { name: 'cnr', url: 'https://finance.cnr.cn/', label: '央广网' },
  { name: 'stcn', url: 'https://www.stcn.com/', label: '证券时报' },
  { name: 'jjckb', url: 'https://www.jjckb.cn/', label: '经济参考报' },
];

// 政府站点列表页（仅保留可访问的）
const GOV_PAGES: { name: string; url: string; label: string }[] = [
  {
    name: 'mee-eia',
    url: 'https://www.mee.gov.cn/ywgz/hjyxpj/jsxmhjyxpj/',
    label: '生态环境部环评',
  },
  {
    name: 'ndrc-projects',
    url: 'https://www.ndrc.gov.cn/fzggw/jgsj/fgs/sjdt/',
    label: '发改委政策动态',
  },
  {
    name: 'cbirc-notices',
    url: 'https://www.cbirc.gov.cn/cn/view/pages/ItemList.html?itemPId=915',
    label: '金监总局公告',
  },
];

/**
 * Try fetching a URL that looks like it might be an RSS feed or HTML page.
 * Returns parsed items with today's date.
 */
async function fetchPage(url: string, label: string): Promise<RawSearchItem[]> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YooClaw/3.0)' },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    if (!resp.ok) {
      console.warn(`[Fetcher] ${label}: HTTP ${resp.status} for ${url}`);
      return [];
    }

    const text = await resp.text();
    const date = todayStr();

    // Try RSS XML parsing first (look for <item> tags)
    if (text.includes('<item>') || text.includes('<entry>')) {
      return parseRSS(text, date);
    }

    // Otherwise parse as HTML — extract all links with visible text
    return parseHTML(text, url, date);
  } catch (e: any) {
    console.warn(`[Fetcher] ${label}: ${e.message}`);
    return [];
  }
}

/**
 * Parse RSS 2.0 / Atom XML and extract items.
 */
function parseRSS(xml: string, date: string): RawSearchItem[] {
  const items: RawSearchItem[] = [];
  // Try <item> (RSS 2.0) first, then <entry> (Atom)
  const blocks = xml.split(/<item[^>]*>/i).slice(1);
  if (blocks.length === 0) return [];

  for (const block of blocks) {
    const titleM = block.match(/<title>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?<\/title>/is);
    const linkM = block.match(/<link[^>]*>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?<\/link>/i) ||
                  block.match(/<link[^>]*href\s*=\s*["']([^"']+)["']/i);
    const descM = block.match(/<description>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?<\/description>/is);

    if (!titleM) continue;
    const title = titleM[1].trim().replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    if (!title || title.length < 4) continue;

    let snippet = '';
    if (descM) {
      snippet = descM[1].trim().replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').substring(0, 200);
    }

    items.push({ title, url: linkM?.[1]?.trim() || '', snippet, date });
    if (items.length >= 20) break;
  }
  return items;
}

/**
 * Parse HTML page and extract article links.
 *
 * V3.1: Two-pass strategy —
 * 1. Priority pass: links inside heading tags (h1-h3) or news-list containers
 * 2. Fallback pass: all links with meaningful text
 *
 * Ensures extracted titles are actual article headlines, not nav/toolbar text.
 */
function parseHTML(html: string, baseUrl: string, date: string): RawSearchItem[] {
  const items: RawSearchItem[] = [];
  const seen = new Set<string>();

  // ——— helper ———
  const addItem = (href: string, text: string) => {
    try { href = new URL(href, baseUrl).href; } catch { return; }
    if (seen.has(href)) return;
    seen.add(href);
    items.push({ title: text, url: href, snippet: '', date });
  };

  // ——— known nav/generic texts to skip ———
  const navSet = new Set([
    '首页', '上一页', '下一页', '返回', '登录', '注册', '关于', 'English',
    '网站地图', '手机版', 'APP下载', '客户端', '了解更多', '查看更多',
    '详情', '更多', '更多>>', '查看详情', '立即查看', '阅读全文', '全文',
  ]);

  // ——— heading tags with inline links (highest quality) ———
  const headingLinkRe = /<h[1-3][^>]*>\s*<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h[1-3]>/gi;
  let hm;
  while ((hm = headingLinkRe.exec(html)) !== null) {
    const text = hm[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 8 || navSet.has(text)) continue;
    addItem(hm[1], text);
    if (items.length >= 20) return items;
  }

  // ——— news-list patterns: <li> or <div class="list/news/item"> with links ———
  const listPatterns = [
    /<(?:li|div|span|p)\s[^>]*\b(?:list|item|news|title|headline)\b[^>]*>\s*<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<(?:li|div)>\s*<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  ];
  for (const re of listPatterns) {
    let lm;
    while ((lm = re.exec(html)) !== null) {
      const text = lm[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 10 || navSet.has(text)) continue;
      // skip if it looks like a date string
      if (/^\d{2,4}[-\/年月]/.test(text) && text.length < 14) continue;
      addItem(lm[1], text);
      if (items.length >= 20) return items;
    }
  }

  // ——— fallback: all links with meaningful text (> 12 chars) ———
  const linkRe = /<a\s(?:[^>]*\s)?href\s*=\s*["']([^"']+)["'][^>]*>(?:\s*<[^>]+>)*\s*([\s\S]*?)(?:\s*<[^>]+>)*\s*<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    let text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 12) continue;
    // skip pure nav/meta text
    if (navSet.has(text)) continue;
    if (/^([\d]+\s*(条|篇|项|个|笔|次)|共\d+页|第\d+页|关于我们|联系我们)$/.test(text)) continue;
    // skip URLs that look like media files
    if (/\.(jpg|jpeg|png|gif|mp4|webp|avif)(\?|$)/i.test(m[1])) continue;

    addItem(m[1], text);
    if (items.length >= 20) return items;
  }

  return items;
}

/**
 * Fetch all authoritative content (RSS + government pages).
 * All items get today's date — they're from the latest published content.
 */
export async function fetchAllAuthoritativeContent(): Promise<RawSearchItem[]> {
  const allItems: RawSearchItem[] = [];

  const allSources = [
    ...RSS_FEEDS.map(f => ({ ...f, type: 'rss' })),
    ...GOV_PAGES.map(p => ({ ...p, type: 'gov' })),
  ];

  // Fetch all in parallel
  const results = await Promise.allSettled(
    allSources.map(s => fetchPage(s.url, s.label).then(items => ({ ...s, items })))
  );

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { name, type, label, items } = r.value;
    if (items.length === 0) continue;

    for (const item of items) {
      (item as any)._searchProvider = `${type}-${name}`;
    }
    allItems.push(...items);
    console.log(`[ContentFetcher] ${type} ${label}: ${items.length} items`);
  }

  return allItems;
}
