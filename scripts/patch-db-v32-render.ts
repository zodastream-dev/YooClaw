// patch-db-v32-render.ts — Fix missing renderPolicySignals in both localStorage and API paths
import { sql, initDatabase } from "../server/db.js";

const SLUG = "site-cec6c0";

async function main() {
  await initDatabase();
  const r = await sql`SELECT html_content FROM report_sites WHERE slug = ${SLUG}`;
  if (!r[0]) { console.log("NOT FOUND"); process.exit(1); }
  let html: string = r[0].html_content;

  // Fix #1: localStorage cache path
  html = html.replace(
    'allIntelData=cachedData.data||[];\n        renderSourceFilters',
    'allIntelData=cachedData.data||[];\n        renderPolicySignals(allIntelData);renderSourceFilters'
  );

  // Fix #2: API response path  
  html = html.replace(
    '}catch(e){}\n    renderSourceFilters',
    '}catch(e){}\n    renderPolicySignals(allIntelData);renderSourceFilters'
  );

  // Extra safety: ensure all renderSourceFilters in loadIntelData context have renderPolicySignals
  // (some occurrences might have different whitespace)
  if (!html.includes('renderPolicySignals(allIntelData);renderSourceFilters')) {
    // Fallback: use regex on server via Python approach
    console.warn("String replacement didn't match. Trying alternate approach...");
    html = html.replace(
      /(allIntelData=cachedData\.data\|\|\[\];\s*)renderSourceFilters/g,
      '$1renderPolicySignals(allIntelData);renderSourceFilters'
    );
    html = html.replace(
      /(}catch\(e\)\{\}\s*)renderSourceFilters/g,
      '$1renderPolicySignals(allIntelData);renderSourceFilters'
    );
  }

  console.log("renderPolicySignals count:", (html.match(/renderPolicySignals\(allIntelData\);/g) || []).length);

  await sql`UPDATE report_sites SET html_content = ${html} WHERE slug = ${SLUG}`;
  console.log("DONE. DB updated for", SLUG);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
