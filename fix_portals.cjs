const p = require('postgres');
const db = p('postgresql://postgres.gshktfexvcyacyjtridi:Zodastream1!@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require', { ssl: 'require' });

// The exact string pattern from the DB (copied from actual HTML)
const BAD_STR = "var _kwArr=Array.isArray(src.keywords)?src.keywords:(typeof src.keywords==='string'?(src.keywords as string).split(/[,，、]/).map(function(s:string){return s.trim()}).filter(Boolean):[]);";
const GOOD_STR = "var _kwArr=Array.isArray(src.keywords)?src.keywords:(typeof src.keywords==='string'?src.keywords.split(/[,，、]/).map(function(s){return s.trim()}).filter(Boolean):[]);";

async function main() {
  const portals = await db`SELECT id, slug, html_content FROM report_sites WHERE type = 'portal' AND html_content LIKE '%src.keywords as string%\';
  console.log('Found ' + portals.length + ' portals with TS bug');
  let updated = 0, ok = 0, errors = 0;
  for (const portal of portals) {
    try {
      const html = portal.html_content || '';
      if (!html.includes('(src.keywords as string)')) { ok++; continue; }
      const newHtml = html.split(BAD_STR).join(GOOD_STR);
      if (newHtml === html) { ok++; continue; }
      await db`UPDATE report_sites SET html_content = ${newHtml}, updated_at = now() WHERE id = ${portal.id}`;
      console.log('  [FIXED] ' + portal.slug);
      updated++;
    } catch (e) {
      console.log('  [ERROR] ' + portal.slug + ': ' + e.message);
      errors++;
    }
  }
  console.log('Result: ' + updated + ' fixed, ' + ok + ' ok, ' + errors + ' errors');
  await db.end();
  process.exit(errors > 0 ? 1 : 0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
