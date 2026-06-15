/**
 * V3.0: 全量拉取引擎 — RSS 聚合 + 政府站点爬虫
 *
 * 与 Serper site: 关键词搜索不同，本模块对指定权威信源做"全量采样"：
 * - RSS feeds: 拉取当日全部文章
 * - 政府站点: 抓取列表页所有链接标题
 *
 * 不做任何关键词过滤，所有原始内容直接喂给 DeepSeek 意图解码器。
 */

import { RawSearchItem } from '../search-sources/types.js';

// RSS feed 源配置
const RSS_FEEDS: { name: string; url: string; label: string }[] = [
  { name: 'pbc', url: 'http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/11040/index1.html', label: '央行沟通交流' },
  { name: 'ndrc', url: 'https://www.ndrc.gov.cn/fzggw/jgsj/fgs/sjdt/index.xml', label: '发改委政策动态' },
  { name: 'mof', url: 'https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/index.xml', label: '财政部新闻' },
  { name: 'people-finance', url: 'http://finance.people.com.cn/rss/finance.xml', label: '人民网财经' },
  { name: 'xinhua-fortune', url: 'http://www.news.cn/fortune/rss.xml', label: '新华网财经' },
];

// 政府站点列表页 — 抓取当日发布的所有链接
const GOV_PAGES: { name: string; url: string; label: string; selector: string }[] = [
  {
    name: 'cbirc-license',
    url: 'https://www.cbirc.gov.cn/branch/beijing/view/pages/common/ItemList.html?itemPId=1184',
    label: '金监总局行政许可',
    selector: '.list-group a, .list-con a, .list-unstyled a',
  },
  {
    name: 'cbirc-penalty',
    url: 'https://www.cbirc.gov.cn/branch/beijing/view/pages/common/ItemList.html?itemPId=1185',
    label: '金监总局行政处罚',
    selector: '.list-group a, .list-con a, .list-unstyled a',
  },
  {
    name: 'mee-eia',
    url: 'https://www.mee.gov.cn/ywgz/hjyxpj/jsxmhjyxpj/',
    label: '生态环境部环评',
    selector: '.list_main a, #main_body a, .main a',
  },
  {
    name: 'fgw-beijing',
    url: 'https://fgw.beijing.gov.cn/fzggzl/xmsqxx/pzjg/',
    label: '北京发改委项目审批',
    selector: '.listContent a, .list_table a, .main a',
  },
];

/**
 * Fetch a single RSS feed and return all items.
 */
async function fetchRSS(feed: typeof RSS_FEEDS[0]): Promise<RawSearchItem[]> {
  try {
    const resp = await fetch(feed.url, {
      headers: { 'User-Agent': 'YooClaw/3.0 RSS Reader' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      console.warn(`[RSS] ${feed.label}: HTTP ${resp.status}`);
      return [];
    }
    const xml = await resp.text();

    // Simple RSS 2.0 XML parser (avoids extra dependency)
    const items: RawSearchItem[] = [];
    const itemBlocks = xml.split('<item>').slice(1);
    for (const block of itemBlocks) {
      const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?<\/title>/s);
      const linkMatch = block.match(/<link>(.+?)<\/link>/);
      const descMatch = block.match(/<description>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?<\/description>/s);
      const dateMatch = block.match(/<pubDate>(.+?)<\/pubDate>/);

      if (!titleMatch) continue;
      const title = titleMatch[1].trim().replace(/<[^>]+>/g, '');
      if (!title || title.length < 3) continue;

      let date = '';
      if (dateMatch) {
        const d = new Date(dateMatch[1]);
        if (!isNaN(d.getTime())) date = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
      }

      items.push({
        title,
        url: linkMatch?.[1]?.trim() || '',
        snippet: descMatch ? descMatch[1].trim().replace(/<[^>]+>/g, '').substring(0, 200) : '',
        date,
      });
    }
    return items;
  } catch (e: any) {
    console.warn(`[RSS] ${feed.label}: ${e.message}`);
    return [];
  }
}

/**
 * Fetch a government page and extract article links.
 */
async function fetchGovPage(page: typeof GOV_PAGES[0]): Promise<RawSearchItem[]> {
  try {
    const resp = await fetch(page.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YooClaw/3.0)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) {
      console.warn(`[GovPage] ${page.label}: HTTP ${resp.status}`);
      return [];
    }
    const html = await resp.text();

    // Extract links with titles using regex (avoids cheerio dependency for server)
    // Pattern: <a href="...">title</a>
    const linkPattern = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const items: RawSearchItem[] = [];
    const seen = new Set<string>();
    let match;
    while ((match = linkPattern.exec(html)) !== null) {
      let href = match[1];
      let text = match[2].replace(/<[^>]+>/g, '').trim();
      if (!text || text.length < 5) continue;

      // Resolve relative URLs
      if (href.startsWith('/')) {
        const base = new URL(page.url);
        href = `${base.protocol}//${base.host}${href}`;
      } else if (!href.startsWith('http')) {
        const base = page.url.substring(0, page.url.lastIndexOf('/') + 1);
        href = base + href;
      }

      // Deduplicate by URL
      if (seen.has(href)) continue;
      seen.add(href);

      items.push({ title: text, url: href, snippet: '', date: '' });
      if (items.length >= 30) break; // Cap per page
    }
    return items;
  } catch (e: any) {
    console.warn(`[GovPage] ${page.label}: ${e.message}`);
    return [];
  }
}

/**
 * Fetch all authoritative content (RSS + government pages).
 * Returns RawSearchItem[] suitable for merging into the intel pipeline.
 */
export async function fetchAllAuthoritativeContent(): Promise<RawSearchItem[]> {
  const allItems: RawSearchItem[] = [];

  // Fetch RSS feeds in parallel
  const rssResults = await Promise.allSettled(RSS_FEEDS.map(f => fetchRSS(f)));
  for (let i = 0; i < rssResults.length; i++) {
    const r = rssResults[i];
    if (r.status === 'fulfilled' && r.value.length > 0) {
      for (const item of r.value) {
        item._searchProvider = `rss-${RSS_FEEDS[i].name}` as any;
      }
      allItems.push(...r.value);
      console.log(`[ContentFetcher] RSS ${RSS_FEEDS[i].label}: ${r.value.length} items`);
    }
  }

  // Fetch government pages in parallel
  const govResults = await Promise.allSettled(GOV_PAGES.map(p => fetchGovPage(p)));
  for (let i = 0; i < govResults.length; i++) {
    const r = govResults[i];
    if (r.status === 'fulfilled' && r.value.length > 0) {
      for (const item of r.value) {
        item._searchProvider = `gov-${GOV_PAGES[i].name}` as any;
      }
      allItems.push(...r.value);
      console.log(`[ContentFetcher] Gov ${GOV_PAGES[i].label}: ${r.value.length} items`);
    }
  }

  return allItems;
}
