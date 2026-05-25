import type { RawSearchItem, SearchModule } from './types';
import * as cheerio from 'cheerio';

const engines = [
  { name: 'baidu', url: (q: string) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}` },
  { name: 'bing', url: (q: string) => `https://cn.bing.com/search?q=${encodeURIComponent(q)}&ensearch=0` },
  { name: 'sogou', url: (q: string) => `https://sogou.com/web?query=${encodeURIComponent(q)}` },
  { name: 'so360', url: (q: string) => `https://www.so.com/s?q=${encodeURIComponent(q)}` },
];

function parseResults(html: string, engineName: string): RawSearchItem[] {
  const $ = cheerio.load(html);
  const items: RawSearchItem[] = [];
  const selectors: Record<string, { container: string; title: string; snippet: string; link: string }> = {
    baidu: { container: '.result', title: '.t a', snippet: '.c-abstract', link: '.t a' },
    bing: { container: '.b_algo', title: 'h2 a', snippet: '.b_caption p', link: 'h2 a' },
    sogou: { container: '.results .vrwrap', title: '.vr-title', snippet: '.star-wiki, .str-text, .space-txt', link: 'a' },
    so360: { container: '.res-list > li', title: 'h3 a', snippet: '.res-desc', link: 'h3 a' },
  };
  const sel = selectors[engineName];
  if (!sel) return items;
  $(sel.container).each((_i: number, el: any) => {
    const title = $(el).find(sel.title).first().text().trim();
    const snippet = $(el).find(sel.snippet).first().text().trim();
    const url = $(el).find(sel.link).first().attr('href') || '';
    if (title) items.push({ title, url, snippet: snippet.substring(0, 200) });
  });
  return items;
}

const multiEngineModule: SearchModule = {
  name: 'multi-engine',
  label: '多幕擜索搜索',
  async search(query: string, _apiKey: string): Promise<RawSearchItem[]> {
    const results = await Promise.allSettled(
      engines.map(async (eng) => {
        const resp = await fetch(eng.url(query), {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) return [];
        const html = await resp.text();
        return parseResults(html, eng.name);
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
