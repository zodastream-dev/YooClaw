// Intel pipeline: search + DeepSeek analysis
import { getSearchModule, getAllModules } from './search-sources/index.js';

// API key mapping per provider
function getProviderKey(provider: string): string {
  if (provider === 'metaso') return process.env.METASO_API_KEY || '';
  if (provider === 'tavily') return process.env.TAVILY_API_KEY || '';
  return '';
}

export async function callIntel(effectiveKwArr: string[], src: any, objectName?: string): Promise<any[]> {
  const provider = src.aiProvider || 'all';
  const model = src.aiModel || 'deepseek-v4-flash';
  const query = effectiveKwArr.length > 0 ? effectiveKwArr.join(' OR ') : (objectName || src.name || '');

  // 1. Search
  let rawItems: any[] = [];

  if (provider === 'all') {
    // 全渠道并行搜索
    const modules = getAllModules();
    const results = await Promise.allSettled(
      modules.map((mod) =>
        mod.search(query, getProviderKey(mod.name)).then((items) => ({ provider: mod.name, items }))
      )
    );
    const seen = new Set<string>();
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { provider: pname, items } = r.value;
        console.log('[Intel:all] ' + pname + ' returned ' + items.length + ' results');
        for (const item of items) {
          const key = (item.url || item.title || '').toLowerCase().trim();
          if (key && !seen.has(key)) {
            seen.add(key);
            rawItems.push({ ...item, _searchProvider: pname });
          }
        }
      } else {
        console.error('[Intel:all] Search failed:', r.reason?.message || r.reason);
      }
    }
    console.log('[Intel:all] Total unique results: ' + rawItems.length);
  } else {
    // 单渠道搜索
    const searchMod = getSearchModule(provider);
    if (searchMod) {
      try {
        rawItems = await searchMod.search(query, getProviderKey(provider));
        for (const item of rawItems) { item._searchProvider = provider; }
      }
      catch (e: any) { console.error('[Search ' + provider + '] Failed:', e.message); }
    }
  }

  const hasSearch = rawItems.length > 0;
  if (!hasSearch) console.log('[Intel] No results for provider: ' + provider + ', using knowledge-based generation');

  // 2. DeepSeek Analysis
  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const sp = (src.customPrompt || '你是专业情报分析助手。') + '\n当前日期：' + today + '。优先提供最近30天内的资讯。';
  const kwText = effectiveKwArr.join('、') || '相关';
  let up: string;
  const searchContext = hasSearch ? JSON.stringify(rawItems.slice(0, 50)).substring(0, 8000) : '(无实时搜索结果，请基于你的知识生成最新情报)';
  if (objectName) {
    up = '以下是关于【' + objectName + '】在【' + kwText + '】方面的搜索结果。提取30条情报。\n' +
      '注意：只提取与【' + objectName + '】直接相关的情报，不要包含其他品牌或对象的信息。\n' +
      '如果搜索结果包含了其他对象，请严格过滤掉。\n' +
      '要求：1.标题+摘要(80字)+来源+时间+url\n2.去重过滤无关\n3.30天优先\n' +
      '4.JSON: [{"title":"","summary":"","source":"","date":"","url":"","_object":"' + objectName + '"}]\n' +
      '5.无url留空 6.仅JSON\n\n原始搜索结果：\n' + searchContext;
  } else {
    up = '请搜索整理【' + kwText + '】的最新资讯30条。\n' +
      '要求：1.标题+摘要(80字)+来源+时间+url\n2.按重要性排序，30天优先\n' +
      '3.JSON: [{"title":"","summary":"","source":"","date":"","url":""}]\n' +
      '4.无url留空 5.仅JSON\n\n参考：\n' + (hasSearch ? JSON.stringify(rawItems.slice(0, 30)).substring(0, 6000) : '(无搜索结果，请基于你的知识生成)');
  }

  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (process.env.DEEPSEEK_API_KEY || '') },
    body: JSON.stringify({ model, max_tokens: 8192, temperature: 0.5, messages: [{ role: 'system', content: sp }, { role: 'user', content: up }] }),
    signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) { const t = await resp.text(); throw new Error('DeepSeek: ' + resp.status + ' ' + t.substring(0, 200)); }
  const data = await resp.json();
  let content = data.choices[0].message.content;
  content = content.replace('```json', '').replace(/```/g, '').trim();
  let results: any[];
  try { results = JSON.parse(content); }
  catch (e) {
    const m = content.match(/\[\s*(?:\{[\s\S]*?\}|\[[\s\S]*?\])+\s*\]/);
    results = m ? JSON.parse(m[0]) : (rawItems.length > 0 ? rawItems : []);
  }
  results = (results || []).map(function (r: any) {
    return { title: r.title || '', summary: r.summary || r.snippet || '', source: r.source || r.url || '', date: r.date || r.time || '', link: r.url || r.link || 'https://www.baidu.com/s?wd=' + encodeURIComponent(r.title || ''), _provider: r._searchProvider || provider };
  });
  const cutoff = Date.now() - 30 * 86400000;
  results = results.filter(function (r: any) { return !r.date || isNaN(new Date(r.date).getTime()) || new Date(r.date).getTime() > cutoff; });
  return results.slice(0, 30);
}
