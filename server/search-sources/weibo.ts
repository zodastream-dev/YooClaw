// 微博搜索源 — 通过秘塔搜索 API + site:weibo.com 搜索微博内容（V2.1: 搜索接口10点/次）
import type { RawSearchItem, SearchModule } from './types';

async function fetchWithRetry(apiKey: string, query: string, maxRetries = 2): Promise<Response> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch('https://metaso.cn/api/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ q: `${query} site:weibo.com`, scope: '网页', size: 15 }),
        signal: AbortSignal.timeout(25000),
      });
    } catch (e: any) {
      lastError = e;
      if (attempt < maxRetries) {
        console.warn('[WeiboSearch] Attempt ' + (attempt + 1) + ' failed, retrying in 2s:', e.message);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  throw lastError;
}

const weiboModule: SearchModule = {
  name: 'weibo',
  label: '微博',
  async search(query: string, apiKey: string): Promise<RawSearchItem[]> {
    if (!apiKey) {
      console.warn('[WeiboSearch] No API key, skipping');
      return [];
    }
    try {
      const resp = await fetchWithRetry(apiKey, query);
      if (!resp.ok) {
        console.warn('[WeiboSearch] Metaso HTTP ' + resp.status);
        return [];
      }
      const data = await resp.json();
      const rawData = data.data?.items || data.data?.results || data.data || data.results || data.items || [];
      const results: any[] = Array.isArray(rawData) ? rawData : (rawData.results || rawData.items || [rawData]);
      console.log('[WeiboSearch] Metaso returned ' + results.length + ' results (site:weibo.com)');
      return results.slice(0, 15).map((r: any) => ({
        title: r.title || r.name || '',
        url: r.url || r.link || '',
        snippet: r.snippet || r.summary || r.content || '',
        date: r.date || r.publishedAt || r.publishTime || '',
      }));
    } catch (e: any) {
      console.warn('[WeiboSearch] All retries exhausted:', e.message);
      return [];
    }
  },
};

export default weiboModule;
