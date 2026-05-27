// Intel pipeline: search + DeepSeek analysis
import { getSearchModule, getAllModules } from './search-sources/index.js';
import crypto from 'crypto';

// -- V3: AI-generated search keywords cache --
const kwCache = new Map<string, { keywords: string[]; expiry: number }>();
const KW_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function srcFingerprint(src: any, objectName?: string): string {
  return crypto.createHash('md5').update(JSON.stringify({
    name: src.name,
    customPrompt: src.customPrompt,
    keywords: src.keywords,
    objects: src.objects,
    objectName: objectName || '',
  })).digest('hex');
}

async function generateSearchKeywords(src: any, objectName?: string): Promise<string[]> {
  const fp = srcFingerprint(src, objectName);
  const cached = kwCache.get(fp);
  if (cached && cached.expiry > Date.now()) {
    console.log('[Intel:V3] Cache hit — ' + src.name + ' (' + cached.keywords.length + ' keywords)');
    return cached.keywords;
  }

  const category = src.name || '情报';
  const prompt = (src.customPrompt || '').substring(0, 400);
  const userKw = (Array.isArray(src.keywords) ? src.keywords : []).join('、');
  const objCtx = objectName ? '监控对象：' + objectName : '';

  const sp = '你是搜索关键词优化专家。根据情报监控配置，生成5-8个精准的中文搜索关键词用于搜索引擎查询。要求：1.每个关键词2-6个汉字 2.覆盖不同切入角度 3.优先具体实体词和行业术语 4.仅输出JSON数组，如：["关键词1","关键词2"]';

  const up = '情报属性：' + category + '\n' +
    (objCtx ? objCtx + '\n' : '') +
    '用户关键词：' + (userKw || '（无）') + '\n' +
    '配置描述：' + (prompt || '（无）') + '\n\n' +
    '仅输出JSON数组，不要任何解释。';

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (process.env.DEEPSEEK_API_KEY || ''),
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 200,
        temperature: 0.3,
        messages: [
          { role: 'system', content: sp },
          { role: 'user', content: up },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    let content: string = data.choices[0].message.content.trim();
    content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    let keywords: string[];
    try { keywords = JSON.parse(content); }
    catch {
      // Try extracting JSON array from text
      const m = content.match(/\[.*\]/s);
      if (m) keywords = JSON.parse(m[0]);
      else throw new Error('No JSON array found in response: ' + content.substring(0, 200));
    }

    if (Array.isArray(keywords) && keywords.length > 0) {
      kwCache.set(fp, { keywords, expiry: Date.now() + KW_CACHE_TTL });
      console.log('[Intel:V3] Generated ' + keywords.length + ' keywords for ' + src.name + ': ' + keywords.join(', '));
      return keywords.map((k: string) => String(k).trim()).filter(Boolean);
    }
  } catch (e: any) {
    console.warn('[Intel:V3] Keyword gen failed for ' + src.name + ':', e.message);
  }

  return [];
}

// API key mapping per provider
function getProviderKey(provider: string): string {
  if (provider === 'metaso') return process.env.METASO_API_KEY || '';
  if (provider === 'tavily') return process.env.TAVILY_API_KEY || '';
  return '';
}

