// 天聚数行新闻资讯搜索源 — factory pattern, one file = 8 modules
import type { RawSearchItem, SearchModule } from './types';

// =============================================================================
// Global rate-limited queue for all tianapi calls (max 1 req/sec)
// Prevents "API调用频率超限" errors under concurrent portal loads
// =============================================================================
let tianapiQueue: Promise<any> = Promise.resolve();

function enqueueTianapi<T>(fn: () => Promise<T>): Promise<T> {
  const prev = tianapiQueue;
  const next = prev.then(async () => {
    await new Promise(resolve => setTimeout(resolve, 1100)); // 1.1s gap (safe margin)
    return fn();
  }).catch(async (e) => {
    // Ensure gap even on error, then re-throw
    await new Promise(resolve => setTimeout(resolve, 1100));
    throw e;
  });
  // Always advance the queue to avoid stale promise blocking
  tianapiQueue = next.catch(() => {});
  return next;
}
// =============================================================================

// Categories: API path → Chinese label for UI
export const TIANAPI_CATEGORIES: Record<string, string> = {
  keji: '科技',
  ai: 'AI',
  guonei: '国内',
  world: '国际',
  social: '社会',
  generalnews: '综合',
  caijing: '财经',
  internet: '互联网',
};

// Factory: create a SearchModule for a single tianapi news category
function createTianapiModule(category: string, label: string): SearchModule {
  const name = 'tianapi-' + category;
  return {
    name,
    label: '天聚' + label,
    async search(query: string, apiKey: string): Promise<RawSearchItem[]> {
      if (!apiKey) {
        console.log('[Tianapi:' + category + '] No API key, skipping');
        return [];
      }

      const url = new URL('https://apis.tianapi.com/' + category + '/index');
      url.searchParams.set('key', apiKey);
      url.searchParams.set('num', '10');
      // Tianapi word param: no OR syntax, limited length, simple query only
      // Tianapi's index is VERY shallow — only generic hot terms hit (e.g. "宠物","科技").
      // Brand names ("疯狂小狗") and compound phrases ("宠物行业市场规模") always return empty.
      // Strategy: extract the shortest generic term from the query; skip if none found.
      let searchWord = '';
      if (query) {
        // Remove OR operators (tianapi doesn't support boolean syntax)
        const cleaned = query.replace(/\s+OR\s+/gi, ' ');
        const words = cleaned.split(/\s+/).filter(Boolean);
        const seenWords = new Set<string>();
        const uniqueWords: string[] = [];
        for (const w of words) {
          const lower = w.toLowerCase();
          if (!seenWords.has(lower)) {
            seenWords.add(lower);
            uniqueWords.push(w);
          }
        }
        // Drop temporal/generic noise words
        const temporalWords = new Set(['最新', '本月', '今年', '2026', '2026年', '动态', '趋势', '分析', '报告', '资讯', '新闻', 'q2', 'q3', 'q4']);
        const coreWords = uniqueWords.filter(w => !temporalWords.has(w) && w.length >= 2);
        // Sort by length (shortest first) — tianapi prefers short generic terms
        coreWords.sort((a, b) => a.length - b.length);
        if (coreWords.length > 0) {
          const shortest = coreWords[0];
          if (shortest.length <= 6) {
            searchWord = shortest;
          } else {
            // Long compound phrase: try to extract a known generic sub-term
            const generics = ['宠物', '科技', 'AI', '汽车', '手机', '芯片', '游戏', '电商', '医疗', '教育', '金融', '房地产', '互联网', '人工智能', '新能源', '半导体'];
            const found = generics.find(g => shortest.includes(g));
            if (found) searchWord = found;
          }
        }
        if (searchWord) url.searchParams.set('word', searchWord);
      }

      try {
        const apiUrl = url.toString();
        const resp = await enqueueTianapi(() => fetch(apiUrl, {
          signal: AbortSignal.timeout(15000),
        }));
        if (!resp.ok) {
          console.log('[Tianapi:' + category + '] HTTP ' + resp.status);
          return [];
        }
        const data = await resp.json();
        if (data.code !== 200) {
          // code=150 "API可用次数不足" (quota exhausted) vs code=250 "数据返回为空" (no match)
          if (data.code === 150) {
            console.warn('[Tianapi:' + category + '] QUOTA EXHAUSTED (code=150) — 天聚API可用次数不足，请充值! word=' + (searchWord || '(none)'));
          } else {
            console.log('[Tianapi:' + category + '] No match (code=' + data.code + ') for word=' + (searchWord || '(none)') + ' originalQuery=' + (query ? query.substring(0, 60) : '(none)'));
          }
          return [];
        }

        const items = (data.result?.newslist || []) as any[];
        const results: RawSearchItem[] = [];
        for (const item of items) {
          if (!item.title) continue;
          results.push({
            title: String(item.title).trim(),
            url: item.url || '',
            snippet: item.description || '',
            date: item.ctime || '',
          });
        }

        console.log('[Tianapi:' + category + '] Returned ' + results.length + ' results (query: ' + (query ? query.substring(0, 50) : '(latest)') + ')');
        return results;
      } catch (e: any) {
        console.log('[Tianapi:' + category + '] Error (non-fatal):', e.message);
        return [];
      }
    },
  };
}

// Export 8 module instances — one per tianapi news category
export const tianapiKejiModule = createTianapiModule('keji', '科技');
export const tianapiAiModule = createTianapiModule('ai', 'AI');
export const tianapiGuoneiModule = createTianapiModule('guonei', '国内');
export const tianapiWorldModule = createTianapiModule('world', '国际');
export const tianapiSocialModule = createTianapiModule('social', '社会');
export const tianapiGeneralnewsModule = createTianapiModule('generalnews', '综合');
export const tianapiCaijingModule = createTianapiModule('caijing', '财经');
export const tianapiInternetModule = createTianapiModule('internet', '互联网');

// Convenience: all tianapi modules as array
export const tianapiModules: SearchModule[] = [
  tianapiKejiModule,
  tianapiAiModule,
  tianapiGuoneiModule,
  tianapiWorldModule,
  tianapiSocialModule,
  tianapiGeneralnewsModule,
  tianapiCaijingModule,
  tianapiInternetModule,
];
