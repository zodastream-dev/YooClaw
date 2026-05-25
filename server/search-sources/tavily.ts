import type { RawSearchItem, SearchModule } from './types';

const tavilyModule: SearchModule = {
  name: 'tavily',
  label: 'Tavily',
  async search(query: string, apiKey: string): Promise<RawSearchItem[]> {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ query, search_depth: 'basic', max_results: 10, topic: 'news', include_answer: false }),
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error('Tavily API错误: ' + resp.status + ' ' + errText.substring(0, 200));
    }
    const data = await resp.json();
    return (data.results || []).slice(0, 10).map((r: any) => ({
      title: r.title || r.name || '',
      url: r.url || r.link || '',
      snippet: r.content || r.snippet || '',
      date: r.published_date || '',
    }));
  },
};

export default tavilyModule;
