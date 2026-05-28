// 小红书搜索源 — 通过 Tavily API + include_domains 获取 xiaohongshu.com 内容
// （直接抓取+百度兜底均失败，metaso API 配额耗尽，2026-05 起改用 Tavily）
import type { RawSearchItem, SearchModule } from './types';

const xiaohongshuModule: SearchModule = {
  name: 'xiaohongshu',
  label: '小红书',
  async search(query: string, apiKey: string): Promise<RawSearchItem[]> {
    if (!apiKey) {
      console.warn('[XHSSearch] No API key, skipping');
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
          include_domains: ['xiaohongshu.com'],
          include_answer: false,
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!resp.ok) {
        console.warn('[XHSSearch] Tavily HTTP ' + resp.status);
        return [];
      }
      const data = await resp.json();
      const results = data.results || [];
      console.log('[XHSSearch] Tavily returned ' + results.length + ' results from xiaohongshu.com');
      return results.slice(0, 15).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.content || r.snippet || '',
        date: r.published_date || '',
      }));
    } catch (e: any) {
      console.warn('[XHSSearch] Failed:', e.message);
      return [];
    }
  },
};

export default xiaohongshuModule;
