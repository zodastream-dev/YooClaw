// 小红书搜索源 — 通过 metaso API 搜索 xiaohongshu.com 内容
// （直接抓取 + 百度兜底均失败：INITIAL_STATE 无搜索结果、百度反爬，2026-05 起已不可用）
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
      // 用 metaso API 搜索小红书内容，追加"小红书"引导搜索平台
      const searchQuery = query + ' 小红书';
      const resp = await fetch('https://metaso.cn/api/open/search/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ question: searchQuery, lang: 'zh' }),
        signal: AbortSignal.timeout(25000),
      });
      if (!resp.ok) {
        console.warn('[XHSSearch] Metaso HTTP ' + resp.status);
        return [];
      }
      const data = await resp.json();
      const rawData = (data.data?.references) ? data.data.references : (data.data || []);
      const results: any[] = Array.isArray(rawData) ? rawData : (rawData.results || rawData.items || [rawData]);

      // 仅保留 xiaohongshu.com 域名的结果
      const filtered = results.filter((r: any) => {
        const url = (r.url || r.link || '').toLowerCase();
        return url.includes('xiaohongshu.com') || url.includes('xhslink.com');
      });

      console.log('[XHSSearch] Metaso returned ' + results.length + ' total, ' + filtered.length + ' from xiaohongshu');

      return filtered.slice(0, 15).map((r: any) => ({
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
