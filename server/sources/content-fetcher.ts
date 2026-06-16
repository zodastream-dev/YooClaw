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

// RSS feed 源（仅保留已验证可用的)
const RSS_FEEDS: { name: string; url: string; label: string }[] = [
  { name: 'ndrc', url: 'https://www.ndrc.gov.cn/fzggw/jgsj/fgs/sjdt/', label: '发改委政策' },
  { name: 'ndrc-news', url: 'https://www.ndrc.gov.cn/xwdt/xwfb/', label: '发改委新闻发布' },
  { name: 'mof', url: 'https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/', label: '财政部新闻' },
  { name: 'people', url: 'https://www.people.com.cn/', label: '人民网' },
  { name: 'xinhua', url: 'https://www.news.cn/', label: '新华网' },
  { name: 'ce', url: 'https://www.ce.cn/', label: '经济日报' },
  { name: 'financialnews', url: 'https://www.financialnews.com.cn/', label: '金融时报' },
  { name: 'jfdaily', url: 'https://www.jfdaily.com/', label: '解放日报' },
  { name: 'gmw', url: 'https://www.gmw.cn/', label: '光明日报' },
  { name: 'cnr', url: 'https://www.cnr.cn/', label: '央广网' },
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
 */
function parseHTML(html: string, baseUrl: string, date: string): RawSearchItem[] {
  const items: RawSearchItem[] = [];
  const seen = new Set<string>();

  // Extract all links with text content > 5 chars
  const linkPattern = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    let href = match[1];
    let text = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 4) continue;

    // Filter out navigation links (short text, likely menu items)
    const navWords = ['首页', '上一页', '下一页', '返回', '登录', '注册', '关于', 'English', '首页', '网站地图'];
    if (navWords.includes(text)) continue;

    // Resolve relative URLs
    try {
      href = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    if (seen.has(href)) continue;
    seen.add(href);

    items.push({ title: text, url: href, snippet: '', date });
    if (items.length >= 20) break;
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
