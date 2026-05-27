import type { RawSearchItem, SearchModule } from './types';
import * as cheerio from 'cheerio';

interface EngineConfig {
  name: string;
  enabled: boolean;
  baseUrl: string;
  url: (q: string) => string;
}

const engines: EngineConfig[] = [
  { name: 'baidu', enabled: false, baseUrl: 'https://www.baidu.com', url: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}` },
  { name: 'bing',  enabled: true,  baseUrl: 'https://cn.bing.com',    url: (q) => `https://cn.bing.com/search?q=${encodeURIComponent(q)}&ensearch=0` },
  { name: 'sogou', enabled: true,  baseUrl: 'https://www.sogou.com',  url: (q) => `https://sogou.com/web?query=${encodeURIComponent(q)}` },
  { name: 'so360', enabled: false, baseUrl: 'https://www.so.com',     url: (q) => `https://www.so.com/s?q=${encodeURIComponent(q)}` },
];

// Browser-like headers to avoid basic bot detection
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

function resolveUrl(rawUrl: string, baseUrl: string): string {
  if (!rawUrl) return '';
  // Already absolute
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
  // Protocol-relative
  if (rawUrl.startsWith('//')) return 'https:' + rawUrl;
  // Relative — prepend base
  try {
    return new URL(rawUrl, baseUrl).href;
  } catch {
    return baseUrl + (rawUrl.startsWith('/') ? '' : '/') + rawUrl;
  }
}

function parseResults(html: string, engineName: string, baseUrl: string): RawSearchItem[] {
  const $ = cheerio.load(html);
  const items: RawSearchItem[] = [];
  const selectors: Record<string, { container: string; title: string; snippet: string; link: string }> = {
    baidu: { container: '.result', title: '.t a', snippet: '.c-abstract', link: '.t a' },
    bing:  { container: '.b_algo', title: 'h2 a', snippet: '.b_caption p', link: 'h2 a' },
    sogou: { container: '.results .vrwrap', title: '.vr-title', snippet: '.star-wiki, .str-text, .space-txt', link: 'a' },
    so360: { container: '.res-list > li', title: 'h3 a', snippet: '.res-desc', link: 'h3 a' },
  };
  const sel = selectors[engineName];
  if (!sel) return items;
  $(sel.container).each((_i: number, el: any) => {
    const title = $(el).find(sel.title).first().text().trim();
    const snippet = $(el).find(sel.snippet).first().text().trim();
    const rawUrl = $(el).find(sel.link).first().attr('href') || '';
    const url = resolveUrl(rawUrl, baseUrl);
    if (title) items.push({ title, url, snippet: snippet.substring(0, 200) });
  });
  return items;
}

const multiEngineModule: SearchModule = {
  name: 'multi-engine',
  label: '多引擎搜索',
  async search(query: string, _apiKey: string): Promise<RawSearchItem[]> {
    const activeEngines = engines.filter(e => e.enabled);
    if (activeEngines.length === 0) return [];

    const results = await Promise.allSettled(
      activeEngines.map(async (eng) => {
        const resp = await fetch(eng.url(query), {
          headers: BROWSER_HEADERS,
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) return [];
        const html = await resp.text();
        // Skip empty/captcha responses (< 1KB is definitely not real results)
        if (html.length < 1000) {
          console.log('[MultiEngine] ' + eng.name + ': response too small (' + html.length + ' bytes), likely blocked');
          return [];
        }
        return parseResults(html, eng.name, eng.baseUrl);
      })
    );
    const seen = new Set<string>();
    const merged: RawSearchItem[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const item of r.value) {
          const key = item.title.substring(0, 30);
          if (!seen.has(key)) { seen.add(key); merged.push(item); }
        }
      }
    }
    return merged;
  },
};

export default multiEngineModule;
