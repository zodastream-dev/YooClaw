// reset-portal-html.ts — regenerate portal HTML from current templates
import { sql, initDatabase } from "../server/db.js";

async function main() {
  await initDatabase();
  const r = await sql`SELECT id, title, widgets FROM report_sites WHERE slug = ${"site-cec6c0"}`;
  if (!r[0]) { console.log("NOT FOUND"); process.exit(1); }
  const { id, title, widgets } = r[0];
  const w = typeof widgets === "string" ? JSON.parse(widgets) : widgets;

  // Dynamically import the generator
  const { generateIntelStationHtml } = await import("../server/templates/intel-station/index.js");
  const html = generateIntelStationHtml(title, "", "https://api.yookeer.com", "site-cec6c0", w, "tech-blue");

  await sql`UPDATE report_sites SET html_content = ${html} WHERE slug = ${"site-cec6c0"}`;
  console.log("DONE. Size:", html.length, "Has window._PROVIDER_NAMES:", html.includes("window._PROVIDER_NAMES"), "Has rss-ndrc:", html.includes("rss-ndrc"));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
