// 小红书搜索源 — 通过秘塔 API + site:xiaohongshu.com 搜索，失败时 fallback 到一般搜索
import type { RawSearchItem, SearchModule } from './types';

const xiaohongshuModule: SearchModule = {
  name: 'xiaohongshu',
  label: '小红书',
  async search(query: string, apiKey: string): Promise<RawSearchItem[]> {
    if (!apiKey) {
      console.warn('[XHSSearch] No API key, skipping');
      return [];
    }
    const mapResults = (rawData: any): RawSearchItem[] => {
      const results: any[] = Array.isArray(rawData) ? rawData : (rawData.results || rawData.items || rawData.references || [rawData]);
      return results.slice(0, 15).map((r: any) => ({
        title: r.title || r.name || '',
        url: r.url || r.link || '',
        snippet: r.snippet || r.summary || r.content || r.aiSummary || '',
        date: r.date || r.publishedAt || r.publishTime || '',
      }));
    };

    // Strategy 1: site:xiaohongshu.com
    try {
      const resp = await fetch('https://metaso.cn/api/open/search/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ question: `${query} site:xiaohongshu.com`, lang: 'zh' }),
        signal: AbortSignal.timeout(25000),
      });
      if (resp.ok) {
        const data = await resp.json();
        const rawData = data.data?.references || data.data || data.results || data.items || [];
        const items = mapResults(rawData);
        if (items.length > 0) {
          console.log('[XHSSearch] site:xiaohongshu.com returned ' + items.length + ' results');
          return items;
        }
      }
    } catch (e: any) {
      console.warn('[XHSSearch] site: attempt failed:', e.message);
    }

    // Strategy 2: fallback to general metaso search without site:
    try {
      console.log('[XHSSearch] site: returned 0, falling back to general search');
      const resp = await fetch('https://metaso.cn/api/open/search/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ question: `${query} 小红书`, lang: 'zh' }),
        signal: AbortSignal.timeout(25000),
      });
      if (!resp.ok) {
        console.warn('[XHSSearch] Fallback HTTP ' + resp.status);
        return [];
      }
      const data = await resp.json();
      const rawData = data.data?.references || data.data || data.results || data.items || [];
      const items = mapResults(rawData);
      console.log('[XHSSearch] Fallback returned ' + items.length + ' results (小红书-topic)');
      return items;
    } catch (e: any) {
      console.warn('[XHSSearch] Fallback failed:', e.message);
      return [];
    }
  },
};

export default xiaohongshuModule;
