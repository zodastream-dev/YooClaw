// patch-portal-db.ts — directly patch stored HTML in Supabase database
// Run: npx tsx scripts/patch-portal-db.ts
import { sql, initDatabase } from "../server/db.js";

const SLUG = "site-cec6c0";

const PROVIDER_FIX =
  'var PROVIDER_NAMES=window._PROVIDER_NAMES={metaso:"秘塔",serper:"Serper",newsbank:"Serper新闻库",xiaohongshu:"小红书",zhihu:"知乎",weibo:"微博",wechat:"微信","multi-engine":"多引擎",tavily:"Tavily","tianapi-generalnews":"天聚综合","tianapi-keji":"天聚科技","tianapi-ai":"天聚AI","tianapi-guonei":"天聚国内","tianapi-world":"天聚国际","tianapi-social":"天聚社会","tianapi-caijing":"天聚财经","tianapi-internet":"天聚互联网","rss-ndrc":"发改委","rss-ndrc-news":"发改委新闻","rss-mof":"财政部","rss-people":"人民网","rss-xinhua":"新华网","rss-ce":"经济日报","rss-financialnews":"金融时报","rss-jfdaily":"解放日报","rss-gmw":"光明日报","rss-cnr":"央广网","rss-stcn":"证券时报","rss-jjckb":"经济参考报","gov-mee-eia":"环保部","gov-ndrc-projects":"发改委项目","gov-cbirc-notices":"金监总局"};';

const replacements: [string, string][] = [
  // 1. PROVIDER_NAMES object — add window._PROVIDER_NAMES = and all rss/gov entries
  [/var PROVIDER_NAMES=\{metaso[^}]*\};/, PROVIDER_FIX],
  // 2. _sourceName assignment
  ["item._sourceName=sourceName;", "sourceName=window._PROVIDER_NAMES[sourceName]||sourceName;item._sourceName=sourceName;"],
  // 3. Source label on cards
  ["return p||'未知来源'})(item.source,item._provider)", "return window._PROVIDER_NAMES[p]||p||'未知来源'})(item.source,item._provider)"],
  // 4. Filter button name
  ["var name=(src.name||'未命名').trim();", "var name=window._PROVIDER_NAMES[src.name]||(src.name||'未命名').trim();"],
  // 5. Sidebar source list name
  ["escHtml(src.name||'未命名')", "escHtml(window._PROVIDER_NAMES[src.name]||src.name||'未命名')"],
];

async function main() {
  await initDatabase();
  const r = await sql`SELECT html_content FROM report_sites WHERE slug = ${SLUG}`;
  if (!r || !r[0]) { console.log("NOT FOUND"); process.exit(1); }
  let html: string = r[0].html_content;
  let patched = 0;
  for (const [pattern, replacement] of replacements) {
    const before = html.length;
    html = html.replace(pattern, replacement);
    if (html.length !== before) patched++;
  }
  await sql`UPDATE report_sites SET html_content = ${html} WHERE slug = ${SLUG}`;
  console.log(`DONE. ${patched}/${replacements.length} patches applied.`);
  console.log("Verify:", html.includes("window._PROVIDER_NAMES[src.name]"));
}

main().catch(e => { console.error(e); process.exit(1); });
