// patch-db-v34.ts — V3.4: merge policy signals into single intel feed
import { sql, initDatabase } from "../server/db.js";

const SLUG = "site-cec6c0";

async function main() {
  await initDatabase();
  const r = await sql`SELECT html_content FROM report_sites WHERE slug = ${SLUG}`;
  if (!r[0]) { console.log("NOT FOUND"); process.exit(1); }
  let html: string = r[0].html_content;

  // --- 1. Replace body: policy-signals → policy-stats-bar ---
  html = html.replace(
    '<div class="policy-signals" id="policySignals" style="display:none">',
    '<div class="policy-stats-bar" id="policyStatsBar" style="display:none">'
  );
  html = html.replace(
    '<div class="policy-signals" id="policySignals" style="display:none"></div>',
    '<div class="policy-stats-bar" id="policyStatsBar" style="display:none"></div>'
  );

  // --- 2. Replace CSS: policy-signals → policy-stats-bar + policy highlight ---
  html = html.replace(
    '.policy-signals{max-height:42vh;overflow-y:auto;padding:0 24px 4px;border-bottom:1px solid var(--border);margin-bottom:4px}',
    '.policy-stats-bar{display:flex;align-items:center;gap:12px;padding:10px 24px;background:linear-gradient(135deg,rgba(0,212,255,0.06),rgba(168,85,247,0.04));border-bottom:1px solid var(--border);flex-wrap:wrap}'
  );

  // Remove V3.2-only CSS rules (they won't be used anymore)
  // policy-signal-section, policy-signal-card styles are dead code, just leave them

  // Add policy card highlight CSS before .intel-card
  html = html.replace(
    '.intel-card{',
    '.intel-card.intel-card-policy{border-left:3px solid var(--accent,#00d4ff);background:linear-gradient(135deg,rgba(0,212,255,0.03),transparent)}.intel-card{'
  );

  // --- 3. Replace renderPolicySignals → renderPolicyStatsBar + filterByPolicyCategory ---
  // Find the renderPolicySignals function and replace it
  const rpsStart = html.indexOf('function renderPolicySignals(data){');
  if (rpsStart > 0) {
    // Find the end of this function (next 'function' keyword or 'var currentCenterTab' etc.)
    let braceCount = 0;
    let inFunc = false;
    let rpsEnd = rpsStart;
    for (let i = rpsStart; i < html.length; i++) {
      if (html[i] === '{') { braceCount++; inFunc = true; }
      if (html[i] === '}') {
        braceCount--;
        if (inFunc && braceCount === 0) { rpsEnd = i + 1; break; }
      }
    }
    if (rpsEnd > rpsStart) {
      const newFunc = `function renderPolicyStatsBar(data){
var policyItems=data.filter(function(item){return item._signalType==="policy";});
var container=$("policyStatsBar");if(!container)return;
if(policyItems.length===0){container.style.display="none";return}
container.style.display="flex";
var cats={};
policyItems.forEach(function(item){var cat=item._category||"政策信号";cats[cat]=(cats[cat]||0)+1;});
var order=["政策信号","人事变动","金融监管","宏观数据","产业格局","国际环境","科技前沿"];
var sorted=Object.keys(cats).sort(function(a,b){var ia=order.indexOf(a),ib=order.indexOf(b);if(ia===-1)ia=99;if(ib===-1)ib=99;return ia-ib;});
var html="<span class=psb-label>今日政策信号："+policyItems.length+"条</span><span class=psb-cats>";
sorted.forEach(function(cat){html+="<span class=psb-cat onclick=filterByPolicyCategory('"+escHtml(cat)+"',this)>"+escHtml(cat)+" "+cats[cat]+"</span>";});
html+="</span>";container.innerHTML=html;}
function filterByPolicyCategory(cat,el){
var active=el.classList.contains("active");
var allCats=document.querySelectorAll(".psb-cat");allCats.forEach(function(c){c.classList.remove("active")});
if(!active)el.classList.add("active");
var filtered=active?allIntelData:allIntelData.filter(function(item){return item._signalType==="policy"&&(item._category||"")===cat;});
if(active){renderIntelFeed(allIntelData);return}
renderIntelFeed(filtered.length>0?filtered:allIntelData);}`;

      html = html.substring(0, rpsStart) + newFunc + html.substring(rpsEnd);
    }
  }

  // --- 4. Replace renderPolicySignals calls → renderPolicyStatsBar ---
  html = html.replace(/renderPolicySignals\(allIntelData\);/g, 'renderPolicyStatsBar(allIntelData);');

  // --- 5. Add intel-card-policy class for policy items ---
  html = html.replace(
    "var cardClass='intel-card';if(score>=75) cardClass+=' intel-card-high'",
    "var cardClass='intel-card';if(item._signalType==='policy') cardClass+=' intel-card-policy';if(score>=75) cardClass+=' intel-card-high'"
  );

  // --- 6. Remove 'policy' from PROVIDER_NAMES ---
  html = html.replace(
    ",'gov-cbirc-notices':'\\u91d1\\u76d1\\u603b\\u5c40','policy':'\\u6743\\u5a01\\u653f\\u7b56\\u4fe1\\u53f7'};",
    ",'gov-cbirc-notices':'\\u91d1\\u76d1\\u603b\\u5c40'};"
  );

  console.log("policy-stats-bar:", html.includes("policy-stats-bar"));
  console.log("intel-card-policy CSS:", html.includes("intel-card-policy{border-left"));
  console.log("renderPolicyStatsBar:", html.includes("renderPolicyStatsBar"));
  console.log("renderPolicySignals (should be 0):", html.includes("renderPolicySignals("));

  await sql`UPDATE report_sites SET html_content = ${html} WHERE slug = ${SLUG}`;
  console.log("DONE. DB updated for", SLUG);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
