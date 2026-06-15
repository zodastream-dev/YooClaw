// Intel pipeline: search + DeepSeek analysis
import { getSearchModule, getAllModules, getAllModulesIntl, getAllModulesTianapi } from './search-sources/index.js';
import type { SearchModule } from './search-sources/types.js';
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

// Build a global context snapshot from all portal sources — used to infer industry
// when individual source keywords are empty (zero-cost disambiguation, Gemini's proposal)
function buildGlobalContext(allSources: any[], currentObjName?: string): string {
  if (!allSources || allSources.length === 0) return '';

  const lines: string[] = [];

  // Collect industry signals (non-competitor, non-sentiment sources)
  const industrySrcs = allSources.filter((s: any) => {
    const n = (s.name || '').toLowerCase();
    return (n.includes('行业') || n.includes('信号')) && !n.includes('竞') && !n.includes('对手') && !n.includes('舆情');
  });
  if (industrySrcs.length > 0) {
    const industryObjects = industrySrcs.flatMap((s: any) =>
      (s.objects || []).map((o: any) => o.name).filter(Boolean)
    );
    if (industryObjects.length > 0) {
      lines.push('该门户的行业信号源监控对象：' + industryObjects.join('、'));
    }
  }

  // Collect all competitor/object names across ALL sources (for industry hint)
  const allObjects = allSources.flatMap((s: any) =>
    (s.objects || []).map((o: any) => o.name).filter(Boolean)
  );
  const otherObjects = allObjects.filter(n => n !== currentObjName);
  if (otherObjects.length > 0) {
    lines.push('同门户其他监控对象：' + otherObjects.join('、'));
  }

  // Collect source names as domain hints
  const sourceNames = allSources.map((s: any) => s.name).filter(Boolean);
  if (sourceNames.length > 0) {
    lines.push('该门户包含以下监控源：' + sourceNames.join('、'));
  }

  return lines.length > 0
    ? '——门户全局背景——\n' + lines.join('\n') + '\n请根据以上信息推断行业领域。如果当前监控对象名称是通用词汇，务必结合推断的行业生成限定性关键词。'
    : '';
}

async function generateSearchKeywords(src: any, objectName?: string, allSources?: any[]): Promise<string[]> {
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

  const promise = doGenerateKeywords(src, objectName, fp, allSources);
  kwInFlight.set(fp, promise);

  try {
    return await promise;
  } finally {
    kwInFlight.delete(fp);
  }
}

async function doGenerateKeywords(src: any, objectName: string | undefined, fp: string, allSources?: any[]): Promise<string[]> {
  const category = src.name || '情报';
  const prompt = (src.customPrompt || '').substring(0, 400);
  const userKw = (Array.isArray(src.keywords) ? src.keywords : []).join('、');
  const objCtx = objectName ? '监控对象：' + objectName : '';
  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  // Split: 行业信号 → macro trend keywords; target clients → corporate risk/opportunity keywords; competitors → product/event keywords; reputation → risk/incident keywords
  const isIndustrySignal = (category.includes('行业') || category.includes('信号')) && !category.includes('竞') && !category.includes('对手') && !category.includes('舆情');
  const isTargetClient = (category.includes('客户') || category.includes('目标')) && !category.includes('竞');
  const isReputation = category.includes('舆情') || category.includes('声誉') || category.includes('自身');
  const sp = isIndustrySignal
    ? '你是搜索关键词优化专家，专注于宏观行业趋势。今天是' + today + '。根据情报监控配置，生成6-10个宏观行业搜索关键词。要求：1.优先产业链变化、技术路线图、市场格局、政策法规、商业模式创新 2.禁止具体产品评测、单品价格、参数配置、产品促销 3.形式如"手机出货量2026Q2趋势""智能手机芯片供应链变化"等趋势性短语 4.关键词不限长度，精准优于简短 5.仅输出JSON数组，如：["关键词1","关键词2"]'
    : isTargetClient
      ? '你是企业客户情报分析专家，为银行对公业务监控核心客户动态。今天是' + today + '。根据监控对象，生成6-10个搜索关键词。要求：1.聚焦客户经营风险（财报/评级/债务/违约）、融资需求（发债/增发/招标）、银行关系（战略合作/授信变动）、战略调整（并购/重组/业务转型）2.禁止客户日常经营新闻、品牌营销活动、社会责任报告 3.形式如"中国中铁2026年Q2财报业绩""国家电网评级调整最新"等 4.关键词不限长度，精准优于简短 5.仅输出JSON数组'
    : isReputation
      ? '你是声誉风险与舆情监控专家。今天是' + today + '。根据监控对象，生成6-10个舆情监控搜索关键词。要求：1.聚焦监管处罚（罚单/整改/约谈）、合规风险（反洗钱/数据泄露/内控失效）、高管负面（被查/违纪/离职）、声誉事件（投诉/挤兑/违约/群体事件）、市场传闻（评级下调/并购重组/流动性危机）2.禁止常规营销软文、品牌合作新闻、ESG报告 3.形式如"招商银行千万罚单2026年6月""银行高管被查违纪最新"等 4.关键词不限长度，精准优于简短 5.仅输出JSON数组'
    : '你是搜索关键词优化专家。今天是' + today + '。根据情报监控配置，生成6-10个高价值中文搜索关键词用于多渠道搜索引擎查询。要求：1.优先具体产品名/技术术语/事件名称（如"韬芯片""鸿蒙NEXT""Mate80"）2.必须包含时效性关键词（如"最新""本月""2026年"）3.覆盖6个维度：产品发布、技术突破、财报业绩、人事变动、竞争动态、政策监管 4.关键词不限长度，精准优于简短 5.仅输出JSON数组，如：["关键词1","关键词2"]';

  // Build global context for zero-cost industry inference (Gemini's proposed optimization)
  const globalCtx = allSources && allSources.length > 0
    ? buildGlobalContext(allSources, objectName)
    : '';

  // Competitor sources: add industry context to avoid ambiguous generic names
  const isCompetitor = category.includes('竞') || category.includes('对手');
  const objectIndustryKw = src.objects && src.objects.length > 0
    ? src.objects.map((o: any) => o.keywords || []).flat().filter(Boolean)
    : [];
  const industryCtx = isCompetitor
    ? (objectIndustryKw.length > 0
        ? '注意：监控对象业务领域为「' + objectIndustryKw.join('、') + '」。生成关键词时必须结合该业务领域，避免通用名称歧义。'
        : (globalCtx ? '' : '注意：监控对象名称可能是通用词汇（如店铺名、品牌名），生成关键词时必须加入具体业务领域或行业限定（如"宠物品牌"、"宠物店"、"科技公司"），确保搜索结果精准相关。'))
    : '';

  const up = '情报属性：' + category + '\n' +
    (objCtx ? objCtx + '\n' : '') +
    (globalCtx ? globalCtx + '\n' : '') +
    (industryCtx ? industryCtx + '\n' : '') +
    '当前日期：' + today + '\n' +
    '用户关键词：' + (userKw || '（无）') + '\n' +
    '配置描述：' + (prompt || '（无）') + '\n\n' +
    (isIndustrySignal
      ? '请优先生成宏观趋势、产业链变化、市场格局类关键词。仅输出JSON数组，不要任何解释。'
      : isReputation
        ? '请优先生成监管处罚、合规风险、高管负面、声誉事件、市场传闻类关键词。仅输出JSON数组，不要任何解释。'
        : '请优先生成包含具体产品名、技术名词、事件名称的时效性关键词。仅输出JSON数组，不要任何解释。');

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
      const m = content.match(/\[.*?\]/s);
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
  if (provider === 'serper') return process.env.SERPER_API_KEY || '';
  // tianapi-* modules use TIANAPI_KEY (default to user's key)
  if (provider.startsWith('tianapi-')) return process.env.TIANAPI_KEY || '91e8fe55a49056f86b78b6d50bb25793';
  return '';
}