export async function callIntel(effectiveKwArr: string[], src: any, objectName?: string): Promise<any[]> {
  const provider = src.aiProvider || 'all';
  const model = src.aiModel || 'deepseek-v4-flash';

  // -- V3: Generate AI-optimized search keywords (cached per config fingerprint) --
  let aiKw: string[] = [];
  try {
    aiKw = await generateSearchKeywords(src, objectName);
  } catch (e: any) {
    console.warn('[Intel:V3] Keyword generation error, falling back to user keywords:', e.message);
  }

  // Merge: user keywords + AI keywords, dedup (case-insensitive)
  const mergedSet = new Set<string>();
  for (const k of effectiveKwArr) mergedSet.add(k.toLowerCase().trim());
  for (const k of aiKw) mergedSet.add(k.toLowerCase().trim());
  const mergedKwArr = [...mergedSet];

  const query = mergedKwArr.length > 0
    ? mergedKwArr.map(k => objectName ? `${objectName} ${k}` : k).join(' OR ')
    : (objectName || src.name || '');

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
  if (!hasSearch) {
    console.log('[Intel] No search results — returning empty (宁缺毋滥)');
    return [];
  }

  // 2. DeepSeek Analysis
  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const sp = (src.customPrompt || '你是专业情报分析助手。') + '\n当前日期：' + today + '。优先提供最近30天内的资讯。';
  const kwText = mergedKwArr.join('、') || '相关';
  let up: string;
  const searchContext = hasSearch ? JSON.stringify(rawItems.slice(0, 50)).substring(0, 8000) : '(无实时搜索结果。请基于你的知识生成情报摘要，但所有url字段必须留空字符串""，严禁编造任何网址)';
  if (objectName) {
    up = '以下是关于【' + objectName + '】在【' + kwText + '】方面的搜索结果。提取30条情报。\n' +
      '注意：优先提取与【' + objectName + '】直接相关的情报。\n' +
      '如果搜索结果中有同行业/同领域的泛相关信息，可适量保留（不超过20%），但将其 _object 字段留空以区分。\n' +
      '要求：1.标题+摘要(80字)+来源+时间+url\n2.去重过滤无关\n3.30天优先\n' +
      '4.JSON: [{"title":"","summary":"","source":"","date":"","url":"","_object":"' + objectName + '"}]\n' +
      '5.无url留空 6.仅JSON\n\n原始搜索结果：\n' + searchContext;
  } else {
    up = '请搜索整理【' + kwText + '】的最新资讯30条。\n' +
      '要求：1.标题+摘要(80字)+来源+时间+url\n2.按重要性排序，30天优先\n' +
      '3.JSON: [{"title":"","summary":"","source":"","date":"","url":""}]\n' +
      '4.无url留空 5.仅JSON\n\n参考：\n' + (hasSearch ? JSON.stringify(rawItems.slice(0, 30)).substring(0, 6000) : '(无搜索结果。请基于你的知识生成情报摘要，但所有url字段必须留空字符串""，严禁编造任何网址)');
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
  // 清除各种 markdown 代码块标记
  content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  let results: any[];
  // 先尝试整体解析
  try { results = JSON.parse(content); }
  catch (e1) {
    // 尝试提取 JSON 数组
    let m = content.match(/\[\s*(?:\{[\s\S]*?\})\s*(?:,\s*\{[\s\S]*?\})*\s*\]/);
    if (!m) m = content.match(/\[[\s\S]*\]/);
    if (m) {
      try { results = JSON.parse(m[0]); }
      catch (e2) {
        console.warn('[Intel] Regex match parse failed, using rawItems fallback. Content preview:', content.substring(0, 300));
        results = rawItems.length > 0 ? rawItems : [];
      }
    } else { results = rawItems.length > 0 ? rawItems : []; }
  }
  // DeepSeek 可能返回空数组 []，此时降级到 rawItems
  if ((!results || results.length === 0) && rawItems.length > 0) {
    console.log('[Intel] DeepSeek returned empty, falling back to ' + rawItems.length + ' rawItems');
    results = rawItems;
  }

  // 构建原始 URL 白名单（从搜索结果中提取），用于过滤 AI 幻觉 URL
  const rawUrlSet = new Set<string>();
  for (const item of rawItems) {
    if (item.url) rawUrlSet.add(item.url.toLowerCase().trim());
  }
  const hallucinatedUrls: string[] = [];

  results = (results || []).map(function (r: any) {
    const rawUrl = r.url || r.link || '';
    let finalUrl = rawUrl;

    // 验证 URL 是否出现在搜索结果白名单中（避免 AI 幻觉 URL）
    if (finalUrl && !rawUrlSet.has(finalUrl.toLowerCase().trim())) {
      // 宽松校验：检查是否为有效的 http(s) URL
      const looksReal = /^https?:\/\/[^\s]+$/.test(finalUrl);
      if (looksReal && rawUrlSet.size === 0) {
        // 无搜索结果时，AI 可能编造 URL；只有在有搜索结果时才信任白名单外的 URL
        hallucinatedUrls.push(finalUrl);
        finalUrl = '';
      }
    }

    return {
      title: r.title || '',
      summary: r.summary || r.snippet || '',
      source: r.source || r.url || '',
      date: r.date || r.time || '',
      link: finalUrl,
      _provider: r._searchProvider || provider,
    };
  });

  if (hallucinatedUrls.length > 0) {
    console.warn('[Intel] Filtered ' + hallucinatedUrls.length + ' hallucinated URLs: ' + hallucinatedUrls.slice(0, 5).join(', '));
  }
  const cutoff = Date.now() - 30 * 86400000;
  results = results.filter(function (r: any) { return !r.date || isNaN(new Date(r.date).getTime()) || new Date(r.date).getTime() > cutoff; });
  return results.slice(0, 30);
}
