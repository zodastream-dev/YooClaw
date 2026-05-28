// 知乎搜索源 — 通过秘塔 API + site:zhihu.com 搜索知乎内容
import type { RawSearchItem, SearchModule } from './types';

const zhihuModule: SearchModule = {
  name: 'zhihu',
  label: '知乎',
  async search(query: string, apiKey: string): Promise<RawSearchItem[]> {
    if (!apiKey) {
      console.warn('[ZhihuSearch] No API key, skipping');
      return [];
    }
    try {
      const resp = await fetch('https://metaso.cn/api/open/search/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ question: `${query} site:zhihu.com`, lang: 'zh' }),
        signal: AbortSignal.timeout(25000),
      });
      if (!resp.ok) {
        console.warn('[ZhihuSearch] Metaso HTTP ' + resp.status);
        return [];
      }
      const data = await resp.json();
      const rawData = data.data?.references || data.data || data.results || data.items || [];
      const results: any[] = Array.isArray(rawData) ? rawData : (rawData.results || rawData.items || rawData.references || [rawData]);
      console.log('[ZhihuSearch] Metaso returned ' + results.length + ' results (site:zhihu.com)');
      return results.slice(0, 15).map((r: any) => ({
        title: r.title || r.name || '',
        url: r.url || r.link || '',
        snippet: r.snippet || r.summary || r.content || r.aiSummary || '',
        date: r.date || r.publishedAt || r.publishTime || '',
      }));
    } catch (e: any) {
      console.warn('[ZhihuSearch] Failed:', e.message);
      return [];
    }
  },
};

export default zhihuModule;
