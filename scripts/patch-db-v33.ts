// patch-db-v33.ts — Fix policy signals: scrolling, collapse, provider name
import { sql, initDatabase } from "../server/db.js";

const SLUG = "site-cec6c0";

async function main() {
  await initDatabase();
  const r = await sql`SELECT html_content FROM report_sites WHERE slug = ${SLUG}`;
  if (!r[0]) { console.log("NOT FOUND"); process.exit(1); }
  let html: string = r[0].html_content;

  // Fix 1: CSS — add max-height + overflow to policy-signals so it scrolls
  html = html.replace(
    ".policy-signals{padding:0 24px 4px;border-bottom:1px solid var(--border);margin-bottom:4px}",
    ".policy-signals{max-height:42vh;overflow-y:auto;padding:0 24px 4px;border-bottom:1px solid var(--border);margin-bottom:4px}"
  );
  console.log("CSS fix:", html.includes("max-height:42vh"));

  // Fix 2: PROVIDER_NAMES — add 'policy' mapping
  html = html.replace(
    ",'gov-cbirc-notices':'\\u91d1\\u76d1\\u603b\\u5c40'};",
    ",'gov-cbirc-notices':'\\u91d1\\u76d1\\u603b\\u5c40','policy':'\\u6743\\u5a01\\u653f\\u7b56\\u4fe1\\u53f7'};"
  );
  console.log("PROVIDER_NAMES fix:", html.includes("policy"));

  // Fix 3: renderPolicySignals — add collapse onclick to section headers
  // The current pattern in DB HTML wraps each section's items in a container
  // We need to add click-to-toggle on the header
  html = html.replace(
    '<div class=\\"policy-signal-section-header\\"><span class=\\"label\\">',
    '<div class=\\"policy-signal-section-header\\" onclick=\\"var s=this.nextElementSibling;if(s){s.style.display=s.style.display===\\'none\\'?\\'\\':\\'none\\'}\\"><span class=\\"label\\">'
  );
  console.log("renderPolicySignals fix:", (html.match(/policy-signal-section-header/g) || []).length, "headers");

  await sql`UPDATE report_sites SET html_content = ${html} WHERE slug = ${SLUG}`;
  console.log("DONE. DB updated for", SLUG);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
