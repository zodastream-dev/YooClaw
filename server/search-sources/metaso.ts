import type { RawSearchItem, SearchModule } from './types';

// V2.1: 搜索接口（1点/次）
async function fetchMetaso(query: string, apiKey: string, timeoutMs = 25000): Promise<Response> {
  return await fetch('https://metaso.cn/api/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ q: query, scope: '网页', size: 30 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

const metasoModule: SearchModule = {
  name: 'metaso',
  label: '秘塔搜索',
  async search(query: string, apiKey: string): Promise<RawSearchItem[]> {
    let resp: Response;
    try {
      resp = await fetchMetaso(query, apiKey, 30000);
    } catch (e: any) {
      // Retry once with longer timeout
      console.warn('[MetasoSearch] First attempt failed: ' + e.message + ', retrying...');
      resp = await fetchMetaso(query, apiKey, 40000);
    }
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error('秘塔API错误: ' + resp.status + ' ' + errText.substring(0, 200));
    }
    const data = await resp.json();
    // V2.1: 搜索接口返回格式（data.items / data.results）
    // V2.5: API changed — results now under top-level 'webpages' array
    const rawData = data.webpages || data.data?.items || data.data?.results || data.data || data.results || data.items || [];
    const results: any[] = Array.isArray(rawData) ? rawData : (rawData.results || rawData.items || rawData.webpages || [rawData]);
    return results.slice(0, 30).map((r: any) => ({
      title: r.title || r.name || '',
      url: r.url || r.link || '',
      snippet: r.snippet || r.summary || r.content || '',
      date: r.date || r.publishedAt || r.publishTime || '',
    }));
  },
};

export default metasoModule;