// Safely truncate a JSON array of objects without breaking JSON syntax
function safeJsonTruncate(items: any[], maxChars: number): string {
  let result = '[';
  for (let i = 0; i < items.length; i++) {
    const itemStr = JSON.stringify(items[i]);
    if (result.length + itemStr.length + 2 > maxChars) break; // +2 for ",]"
    if (i > 0) result += ',';
    result += itemStr;
  }
  result += ']';
  return result;
}

// ========== V2.5: Credibility engine (domain-based, zero-token) ==========

function getCredibility(url: string, whitelist: string[]): string {
  if (!url) return 'MEDIUM';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (whitelist.some(d => host.includes(d))) return 'HIGH';
    // Semi-authoritative sources
    if (/\.(sina\.com\.cn|eastmoney\.com|xueqiu\.com|163\.com|qq\.com)$/.test(host)) return 'MEDIUM';
    if (/\.(gov\.cn|edu\.cn)$/.test(host)) return 'HIGH';
  } catch {}
  return 'LOW';
}

export async function callIntel(effectiveKwArr: string[], src: any, objectName?: string, allSources?: any[]): Promise<any[]> {
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
    aiKw = await generateSearchKeywords(src, objectName, allSources);
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

  // Build enriched object context from object's keywords (industry/business type hints)
  const targetObj = objectName
    ? (src.objects || []).find((o: any) => o.name === objectName)
    : undefined;
  const objIndustryKw = targetObj && targetObj.keywords && targetObj.keywords.length > 0
    ? targetObj.keywords.join(' ')
    : '';

  if (mergedKwArr.length > 0) {
    const BATCH_SIZE = 3;
    for (let i = 0; i < mergedKwArr.length; i += BATCH_SIZE) {
      const batch = mergedKwArr.slice(i, i + BATCH_SIZE);
      const q = batch.map(k => {
        const trimmed = k.trim();
        if (!objectName) return trimmed;
        // Avoid duplicating objectName if keyword already contains it
        if (trimmed.toLowerCase().includes(objectName.toLowerCase())) {
          return trimmed;
        }
        // Prepend objectName + industry keywords for disambiguation
        const prefix = objIndustryKw ? `${objectName} ${objIndustryKw}` : objectName;
        return `${prefix} ${trimmed}`;
      }).join(' OR ');
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
    } else if (catName.includes('客户') || catName.includes('目标')) {
      fallbackModifiers = '财报 OR 评级 OR 债务 OR 战略 OR 融资';
    } else {
      fallbackModifiers = '最新动态';
    }
    const fallbackPrefix = objIndustryKw ? `${objectName} ${objIndustryKw}` : objectName;
    queries.push(`${fallbackPrefix} ${fallbackModifiers}`);
    console.log(`[Intel] No keywords available for "${src.name}", using fallback query`);
  } else {
    queries.push(src.name || '');
  }

  // --- V2.5: Domain whitelist for authority source filtering ---
  // V2.6: No longer constructs `site:` queries (non-functional for metaso/tianapi).
  // Instead, raw search results will be filtered by domain after collection.
  // Detect banking/finance sources based on actual monitoring content (not just source name)
  const bankingCheck = (Array.isArray(src.keywords) ? src.keywords.join(' ') : '') + ' '
    + (src.objects || []).map((o: any) => (o.name || '') + ' ' + ((o.keywords || []).join(' '))).join(' ');
  const bankingTerms = ['金监总局', '央行', '银团', '城投', '存贷款', '银行', '金融', '对公',
    'LPR', '利率', '信贷', '不良贷款', '拨备', '评级', '发债', '反洗钱', '监管处罚'];
  const isBanking = bankingTerms.some(t => bankingCheck.includes(t));
  const BANKING_WHITELIST = [
    'people.com.cn', 'xinhuanet.com', 'caixin.com', '21jingji.com',
    'yicai.com', 'cls.cn', 'finance.sina.com.cn', 'cbirc.gov.cn', 'pbc.gov.cn',
  ];
  const domainWhitelist: string[] = isBanking ? BANKING_WHITELIST : [];

  // V2.5.1: Cap total queries at 8 (banking mode drops zhihu/xhs, so we can afford more queries)
  if (queries.length > 8) queries.length = 8;

  // 1. Search — run ALL queries in parallel across all engines
  let rawItems: any[] = [];

  // Run all queries across all engines in parallel
  const seen = new Set<string>();

  if (provider === 'all' || provider === 'all+en' || provider === 'all+cn-news') {
    let modules: SearchModule[];
    let tavilyStatus: string;
    if (provider === 'all+en') {
      modules = getAllModulesIntl();
      tavilyStatus = 'included';
    } else if (provider === 'all+cn-news') {
      modules = getAllModules();
      const generalNews = getSearchModule('tianapi-generalnews');
      if (generalNews) modules.push(generalNews);
      // V2.5: Banking sources — only metaso + tianapi (highest signal for Chinese financial/regulatory intel)
      if (isBanking) {
        modules = modules.filter(m => m.name === 'metaso' || m.name === 'tianapi-generalnews');
        tavilyStatus = 'excluded, metaso+tianapi only (banking mode)';
      } else {
        tavilyStatus = 'excluded, metaso+weibo+zhihu+xhs+tianapi active';
      }
    } else {
      modules = getAllModules();
      tavilyStatus = 'excluded, tianapi excluded';
    }
    console.log('[Intel:' + provider + '] Using ' + modules.length + ' modules (Tavily: ' + tavilyStatus + ')');
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
    console.log('[Intel:' + provider + '] Total unique results across ' + queries.length + ' queries: ' + rawItems.length);
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

  // --- V2.7: Whitelist queries via Serper (paid account supports site:) ---
  // serperMod strips idents, not site:, so keep path separators and anchor chars.
  // Use Google's site: operator to restrict results to whitelist domains only.
  // This gives high-precision authoritative results that metaso/tianapi can't provide.
  let serperWlItems: any[] = [];
  if (domainWhitelist.length > 0) {
    const siteFilter = domainWhitelist.map(d => `site:${d}`).join(' OR ');
    const wlQueryPrefix = objectName
      ? (objIndustryKw ? `${objectName} ${objIndustryKw}` : objectName)
      : (mergedKwArr.length > 0 ? mergedKwArr.slice(0, 3).join(' OR ') : '银行业');
    const wlQuery = `${wlQueryPrefix} ${siteFilter}`;
    const serperMod = getSearchModule('serper');
    if (serperMod) {
      try {
        const serperKey = getProviderKey('serper');
        if (serperKey) {
          const items = await serperMod.search(wlQuery, serperKey);
          let added = 0;
          for (const item of items) {
            const key = (item.url || item.title || '').toLowerCase().trim();
            if (key && !seen.has(key)) {
              seen.add(key);
              serperWlItems.push({ ...item, _searchProvider: 'serper' });
              added++;
            }
          }
          console.log('[Intel:V2.7] Serper site: query: ' + added + '/' + items.length + ' results for ' + wlQuery.substring(0, 120));
        }
      } catch (e: any) {
        console.warn('[Intel:V2.7] Serper site: query failed:', e.message);
      }
    }
  }

  const hasSearch = rawItems.length > 0 || serperWlItems.length > 0;
  if (!hasSearch) {
    console.log('[Intel] No search results — returning empty (宁缺毋滥)');
    return [];
  }

  // --- V2.6: Domain whitelist filtering — separate whitelist results from general results ---
  // Instead of using `site:` syntax (which doesn't work with metaso/tianapi),
  // we filter by domain AFTER collecting raw search results.
  // Whitelist results get priority when building DeepSeek context.
  let wlRawItems: any[] = [];    // Results from whitelist domains
  let otherRawItems: any[] = []; // Results from non-whitelist domains
  
  if (domainWhitelist.length > 0) {
    for (const item of rawItems) {
      let isWhitelisted = false;
      if (item.url) {
        try {
          const host = new URL(item.url).hostname.replace(/^www\./, '');
          isWhitelisted = domainWhitelist.some(d => host.includes(d) || host === d);
        } catch {}
      }
      if (isWhitelisted) wlRawItems.push(item);
      else otherRawItems.push(item);
    }
    console.log('[Intel:V2.6] Whitelist domains: ' + wlRawItems.length + ' items, Others: ' + otherRawItems.length + ' items');
    // V2.7: Add Serper whitelist results (from site: queries) to the whitelist pool
    if (serperWlItems.length > 0) {
      wlRawItems = [...serperWlItems, ...wlRawItems];
      console.log('[Intel:V2.7] Added ' + serperWlItems.length + ' Serper whitelist results → total whitelist: ' + wlRawItems.length);
    }
  } else {
    // No whitelist — all results are "other" (but we still pass them through)
    wlRawItems = [];
    otherRawItems = rawItems;
  }

  // Pre-verify whitelist items: discard those whose title+snippet don't mention the monitored object.
  // EXCEPTION: Serper site: results are already domain-verified by Google and are inherently relevant.
  // Applying the same strict title-matching to them would discard authoritative articles that
  // cover relevant topics without literally naming the object in the title (e.g., "银行数字化转型").
  const prefilteredWl = (objectName && wlRawItems.length > 0)
    ? wlRawItems.filter((item: any) => {
        // V2.7: Skip pre-filter for Serper site: results (already domain-verified)
        if (item._searchProvider === 'serper') return true;
        const escapeR = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = objectName.split(/[,，]\s*/).filter(Boolean).map(escapeR).join('|');
        if (!pattern) return true;
        const text = (item.title || '') + ' ' + (item.snippet || item.content || '');
        return new RegExp('(' + pattern + ')', 'i').test(text);
      })
    : wlRawItems;

  if (wlRawItems.length > 0 && prefilteredWl.length < wlRawItems.length) {
    console.log('[Intel:V2.6] Pre-filtered ' + (wlRawItems.length - prefilteredWl.length) + ' non-matching whitelist items');
  }

  // Build prioritized search context: whitelist items first, then supplement with others
  let searchContextItems: any[];
  const MIN_WL_COUNT = 15;
  if (prefilteredWl.length >= MIN_WL_COUNT) {
    searchContextItems = prefilteredWl;
    console.log('[Intel:V2.6] Using ' + prefilteredWl.length + ' whitelist-only results for DeepSeek');
  } else if (prefilteredWl.length > 0) {
    // Supplement with non-whitelist items
    const otherLimit = (MIN_WL_COUNT - prefilteredWl.length) * 3;
    searchContextItems = [...prefilteredWl, ...otherRawItems.slice(0, otherLimit)];
    console.log('[Intel:V2.6] Using ' + prefilteredWl.length + ' whitelist + ' + (searchContextItems.length - prefilteredWl.length) + ' other results for DeepSeek');
  } else {
    // No whitelist results at all — use non-whitelist results
    searchContextItems = otherRawItems;
    console.log('[Intel:V2.6] No whitelist results, using ' + otherRawItems.length + ' general results');
  }

  // 2. DeepSeek Analysis
  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const sp = (src.customPrompt || '你是专业情报分析助手。') + '\n当前日期：' + today + '。所有标题和摘要必须使用中文。每条摘要约100字。非中文来源的内容必须翻译成中文。';
  const kwText = mergedKwArr.join('、') || '相关';
  let up: string;
  // Multi-object sources: use larger context window (100 items / 15k chars) to avoid crowding out objects
  const contextItems = objectName ? 100 : 50;
  const contextChars = objectName ? 15000 : 8000;
  const searchContext = hasSearch ? safeJsonTruncate(searchContextItems.slice(0, contextItems), contextChars) : '(无实时搜索结果。请基于你的知识生成情报摘要，但所有url字段必须留空字符串""，严禁编造任何网址)';
  if (objectName) {
    // Detect source type for specialized instructions
    const catCheck = (src.name || '').toLowerCase();
    const isTarget = catCheck.includes('客户') || catCheck.includes('目标');
    const isComp = catCheck.includes('竞争') || catCheck.includes('对手');
    const isReputation = catCheck.includes('舆情') || catCheck.includes('声誉') || catCheck.includes('自身');

    up = '以下是关于【' + objectName + '】在【' + kwText + '】方面的搜索结果。提取最多30条情报。\n' +
      '注意：只提取与【' + objectName + '】直接相关的情报。如果某条搜索结果与【' + objectName + '】完全无关（如天气预警、商品价格、无关地区新闻、非本行业内容等），必须直接丢弃，不要输出。\n' +
      '如果搜索结果中有同行业/同领域的泛相关信息，可适量保留（不超过10%），但将其 _object 字段留空以区分。\n' +
      '注意：原始搜索结果按可信度排序——【权威来源】（来自权威媒体/监管官网，如人民网、新华网、财新、央行等）排在最前面，【其他来源】排在后面。优先从权威来源中提取情报，其可信度和价值更高。\n' +
      '要求：1.标题+摘要(约100字)+来源+时间+url+情感倾向+可靠性\n2.非中文标题和摘要必须翻译成中文\n3.摘要充实禁止留空\n4.去重过滤无关\n' +
      '5.JSON: [{"title":"","summary":"","source":"","date":"","url":"","_object":"' + objectName + '","_provider":"","_sentiment":"","_reliability":"","_intent":"","_valueScore":50,"_riskLevel":"NORMAL","_noiseType":"对公业务"}]\n' +
      '6. _sentiment: 正面/负面/中性; _reliability: 已确认/传闻/待核实; _intent: 竞对意图分析（可空）\n' +
      '6.1 _noiseType（必填，取"对公业务"/"零售噪音"/"营销通稿"）：判断本条情报是否属于对公/战略/风险管理内容。零售产品（信用卡/消费贷/App更新/社区活动/理财推销）必须标注为"零售噪音"或"营销通稿"\n' +
      '7. 每条记录的 _provider 必须从搜索结果的 _searchProvider 字段原样复制，用于渠道溯源\n' +
      '8. 重要：必须均衡使用各个来源渠道的结果，每个 _searchProvider 渠道的结果至少提供 2 条（如果该渠道有结果的话）\n' +
      '9. 优先提供不同渠道的独有信息，避免同一信息由多个渠道重复提供\n' +
      '10.无url留空\n' +
      '11. _valueScore 商业价值判分标准（0-100整数，必填，严禁留空或填0）：\n' +
      '  【90-100 战略级】影响投资决策或战略方向：官方财报/重大并购/核心高管变更/监管政策突变/行业龙头份额变化>5%/颠覆性技术突破\n' +
      '  【75-89 战术级】需业务部门响应：竞品新品发布/关键供应链变动/大客户中标或流失/技术标准更新/重要合作伙伴动态\n' +
      '  【60-74 关注级】值得了解的动态：行业趋势报告/市场数据更新/一般性产品迭代/专利申报/渠道政策调整\n' +
      '  【40-59 参考级】背景信息：常规营销/一般性媒体报道/非核心市场动态/行业科普\n' +
      '  【<40 噪声级】低价值信息：纯软文通稿/SEO内容/过时资讯/弱相关内容\n' +
      '  分布约束：90+条目不超过10%，70+条目不超过30%，大部分落在50-70区间\n' +
      '  评分只看商业价值不看情感倾向，重复信息降10-20分\n' +
      '  注意：与监控对象完全无关的内容（如天气、商品价格、无关地区新闻）即使出现在搜索结果中，也必须丢弃，不得输出。\n' +
      (isTarget
        ? '  目标客户专项：客户评级下调/债务违约/重大亏损 → 90+; 客户战略调整/融资需求 → 75-89; 客户日常经营新闻 → ≤50\n'
        : '') +
      (isComp
        ? '  竞争对手专项：竞对与核心客户签战略协议/银团牵头权变动 → 90+; 竞对新产品/机构调整 → 75-89; 竞对一般性营销 → ≤50\n'
        : '') +
      (isReputation
        ? '  自身舆情专项：千万级以上监管罚单/高管被查/数据泄露重大事件/挤兑传闻 → 90+; 负面舆情扩散/理财产品投诉增多/评级展望负面 → 75-89; 常规监管通告/一般性投诉 → ≤70\n' +
          '    注意：自身负面舆情优先提取并高分标注，不因情感负面而降分；正面或中性舆情正常评价\n'
        : '') +
      '12. 日期规范（极其重要，严格遵守）：\n' +
      '  - date 字段必须从搜索结果的 date/published_date 元数据中精确复制\n' +
      '  - 严禁根据文章正文内容推测或编造日期\n' +
      '  - 如果原始搜索结果没有明确标注完整日期（年月日），date 字段留空字符串 ""\n' +
      '  - 特别禁止：把只有月日（如"1月23日"）的日期自动补全为当前年份（2026年）——这些很可能是旧文章\n' +
      '  - 特别禁止：把原始日期从"2019年"篡改为"2026年"\n' +
      '  - 日期格式统一为"YYYY年MM月DD日"，例如"2025年12月05日"\n' +
      '13. _riskLevel 风险预警等级（必填，取 "CRITICAL"/"WARNING"/"NORMAL"）：\n' +
      '  四维判定框架：\n' +
      '  a) 高管动态：核心高管离职/空降/被调查/监管约谈 → CRITICAL; 高管重要场合战略表态 → WARNING\n' +
      '  b) 战略布局：新业务线/新部门成立/海外扩张/重大收购 → WARNING; 常规业务调整 → NORMAL\n' +
      '  c) 资金成本：信用评级上调/下调、发债利差变化>50bp、千万级以上监管罚单 → CRITICAL; 评级展望调整 → WARNING\n' +
      '  d) 项目动态：重大银团牵头权被对手夺走/核心客户主办行变更 → CRITICAL; 与地方政府/海外机构新签MOU → WARNING\n' +
      '  CRITICAL: 直接影响核心竞争力或资产安全，需24h内响应\n' +
      '  WARNING: 需要业务部门关注，本周内制定应对策略\n' +
      '  NORMAL: 常规情报，作为背景信息储备\n' +
      '14.仅JSON\n\n原始搜索结果：\n' + searchContext;
  } else {
    const catCheck2 = (src.name || '').toLowerCase();
    const isReputation2 = catCheck2.includes('舆情') || catCheck2.includes('声誉') || catCheck2.includes('自身');
    up = '请搜索整理【' + kwText + '】的最新资讯30条。\n' +
      '要求：1.标题+摘要(约100字)+来源+时间+url\n2.非中文标题和摘要必须翻译成中文\n3.按重要性排序，摘要禁止留空\n' +
      '4.JSON: [{"title":"","summary":"","source":"","date":"","url":"","_provider":"","_sentiment":"","_reliability":"","_valueScore":50,"_riskLevel":"NORMAL"}]\n' +
      '5. _sentiment: 正面/负面/中性; _reliability: 已确认/传闻/待核实\n' +
      '6. 每条记录的 _provider 必须从搜索结果的 _searchProvider 字段原样复制，用于渠道溯源\n' +
      '7. 重要：必须均衡使用各个来源渠道的结果，每个 _searchProvider 渠道至少提供 2 条（如果该渠道有结果的话）\n' +
      '8. 优先提供不同渠道的独有信息，避免同一信息由多个渠道重复提供\n' +
      '9. 无url留空\n' +
      (isReputation2
        ? '10. _valueScore 商业价值判分标准（0-100整数）：\n' +
          '  自身舆情专项：千万级以上监管罚单/高管被查/数据泄露重大事件/挤兑传闻 → 90+; 负面舆情扩散/理财产品投诉增多/评级展望负面 → 75-89; 常规监管通告/一般性投诉 → ≤70\n' +
          '  注意：自身负面舆情优先提取并高分标注，不因情感负面而降分\n'
        : '10. _valueScore 商业价值判分标准（0-100整数，必填，严禁留空或填0）：\n' +
          '  【90-100 战略级】影响投资决策或战略方向：官方财报/重大并购/核心高管变更/监管政策突变/行业龙头份额变化>5%/颠覆性技术突破\n' +
          '  【75-89 战术级】需业务部门响应：竞品新品发布/关键供应链变动/大客户中标或流失/技术标准更新/重要合作伙伴动态\n' +
          '  【60-74 关注级】值得了解的动态：行业趋势报告/市场数据更新/一般性产品迭代/专利申报/渠道政策调整\n' +
          '  【40-59 参考级】背景信息：常规营销/一般性媒体报道/非核心市场动态/行业科普\n' +
          '  【<40 噪声级】低价值信息：纯软文通稿/SEO内容/过时资讯/弱相关内容\n' +
          '  分布约束：90+条目不超过10%，70+条目不超过30%，大部分落在50-70区间\n' +
          '  评分只看商业价值不看情感倾向，重复信息降10-20分\n') +
      '11. 日期规范（极其重要，严格遵守）：\n' +
      '  - date 字段必须从搜索结果的 date/published_date 元数据中精确复制\n' +
      '  - 严禁根据文章正文内容推测或编造日期，日期未知就留空\n' +
      '  - 特别禁止：把只有月日的日期自动补全为当前年份\n' +
      (isReputation2
        ? '12. _riskLevel 风险预警等级（必填）：\n' +
          '  声誉风险六维框架：\n' +
          '  a) 监管处罚：千万级以上罚单/机构准入限制/高管任职资格撤销 → CRITICAL\n' +
          '  b) 合规风险：反洗钱违规/数据安全事件/内控失效/资金挪用 → CRITICAL\n' +
          '  c) 高管与治理：高管被调查/股东变动/内部举报 → CRITICAL; 高管离职/组织调整 → WARNING\n' +
          '  d) 声誉事件：大规模投诉/理财产品兑付危机/网点突发事件/群体事件 → CRITICAL\n' +
          '  e) 市场传闻：评级下调/流动性危机/被并购重组 → WARNING\n' +
          '  f) 资产质量：重大不良暴露(>5亿)/拨备骤降/关注类贷款异常 → CRITICAL\n' +
          '13.仅JSON\n\n原始搜索结果：\n' + searchContext
        : '12. _riskLevel 风险预警等级（必填，取 "CRITICAL"/"WARNING"/"NORMAL"）：\n' +
          '13.仅JSON\n\n原始搜索结果：\n' + searchContext);
  }

  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (process.env.DEEPSEEK_API_KEY || '') },
    body: JSON.stringify({ model, max_tokens: 8192, temperature: 0.5, messages: [{ role: 'system', content: sp }, { role: 'user', content: up }] }),
    signal: AbortSignal.timeout(180000),
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
    let m = content.match(/\[\s*(?:\{[\s\S]*?\}\s*(?:,\s*\{[\s\S]*?\})*)?\s*\]/);
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
      if (looksReal && rawUrlSet.size > 0) {
        // 有搜索结果时，不在白名单内的 URL 可能是 AI 幻觉，标记为不安全
        hallucinatedUrls.push(finalUrl);
        finalUrl = '';
      }
    }

    return {
      title: r.title || '',
      summary: r.summary || r.snippet || '',
      source: r.source || '',
      date: r.date || r.time || '',
      link: finalUrl,
      _provider: r._provider || r._searchProvider || provider,
      _sentiment: r._sentiment || '',
      _reliability: r._reliability || '',
      _intent: r._intent || '',
      _object: r._object || '',
      _valueScore: parseInt(r._valueScore) || 50,
      _riskLevel: r._riskLevel || 'NORMAL',
      _credibility: getCredibility(finalUrl, domainWhitelist),
      _noiseType: r._noiseType || '对公业务',
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
    let recoveredProviders = 0;
    for (const r of results) {
      // V2.5: Recover missing _provider from raw search items
      if (!r._provider || r._provider === 'all+cn-news' || r._provider === 'all') {
        if (r.link) {
          const raw = rawByUrl.get(r.link.toLowerCase().trim());
          if (raw?._searchProvider) { r._provider = raw._searchProvider; recoveredProviders++; }
        }
        if ((!r._provider || r._provider === 'all+cn-news' || r._provider === 'all') && r.title) {
          const raw = rawByTitle.get(r.title.toLowerCase().trim());
          if (raw?._searchProvider) { r._provider = raw._searchProvider; recoveredProviders++; }
        }
      }
      // V2.5: Recover empty/missing source field from URL hostname
      if (!r.source || r.source === '' || (typeof r.source === 'string' && r.source.startsWith('http'))) {
        if (r.link || r.url) {
          try {
            const host = new URL((r.link || r.url || '')).hostname;
            const nameMap: Record<string,string> = {
              'people.com.cn': '人民网', 'finance.people.com.cn': '人民网财经',
              'xinhuanet.com': '新华网', 'caixin.com': '财新',
              '21jingji.com': '21世纪经济报道', 'yicai.com': '第一财经',
              'cls.cn': '财联社', 'finance.sina.com.cn': '新浪财经',
              'cbirc.gov.cn': '金监总局', 'pbc.gov.cn': '央行',
              'gov.cn': '中国政府网', 'ce.cn': '中国经济网',
              'stcn.com': '证券时报', 'cnstock.com': '上海证券报',
              'cs.com.cn': '中国证券报', 'china.com.cn': '中国网',
              // Bank domains
              'icbc.com.cn': '工商银行', 'v.icbc.com.cn': '工商银行',
              'ccb.com': '建设银行', 'abchina.com': '农业银行',
              'boc.cn': '中国银行', 'bankofchina.com': '中国银行',
              'cmbchina.com': '招商银行', 'spdb.com.cn': '浦发银行',
              'bankcomm.com': '交通银行', 'citicbank.com': '中信银行',
              'cebbank.com': '光大银行', 'hxb.com.cn': '华夏银行',
              // Enterprise domains
              'crec.cn': '中国中铁', 'crcc.cn': '中国铁建',
              'cccc.cn': '中国交建', 'cscec.com': '中国建筑',
              'sgcc.com.cn': '国家电网', 'csgc.com.cn': '中国船舶',
              // Regulator domains
              'jrj.sh.gov.cn': '上海金融监管局',
              'shanghai.gov.cn': '上海市政府',
              'beijing.gov.cn': '北京市政府',
            };
            const clean = host.replace(/^www\./, '');
            r.source = nameMap[clean] || nameMap[host] || clean;
          } catch {}
        }
      }
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
    if (recoveredProviders > 0) {
      console.log('[Intel:V2.5] Recovered ' + recoveredProviders + ' _provider fields');
    }
  }

  if (hallucinatedUrls.length > 0) {
    console.warn('[Intel] Filtered ' + hallucinatedUrls.length + ' hallucinated URLs: ' + hallucinatedUrls.slice(0, 5).join(', '));
  }
  // Fallback: fill empty summaries from raw search results or title
  let filledSummaries = 0;
  results.forEach((r: any) => {
    if (r.summary && r.summary.trim()) return;
    // Try matching raw search result by title
    const rawMatch = rawItems.find((raw: any) =>
      (raw.title || '').toLowerCase().trim() === (r.title || '').toLowerCase().trim()
    );
    if (rawMatch && (rawMatch.snippet || rawMatch.content)) {
      r.summary = (rawMatch.snippet || rawMatch.content || '').substring(0, 120);
      filledSummaries++;
    } else {
      // Fallback: generate from title
      r.summary = (r.title || '').length > 20 ? (r.title || '') : ('关于' + (r.title || '') + '的报道');
      filledSummaries++;
    }
  });
  if (filledSummaries > 0) console.log('[Intel] Filled ' + filledSummaries + ' empty summaries');
  // 1-year freshness filter with empty-date capping
  const cutoff = Date.now() - 365 * 86400000;
  let filteredCount = 0;
  results = results.filter(function (r: any) {
    if (!r.date || !r.date.trim()) return true; // keep for now, capping below
    const cnMatch = r.date.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
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
  if (filteredCount > 0) console.log('[Intel] Filtered ' + filteredCount + ' items older than 365 days');
  // V2.7: Date sanity check — reject future dates (AI hallucination)
  let futureRejected = 0;
  const nowTs = Date.now();
  const oneDay = 86400000;
  results = results.filter((r: any) => {
    if (!r.date || !r.date.trim()) return true;
    const cnMatch = r.date.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    let ts = 0;
    if (cnMatch) {
      ts = new Date(parseInt(cnMatch[1]), parseInt(cnMatch[2]) - 1, parseInt(cnMatch[3])).getTime();
    } else {
      ts = new Date(r.date).getTime();
    }
    if (isNaN(ts)) return true;
    // Reject dates more than 1 day in the future
    if (ts > nowTs + oneDay) {
      console.log('[Intel:V2.7] Rejected future date: "' + r.date + '" for title: ' + (r.title || '').substring(0, 60));
      futureRejected++;
      return false;
    }
    return true;
  });
  if (futureRejected > 0) console.log('[Intel:V2.7] Rejected ' + futureRejected + ' items with future dates (hallucination)');
  // Cap empty-date items at 5 to prevent stale data dominating results
  const reliabilityOrder: Record<string, number> = { '已确认': 3, '待核实': 2, '传闻': 1 };
  const emptyItems = results
    .filter((r: any) => !r.date || !r.date.trim())
    .sort((a: any, b: any) => (reliabilityOrder[b._reliability || ''] || 0) - (reliabilityOrder[a._reliability || ''] || 0));
  const datedItems = results.filter((r: any) => r.date && r.date.trim());
  if (emptyItems.length > 5) {
    console.log('[Intel] Capping empty-date items from ' + emptyItems.length + ' to 5 (keeping ' + datedItems.length + ' dated)');
    results = datedItems.concat(emptyItems.slice(0, 5));
  }
  // EHR: discard items that don't mention the monitored object in title or summary
  if (objectName) {
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const names = objectName.split(/[,，]\s*/).filter(Boolean);
    const strictPattern = names.map(escapeRegExp).join('|');
    if (!strictPattern) { console.warn('[Intel] EHR skipped — empty pattern for objectName: "' + objectName + '"'); return results.slice(0, 30); }
    const strictRegex = new RegExp('(' + strictPattern + ')', 'i');
    const before = results.length;
    const beforeResults = [...results]; // Save copy for safety net
    results = results.filter((r: any) => {
      const text = (r.title || '') + ' ' + (r.summary || '');
      return strictRegex.test(text);
    });
    if (results.length < before) console.log('[Intel] EHR filtered ' + (before - results.length) + ' items for "' + objectName + '"');

    // Safety net: if EHR was too aggressive (< 5 results), relax to partial token match.
    // For Chinese names, we try 2-character substrings as relaxed tokens.
    // But we NEVER fall back to keeping all original results — quality over quantity.
    if (results.length < 5 && beforeResults.length > 0) {
      const relaxedTokens = names.flatMap(n => {
        const tokens: string[] = [];
        if (n.length >= 4) {
          // Extract 2-char CJK substrings for relaxed matching
          for (let i = 0; i <= n.length - 2; i++) {
            const sub = n.substring(i, i + 2);
            if (sub.match(/^[\u4e00-\u9fff]{2}$/)) tokens.push(sub);
          }
        }
        return tokens;
      }).filter((t, i, arr) => t.length >= 2 && arr.indexOf(t) === i);

      if (relaxedTokens.length > 0 && relaxedTokens.join('|') !== strictPattern) {
        const relaxedPattern = relaxedTokens.map(escapeRegExp).join('|');
        const relaxedRegex = new RegExp('(' + relaxedPattern + ')', 'i');
        const relaxedResults = beforeResults.filter((r: any) => {
          const text = (r.title || '') + ' ' + (r.summary || '');
          return strictRegex.test(text) || relaxedRegex.test(text);
        });
        if (relaxedResults.length > results.length) {
          console.log('[Intel] EHR relaxed to 2-char tokens: ' + relaxedTokens.join(',') + ' → ' + relaxedResults.length + ' results for "' + objectName + '"');
          results = relaxedResults;
        }
      }
    }

    // CRITICAL FIX: Never fall back to all original results.
    // If still too few after strict + relaxed filtering, accept what we have (宁缺毋滥).
    if (results.length < 3) {
      console.warn('[Intel] EHR: only ' + results.length + ' results remain for "' + objectName + '" after filtering. Accepting as-is (宁缺毋滥).');
    }
  }
  // URL noise filter: cut e-commerce, product-catalog, auto/media pollution
  const URL_NOISE_RULES = [
    /(product|item|buy|price|mall|detail|goods)\./i,
    /\/(mall|shop|store|product|catalog|goods)\//i,
    /\.(zol|pconline|smzdm|autohome|dongchedi|xcar)\.com/i,
  ];
  // --- URL noise filter (e-commerce, auto media, etc.) ---
  const noiseBefore = results.length;
  results = results.filter((r: any) => {
    const u = (r.link || '').toLowerCase();
    if (!u) return true;
    const isNoise = URL_NOISE_RULES.some(re => re.test(u));
    if (isNoise) console.log('[Intel] Noise filtered: ' + u.substring(0, 60));
    return !isNoise;
  });
  if (results.length < noiseBefore) console.log('[Intel] Noise filter removed ' + (noiseBefore - results.length) + ' items');
  return results.slice(0, 30);
}
