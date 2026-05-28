// 微博搜索源 — 通过 Tavily API + include_domains 获取 weibo.com 内容
// （直接抓取 s.weibo.com 被 JS 验证页拦截，metaso API 配额耗尽，2026-05 起改用 Tavily）
import type { RawSearchItem, SearchModule } from './types';

const weiboModule: SearchModule = {
  name: 'weibo',
  label: '微博',
  async search(query: string, apiKey: string): Promise<RawSearchItem[]> {
    if (!apiKey) {
      console.warn('[WeiboSearch] No API key, skipping');
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
          include_domains: ['weibo.com'],
          include_answer: false,
        }),
        signal: AbortSignal.timeout(35000),
      });
      if (!resp.ok) {
        console.warn('[WeiboSearch] Tavily HTTP ' + resp.status);
        return [];
      }
      const data = await resp.json();
      const results = data.results || [];
      console.log('[WeiboSearch] Tavily returned ' + results.length + ' results from weibo.com');
      return results.slice(0, 15).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.content || r.snippet || '',
        date: r.published_date || '',
      }));
    } catch (e: any) {
      console.warn('[WeiboSearch] Failed:', e.message);
      return [];
    }
  },
};

export default weiboModule;
