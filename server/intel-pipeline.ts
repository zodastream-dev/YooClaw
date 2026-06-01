// Intel pipeline: search + DeepSeek analysis
import { getSearchModule, getAllModules } from './search-sources/index.js';
import crypto from 'crypto';

// -- V3: AI-generated search keywords cache --
const kwCache = new Map<string, { keywords: string[]; expiry: number }>();
const KW_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours for successful generations
const KW_FAIL_CACHE_TTL = 2 * 60 * 1000; // 2 min for failures (prevents repeated timeouts from parallel objects)
const KW_GEN_TIMEOUT = 25000; // 25s (was 15s — DeepSeek often takes 10-20s)

// In-flight dedup: prevent parallel calls for the same fingerprint from all hitting the API
const kwInFlight = new Map<string, Promise<string[]>>();

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

  // Check memory cache (successful or failed)
  const cached = kwCache.get(fp);
  if (cached && cached.expiry > Date.now()) {
    if (cached.keywords.length > 0) {
      console.log('[Intel:V3] Cache hit — ' + src.name + ' (' + cached.keywords.length + ' keywords)');
    }
    return cached.keywords;
  }

  // Dedup concurrent calls for same fingerprint
  const inFlight = kwInFlight.get(fp);
  if (inFlight) {
    console.log('[Intel:V3] Dedup in-flight call for ' + src.name);
    return inFlight;
  }

  const promise = doGenerateKeywords(src, objectName, fp);
  kwInFlight.set(fp, promise);

  try {
    return await promise;
  } finally {
    kwInFlight.delete(fp);
  }
}

async function doGenerateKeywords(src: any, objectName: string | undefined, fp: string): Promise<string[]> {
  const category = src.name || '情报';
  const prompt = (src.customPrompt || '').substring(0, 400);
  const userKw = (Array.isArray(src.keywords) ? src.keywords : []).join('、');
  const objCtx = objectName ? '监控对象：' + objectName : '';
  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  const sp = '你是搜索关键词优化专家。今天是' + today + '。根据情报监控配置，生成8-12个高价值中文搜索关键词用于多渠道搜索引擎查询。要求：1.优先具体产品名/技术术语/事件名称（如"韬芯片""鸿蒙NEXT""Mate80"）2.必须包含时效性关键词（如"最新""本月""2026年"）3.覆盖6个维度：产品发布、技术突破、财报业绩、人事变动、竞争动态、政策监管 4.关键词不限长度，精准优于简短 5.仅输出JSON数组，如：["关键词1","关键词2"]';

  const up = '情报属性：' + category + '\n' +
    (objCtx ? objCtx + '\n' : '') +
    '当前日期：' + today + '\n' +
    '用户关键词：' + (userKw || '（无）') + '\n' +
    '配置描述：' + (prompt || '（无）') + '\n\n' +
    '请优先生成包含具体产品名、技术名词、事件名称的时效性关键词。仅输出JSON数组，不要任何解释。';

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
      signal: AbortSignal.timeout(KW_GEN_TIMEOUT),
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

  // Cache failure with short TTL to prevent repeated timeouts from parallel object calls
  kwCache.set(fp, { keywords: [], expiry: Date.now() + KW_FAIL_CACHE_TTL });
  return [];
}

// API key mapping per provider
function getProviderKey(provider: string): string {
  if (provider === 'metaso') return process.env.METASO_API_KEY || '';
  if (provider === 'tavily') return process.env.TAVILY_API_KEY || '';
  // weibo/zhihu/xiaohongshu modules use Metaso API (domestic Chinese content)
  if (provider === 'weibo' || provider === 'zhihu' || provider === 'xiaohongshu') return process.env.METASO_API_KEY || '';
  return '';
}

