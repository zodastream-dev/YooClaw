// 知乎搜索源 — 通过 metaso API 搜索 zhihu.com 内容
// （直接抓取 zhihu.com 返回 403，2026-05 起已不可用）
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
      // 用 metaso API 搜索知乎内容，追加"知乎"引导搜索平台
      const searchQuery = query + ' 知乎';
      const resp = await fetch('https://metaso.cn/api/open/search/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ question: searchQuery, lang: 'zh' }),
        signal: AbortSignal.timeout(25000),
      });
      if (!resp.ok) {
        console.warn('[ZhihuSearch] Metaso HTTP ' + resp.status);
        return [];
      }
      const data = await resp.json();
      const rawData = (data.data?.references) ? data.data.references : (data.data || []);
      const results: any[] = Array.isArray(rawData) ? rawData : (rawData.results || rawData.items || [rawData]);

      // 仅保留 zhihu.com 域名的结果
      const filtered = results.filter((r: any) => {
        const url = (r.url || r.link || '').toLowerCase();
        return url.includes('zhihu.com');
      });

      console.log('[ZhihuSearch] Metaso returned ' + results.length + ' total, ' + filtered.length + ' from zhihu');

      return filtered.slice(0, 15).map((r: any) => ({
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
