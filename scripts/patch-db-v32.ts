// patch-db-v32.ts — Inject V3.2 policy signals template into DB HTML
import { sql, initDatabase } from "../server/db.js";

const SLUG = "site-cec6c0";

async function main() {
  await initDatabase();
  const r = await sql`SELECT html_content FROM report_sites WHERE slug = ${SLUG}`;
  if (!r[0]) { console.log("NOT FOUND"); process.exit(1); }
  let html: string = r[0].html_content;

  // 1. Add policySignals div before intelFeed
  html = html.replace(
    '<div class="intel-feed" id="intelFeed">',
    '<div class="policy-signals" id="policySignals" style="display:none"></div>\n<div class="intel-feed" id="intelFeed">'
  );

  // 2. Add policy CSS after intel-feed style
  const policyCss = '.policy-signals{padding:0 24px 4px;border-bottom:1px solid var(--border);margin-bottom:4px}.policy-signal-section{margin-bottom:8px}.policy-signal-section-header{display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer;border-bottom:1px solid rgba(var(--accent-rgb,0,212,255),0.15)}.policy-signal-section-header .label{font-size:13px;font-weight:700;color:var(--accent,#00d4ff);text-transform:uppercase}.policy-signal-section-header .count{font-size:11px;color:var(--text-secondary);background:var(--bg-card);padding:1px 6px;border-radius:8px}.policy-signal-card{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:6px;position:relative}.policy-signal-card .ps-title{font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px;line-height:1.4}.policy-signal-card .ps-title a{color:var(--accent,#00d4ff);text-decoration:none}.policy-signal-card .ps-insight{font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:4px}.policy-signal-card .ps-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--text-tertiary)}.policy-signal-card .ps-score{position:absolute;top:8px;right:10px;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px}.ps-score.s90{background:rgba(220,38,38,0.2);color:#ef4444}.ps-score.s75{background:rgba(245,158,11,0.2);color:#f59e0b}.ps-score.s60{background:rgba(34,197,94,0.2);color:#22c55e}';
  if (html.includes('.intel-feed{flex:1;overflow-y:auto;padding:16px 24px}')) {
    html = html.replace('.intel-feed{flex:1;overflow-y:auto;padding:16px 24px}', '.intel-feed{flex:1;overflow-y:auto;padding:16px 24px}' + policyCss);
  }

  // 3. Call renderPolicySignals before renderSourceFilters
  html = html.replace(
    'renderSourceFilters(monitors);',
    'renderPolicySignals(allIntelData);renderSourceFilters(monitors);'
  );

  // 4. Add renderPolicySignals function
  const psFunc = `function renderPolicySignals(data){
var policyItems=data.filter(function(item){return item._signalType==="policy";});
var container=$("policySignals");if(!container)return;
if(policyItems.length===0){container.style.display="none";return}
container.style.display="block";
var groups={};
policyItems.forEach(function(item){var cat=item._category||"\u5176\u4ed6";if(!groups[cat])groups[cat]=[];groups[cat].push(item);});
var cats=Object.keys(groups);
var html="";
cats.forEach(function(cat){
var items=groups[cat];items.sort(function(a,b){return(parseInt(b._valueScore)||0)-(parseInt(a._valueScore)||0);});
html+="<div class=\\"policy-signal-section\\">";
html+="<div class=\\"policy-signal-section-header\\"><span class=\\"label\\">"+escHtml(cat)+"</span><span class=\\"count\\">"+items.length+"\u6761</span></div>";
items.forEach(function(item){
var score=parseInt(item._valueScore)||60;
var sc="s60";if(score>=90)sc="s90";else if(score>=75)sc="s75";
html+="<div class=\\"policy-signal-card\\">";
html+="<span class=\\"ps-score "+sc+"\\">"+score+"</span>";
if(item.link){html+="<div class=\\"ps-title\\"><a href=\\""+escHtml(item.link)+"\\" target=\\"_blank\\" rel=\\"noopener\\">"+escHtml(item.title)+"</a></div>";}
else{html+="<div class=\\"ps-title\\">"+escHtml(item.title)+"</div>";}
html+="<div class=\\"ps-insight\\">"+escHtml(item.summary||"")+"</div>";
html+="<div class=\\"ps-meta\\"><span class=\\"source\\">"+escHtml(item.source||"")+"</span></div>";
html+="</div>";
});
html+="</div>";
});
container.innerHTML=html;
}`;

  html = html.replace('function renderIntelFeed(data){', psFunc + '\nfunction renderIntelFeed(data){');

  await sql`UPDATE report_sites SET html_content = ${html} WHERE slug = ${SLUG}`;
  console.log("DONE. Has policySignals:", html.includes("policySignals"), "Has renderPolicySignals:", html.includes("renderPolicySignals"));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