export async function callIntel(effectiveKwArr: string[], src: any, objectName?: string): Promise<any[]> {
  const provider = src.aiProvider || 'all';
  // Validate model name — only allow DeepSeek models, fallback to deepseek-v4-flash
  const VALID_MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'];
  let model = src.aiModel || 'deepseek-v4-flash';
  if (!VALID_MODELS.includes(model)) {
    console.warn('[Intel] Invalid aiModel "' + model + '", falling back to deepseek-v4-flash');
    model = 'deepseek-v4-flash';
  }

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

  // Build search queries: batch keywords (max 3 per query) to avoid
  // "query too long" errors (Tavily 400 char limit) and improve recall precision.
  const queries: string[] = [];
  const thisMonth = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });

  if (mergedKwArr.length > 0) {
    const BATCH_SIZE = 3;
    for (let i = 0; i < mergedKwArr.length; i += BATCH_SIZE) {
      const batch = mergedKwArr.slice(i, i + BATCH_SIZE);
      const q = batch.map(k => objectName ? `${objectName} ${k}` : k).join(' OR ');
      queries.push(q);
    }
  } else if (objectName) {
    const catName = (src.name || '').toLowerCase();
    let fallbackModifiers: string;
    if (catName.includes('舆情') || catName.includes('自身')) {
      fallbackModifiers = '最新动态 OR 新闻 OR 公告';
    } else if (catName.includes('行业') || catName.includes('信号')) {
      fallbackModifiers = '最新趋势 OR 行业分析 OR 市场动态';
    } else if (catName.includes('竞争') || catName.includes('对手')) {
      fallbackModifiers = '新品 OR 战略 OR 财报 OR 最新动态';
    } else {
      fallbackModifiers = '最新动态';
    }
    queries.push(`${objectName} ${fallbackModifiers}`);
    console.log(`[Intel] No keywords available for "${src.name}", using fallback query`);
  } else {
    queries.push(src.name || '');
  }

  // Append recency query as a separate search for latest coverage
  if (objectName) {
    queries.push(`${objectName} 最新动态 ${thisMonth}`);
  }

  // 1. Search — run ALL queries in parallel across all engines
  let rawItems: any[] = [];

  // Run all queries across all engines in parallel
  const seen = new Set<string>();

  if (provider === 'all') {
    const modules = getAllModules();
    const allTasks: Promise<{ provider: string; items: any[]; queryIdx: number }>[] = [];
    queries.forEach((q, qi) => {
      modules.forEach((mod) => {
        allTasks.push(
          mod.search(q, getProviderKey(mod.name)).then((items) => ({ provider: mod.name, items, queryIdx: qi }))
        );
      });
    });
    const results = await Promise.allSettled(allTasks);
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { provider: pname, items } = r.value;
        for (const item of items) {
          const key = (item.url || item.title || '').toLowerCase().trim();
          if (key && !seen.has(key)) {
            seen.add(key);
            rawItems.push({ ...item, _searchProvider: pname });
          }
        }
      } else {
        // Silently skip failures (logged below)
      }
    }
    console.log('[Intel:all] Total unique results across ' + queries.length + ' queries: ' + rawItems.length);
  } else {
    // Single provider: run all queries sequentially to avoid rate limits
    const searchMod = getSearchModule(provider);
    if (searchMod) {
      for (const q of queries) {
        try {
          const items = await searchMod.search(q, getProviderKey(provider));
          for (const item of items) {
            const key = (item.url || item.title || '').toLowerCase().trim();
            if (key && !seen.has(key)) {
              seen.add(key);
              rawItems.push({ ...item, _searchProvider: provider });
            }
          }
        } catch (e: any) {
          console.error('[Intel:' + provider + '] Search failed:', e.message);
        }
      }
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
  // Multi-object sources: use larger context window (100 items / 15k chars) to avoid crowding out objects
  const contextItems = objectName ? 100 : 50;
  const contextChars = objectName ? 15000 : 8000;
  const searchContext = hasSearch ? JSON.stringify(rawItems.slice(0, contextItems)).substring(0, contextChars) : '(无实时搜索结果。请基于你的知识生成情报摘要，但所有url字段必须留空字符串""，严禁编造任何网址)';
  if (objectName) {
    up = '以下是关于【' + objectName + '】在【' + kwText + '】方面的搜索结果。提取30条情报。\n' +
      '注意：优先提取与【' + objectName + '】直接相关的情报。\n' +
      '如果搜索结果中有同行业/同领域的泛相关信息，可适量保留（不超过20%），但将其 _object 字段留空以区分。\n' +
      '要求：1.标题+摘要(80字)+来源+时间+url\n2.去重过滤无关\n3.30天优先\n' +
      '4.JSON: [{"title":"","summary":"","source":"","date":"","url":"","_object":"' + objectName + '","_provider":""}]\n' +
      '5. 每条记录的 _provider 必须从搜索结果的 _searchProvider 字段原样复制，用于渠道溯源\n6.无url留空 7.仅JSON\n\n原始搜索结果：\n' + searchContext;
  } else {
    up = '请搜索整理【' + kwText + '】的最新资讯30条。\n' +
      '要求：1.标题+摘要(80字)+来源+时间+url\n2.按重要性排序，30天优先\n' +
      '3.JSON: [{"title":"","summary":"","source":"","date":"","url":"","_provider":""}]\n' +
      '4. 每条记录的 _provider 必须从搜索结果的 _searchProvider 字段原样复制，用于渠道溯源\n5.无url留空 6.仅JSON\n\n参考：\n' + (hasSearch ? JSON.stringify(rawItems.slice(0, 30)).substring(0, 6000) : '(无搜索结果。请基于你的知识生成情报摘要，但所有url字段必须留空字符串""，严禁编造任何网址)');
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
  // DeepSeek 可能返回空数组 []，此时降级重试或使用 rawItems
  if ((!results || results.length === 0) && rawItems.length > 0) {
    // Retry once with a simpler prompt (lower temperature, asking for raw extraction)
    console.log('[Intel] DeepSeek returned empty, retrying with simpler prompt...');
    try {
      const retryUp = '从以下搜索结果中直接提取资讯，每条提取标题、摘要、来源、日期、URL。输出JSON数组：\n原始搜索结果：\n' + JSON.stringify(rawItems.slice(0, 30)).substring(0, 10000);
      const retryResp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (process.env.DEEPSEEK_API_KEY || '') },
        body: JSON.stringify({ model, max_tokens: 4096, temperature: 0.1, messages: [{ role: 'system', content: '你是一个数据提取助手。从搜索结果中提取资讯。仅输出JSON数组。' }, { role: 'user', content: retryUp }] }),
        signal: AbortSignal.timeout(60000),
      });
      if (retryResp.ok) {
        const retryData = await retryResp.json();
        let retryContent = retryData.choices[0].message.content;
        retryContent = retryContent.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        try {
          const retryResults = JSON.parse(retryContent);
          if (Array.isArray(retryResults) && retryResults.length > 0) {
            console.log('[Intel] Retry succeeded with ' + retryResults.length + ' items');
            results = retryResults;
          }
        } catch (e) {
          // Retry parse also failed, fall through to rawItems
        }
      }
    } catch (e: any) {
      console.warn('[Intel] Retry failed:', e.message);
    }
    // If still empty, fall back to rawItems with basic enrichment
    if (!results || results.length === 0) {
      console.log('[Intel] Falling back to ' + rawItems.length + ' rawItems');
      results = rawItems.slice(0, 30).map((item: any) => ({
        title: item.title || '',
        summary: (item.snippet || item.content || '').substring(0, 80),
        source: (item._searchProvider || (item.url ? new URL(item.url).hostname : '')) || '',
        date: item.date || '',
        url: item.url || '',
        _provider: item._searchProvider || '',
      }));
    }
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
      _provider: r._provider || r._searchProvider || provider,
    };
  });

  // --- Date recovery: AI often drops dates during analysis ---
  // Match results back to raw search items to recover lost dates and URLs
  if (rawItems.length > 0) {
    const rawByUrl = new Map<string, any>();
    const rawByTitle = new Map<string, any>();
    for (const raw of rawItems) {
      if (raw.url) rawByUrl.set(raw.url.toLowerCase().trim(), raw);
      if (raw.title) rawByTitle.set(raw.title.toLowerCase().trim(), raw);
    }

    let recoveredDates = 0;
    for (const r of results) {
      // Try exact URL match first (most reliable)
      if (!r.date && r.link) {
        const raw = rawByUrl.get(r.link.toLowerCase().trim());
        if (raw?.date) { r.date = raw.date; recoveredDates++; continue; }
      }
      // Try exact title match
      if (!r.date && r.title) {
        const raw = rawByTitle.get(r.title.toLowerCase().trim());
        if (raw?.date) { r.date = raw.date; recoveredDates++; continue; }
      }
      // Try substring title match (fuzzy)
      if (!r.date && r.title) {
        const rt = r.title.toLowerCase().trim();
        for (const [rawTitle, raw] of rawByTitle) {
          if (raw.date && (rawTitle.includes(rt) || rt.includes(rawTitle))) {
            r.date = raw.date; recoveredDates++; break;
          }
        }
      }
      // Recover URL if AI hallucinated a URL but we have a title match
      if (!r.link && r.title) {
        const raw = rawByTitle.get(r.title.toLowerCase().trim());
        if (raw?.url) { r.link = raw.url; }
      }
    }
    if (recoveredDates > 0) {
      console.log('[Intel] Recovered ' + recoveredDates + ' dates from raw search results');
    }
  }

  if (hallucinatedUrls.length > 0) {
    console.warn('[Intel] Filtered ' + hallucinatedUrls.length + ' hallucinated URLs: ' + hallucinatedUrls.slice(0, 5).join(', '));
  }
  // 30-day freshness filter with empty-date capping
  const cutoff = Date.now() - 30 * 86400000;
  let filteredCount = 0;
  results = results.filter(function (r: any) {
    if (!r.date || !r.date.trim()) return true; // keep for now, capping below
    const cnMatch = r.date.match(/(\\d{4})年(\\d{1,2})月(\\d{1,2})日/);
    if (cnMatch) {
      const ts = new Date(parseInt(cnMatch[1]), parseInt(cnMatch[2]) - 1, parseInt(cnMatch[3])).getTime();
      if (ts <= cutoff) { filteredCount++; return false; }
      return true;
    }
    const ts = new Date(r.date).getTime();
    if (!isNaN(ts)) {
      if (ts <= cutoff) { filteredCount++; return false; }
      return true;
    }
    return true;
  });
  if (filteredCount > 0) console.log('[Intel] Filtered ' + filteredCount + ' items older than 30 days');
  // Cap empty-date items at 5 to prevent stale data dominating results
  const emptyItems = results.filter((r: any) => !r.date || !r.date.trim());
  const datedItems = results.filter((r: any) => r.date && r.date.trim());
  if (emptyItems.length > 5) {
    console.log('[Intel] Capping empty-date items from ' + emptyItems.length + ' to 5 (keeping ' + datedItems.length + ' dated)');
    results = datedItems.concat(emptyItems.slice(0, 5));
  }
  return results.slice(0, 30);
}
