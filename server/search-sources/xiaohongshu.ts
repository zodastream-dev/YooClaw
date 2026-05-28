// 小红书搜索源 — 通过秘塔 API 搜索 xiaohongshu.com 内容
// （直接抓取+百度兜底均失败，Tavily 偏英文不适合国内市场，2026-05 切回秘塔）
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
      const resp = await fetch('https://metaso.cn/api/open/search/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ question: `${query} 小红书`, lang: 'zh' }),
        signal: AbortSignal.timeout(25000),
      });
      if (!resp.ok) {
        console.warn('[XHSSearch] Metaso HTTP ' + resp.status);
        return [];
      }
      const data = await resp.json();
      const rawData = data.data?.references || data.data || data.results || data.items || [];
      const results: any[] = Array.isArray(rawData) ? rawData : (rawData.results || rawData.items || rawData.references || [rawData]);
      console.log('[XHSSearch] Metaso returned ' + results.length + ' total, filtering xiaohongshu.com');
      return results
        .filter((r: any) => {
          const url = (r.url || r.link || '').toLowerCase();
          return url.includes('xiaohongshu.com');
        })
        .slice(0, 15)
        .map((r: any) => ({
          title: r.title || r.name || '',
          url: r.url || r.link || '',
          snippet: r.snippet || r.summary || r.content || r.aiSummary || '',
          date: r.date || r.publishedAt || r.publishTime || '',
        }));
    } catch (e: any) {
      console.warn('[XHSSearch] Failed:', e.message);
      return [];
    }
  },
};

export default xiaohongshuModule;
