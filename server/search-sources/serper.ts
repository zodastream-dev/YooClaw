import type { RawSearchItem, SearchModule } from './types';

async function fetchSerper(query: string, apiKey: string, timeoutMs = 25000): Promise<Response> {
  return await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({ q: query, num: 20, gl: 'cn', hl: 'zh-cn' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

const serperModule: SearchModule = {
  name: 'serper',
  label: 'Serper搜索',
  async search(query: string, apiKey: string): Promise<RawSearchItem[]> {
    let resp: Response;
    try {
      resp = await fetchSerper(query, apiKey, 25000);
    } catch (e: any) {
      console.warn('[Serper] First attempt failed: ' + e.message + ', retrying...');
      resp = await fetchSerper(query, apiKey, 40000);
    }
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error('Serper API错误: ' + resp.status + ' ' + errText.substring(0, 200));
    }
    const data = await resp.json();
    const results: any[] = data.organic || [];
    return results.slice(0, 20).map((r: any) => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
      date: r.date || '',
    }));
  },
};

export default serperModule;
