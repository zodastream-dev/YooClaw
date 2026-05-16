#!/usr/bin/env node
const postgres = require('postgres');
const DATABASE_URL = 'postgresql://postgres.gshktfexvcyacyjtridi:Zodastream1!@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require';
const db = postgres(DATABASE_URL, { ssl: 'require' });

const OLD_PATTERN = /var _kwArr=Array\.isArray\(src\.keywords\)\?src\.keywords:\(typeof src\.keywords==='string'\?\(src\.keywords as string\)\.split\(\/\[,，、\]\/\)\.map\(function\(s:string\)\{return s\.trim\(\)\}\)\.filter\(Boolean\):\[\]\);/g;
const NEW_JS = "var _kwArr=Array.isArray(src.keywords)?src.keywords:(typeof src.keywords==='string'?src.keywords.split(/[,，、]/).map(function(s){return s.trim()}).filter(Boolean):[]);";

async function main() {
  let portals;
  try {
    portals = await db`SELECT id, slug, title, html_content FROM public.portals WHERE site_type = 'portal'`;
  } catch (e) {
    portals = await db`SELECT id, slug, title, html_content FROM report_sites WHERE site_type = 'portal'`;
  }
  console.log('Found ' + portals.length + ' portals');
  let updated = 0, skipped = 0, errors = 0;
  for (const portal of portals) {
    try {
      const html = portal.html_content || '';
      if (!html) { console.log('  [SKIP] ' + portal.slug + ': empty'); skipped++; continue; }
      OLD_PATTERN.lastIndex = 0;
      if (!OLD_PATTERN.test(html)) { console.log('  [OK]   ' + portal.slug); skipped++; continue; }
      const newHtml = html.replace(OLD_PATTERN, NEW_JS);
      if (newHtml === html) { console.log('  [SKIP] ' + portal.slug + ': no change'); skipped++; continue; }
      try {
        await db`UPDATE public.portals SET html_content = ${newHtml}, updated_at = now() WHERE id = ${portal.id}`;
      } catch (e2) {
        await db`UPDATE report_sites SET html_content = ${newHtml}, updated_at = now() WHERE id = ${portal.id}`;
      }
      console.log('  [FIXED] ' + portal.slug);
      updated++;
    } catch (e) {
      console.log('  [ERROR] ' + portal.slug + ': ' + e.message);
      errors++;
    }
  }
  console.log('Result: ' + updated + ' fixed, ' + skipped + ' skipped, ' + errors + ' errors');
  await db.end();
  process.exit(errors > 0 ? 1 : 0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
