import type { RawSearchItem, SearchModule } from './types';

const metasoModule: SearchModule = {
  name: 'metaso',
  label: '秘塔搜索',
  async search(query: string, apiKey: string): Promise<RawSearchItem[]> {
    const resp = await fetch('https://metaso.cn/api/open/search/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ question: query, lang: 'zh' }),
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error('秘塔API错误: ' + resp.status + ' ' + errText.substring(0, 200));
    }
    const data = await resp.json();
    const rawData = (data.data?.references) ? data.data.references : (data.data || data.results || data.items || []);
    const results: any[] = Array.isArray(rawData) ? rawData : (rawData.results || rawData.items || rawData.references || [rawData]);
    return results.slice(0, 30).map((r: any) => ({
      title: r.title || r.name || '',
      url: r.url || r.link || '',
      snippet: r.snippet || r.summary || r.content || r.aiSummary || '',
      date: r.date || r.publishedAt || r.publishTime || '',
    }));
  },
};

export default metasoModule;
