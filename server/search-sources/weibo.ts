// 微博搜索源 — 通过 metaso API 搜索 weibo.com 内容
// （直接抓取 s.weibo.com 被 JS 验证页拦截，2026-05 起已不可用）
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
      // 用 metaso API 搜索微博内容，追加"微博"引导搜索平台
      const searchQuery = query + ' 微博';
      const resp = await fetch('https://metaso.cn/api/open/search/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ question: searchQuery, lang: 'zh' }),
        signal: AbortSignal.timeout(25000),
      });
      if (!resp.ok) {
        console.warn('[WeiboSearch] Metaso HTTP ' + resp.status);
        return [];
      }
      const data = await resp.json();
      const rawData = (data.data?.references) ? data.data.references : (data.data || []);
      const results: any[] = Array.isArray(rawData) ? rawData : (rawData.results || rawData.items || [rawData]);

      // 仅保留 weibo.com 域名的结果
      const filtered = results.filter((r: any) => {
        const url = (r.url || r.link || '').toLowerCase();
        return url.includes('weibo.com') || url.includes('weibo.cn');
      });

      console.log('[WeiboSearch] Metaso returned ' + results.length + ' total, ' + filtered.length + ' from weibo');

      return filtered.slice(0, 15).map((r: any) => ({
        title: r.title || r.name || '',
        url: r.url || r.link || '',
        snippet: r.snippet || r.summary || r.content || r.aiSummary || '',
        date: r.date || r.publishedAt || r.publishTime || '',
      }));
    } catch (e: any) {
      console.warn('[WeiboSearch] Failed:', e.message);
      return [];
    }
  },
};

export default weiboModule;
