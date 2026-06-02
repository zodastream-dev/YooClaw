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
        console.warn('[Tianapi:' + category + '] No API key, skipping');
        return [];
      }

      const url = new URL('https://apis.tianapi.com/' + category + '/index');
      url.searchParams.set('key', apiKey);
      url.searchParams.set('num', '10');
      if (query) url.searchParams.set('word', query);

      try {
        const apiUrl = url.toString();
        const resp = await enqueueTianapi(() => fetch(apiUrl, {
          signal: AbortSignal.timeout(15000),
        }));
        if (!resp.ok) {
          console.warn('[Tianapi:' + category + '] HTTP ' + resp.status);
          return [];
        }
        const data = await resp.json();
        if (data.code !== 200) {
          console.warn('[Tianapi:' + category + '] API code=' + data.code + ' msg=' + (data.msg || 'unknown') + ' query=' + (query || '(latest)'));
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
        console.warn('[Tianapi:' + category + '] Error:', e.message);
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
