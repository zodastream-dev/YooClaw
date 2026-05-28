// 知乎搜索源 — 通过秘塔 API + site:zhihu.com 搜索，失败时 fallback 到一般搜索
import type { RawSearchItem, SearchModule } from './types';

const zhihuModule: SearchModule = {
  name: 'zhihu',
  label: '知乎',
  async search(query: string, apiKey: string): Promise<RawSearchItem[]> {
    if (!apiKey) {
      console.warn('[ZhihuSearch] No API key, skipping');
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

    // Strategy 1: site:zhihu.com
    try {
      const resp = await fetch('https://metaso.cn/api/open/search/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ question: `${query} site:zhihu.com`, lang: 'zh' }),
        signal: AbortSignal.timeout(25000),
      });
      if (resp.ok) {
        const data = await resp.json();
        const rawData = data.data?.references || data.data || data.results || data.items || [];
        const items = mapResults(rawData);
        if (items.length > 0) {
          console.log('[ZhihuSearch] site:zhihu.com returned ' + items.length + ' results');
          return items;
        }
      }
    } catch (e: any) {
      console.warn('[ZhihuSearch] site: attempt failed:', e.message);
    }

    // Strategy 2: fallback to general metaso search without site:
    try {
      console.log('[ZhihuSearch] site: returned 0, falling back to general search');
      const resp = await fetch('https://metaso.cn/api/open/search/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ question: `${query} 知乎`, lang: 'zh' }),
        signal: AbortSignal.timeout(25000),
      });
      if (!resp.ok) {
        console.warn('[ZhihuSearch] Fallback HTTP ' + resp.status);
        return [];
      }
      const data = await resp.json();
      const rawData = data.data?.references || data.data || data.results || data.items || [];
      const items = mapResults(rawData);
      console.log('[ZhihuSearch] Fallback returned ' + items.length + ' results (知乎-topic)');
      return items;
    } catch (e: any) {
      console.warn('[ZhihuSearch] Fallback failed:', e.message);
      return [];
    }
  },
};

export default zhihuModule;
