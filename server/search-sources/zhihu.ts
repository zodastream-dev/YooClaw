// 知乎搜索源 — 通过 Tavily API + include_domains 获取 zhihu.com 内容
// （直接抓取 zhihu.com 返回 403，metaso API 配额耗尽，2026-05 起改用 Tavily）
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
      const resp = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          max_results: 15,
          include_domains: ['zhihu.com'],
          include_answer: false,
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!resp.ok) {
        console.warn('[ZhihuSearch] Tavily HTTP ' + resp.status);
        return [];
      }
      const data = await resp.json();
      const results = data.results || [];
      console.log('[ZhihuSearch] Tavily returned ' + results.length + ' results from zhihu.com');
      return results.slice(0, 15).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.content || r.snippet || '',
        date: r.published_date || '',
      }));
    } catch (e: any) {
      console.warn('[ZhihuSearch] Failed:', e.message);
      return [];
    }
  },
};

export default zhihuModule;
