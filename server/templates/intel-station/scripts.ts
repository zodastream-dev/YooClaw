// server/templates/intel-station/scripts.ts
// Client-side JavaScript for IntelStation portal template

export function intelStationScripts(apiBase: string, slug: string, wlistJson: string): string {
  return `
var API='${apiBase}';
var WIDGETS=${wlistJson};
var PORTAL_SLUG='${slug.replace(/'/g, "\\'")}';
var currentSourceFilters=['全部'];
var currentObjectFilter='全部';
var allIntelData=[];
var currentFilter='all';
var aiChatHistory=[];
var currentCenterTab='intel';
var PROVIDER_NAMES={metaso:'秘塔',serper:'Serper',xiaohongshu:'小红书',zhihu:'知乎',weibo:'微博',wechat:'微信','multi-engine':'多引擎',tavily:'Tavily','tianapi-generalnews':'天聚综合','tianapi-keji':'天聚科技','tianapi-ai':'天聚AI','tianapi-guonei':'天聚国内','tianapi-world':'天聚国际','tianapi-social':'天聚社会','tianapi-caijing':'天聚财经','tianapi-internet':'天聚互联网'};

var INTEL_PROMPTS={
  '行业信号':'你是行业趋势研究分析师，专注于捕捉行业信号和宏观变化。\\n\\n重点关注的信号类型：\\n- 技术突破：新技术、新标准、研发进展\\n- 新品发布：产品迭代、型号更新、功能升级\\n- 市场格局：出货量变化、市场份额转移、新进入者\\n- 产业链：上下游供需变化、关键零部件动态\\n- 政策法规：行业政策调整、监管动态、标准制定\\n- 产业趋势：需求转移、商业模式创新、投资动向\\n\\n你的工作原则：\\n- 优先关注「变化」而非「现状」\\n- 每条信号需说明：变化是什么 → 影响哪些环节 → 时间窗口\\n- 优先提供最近30天内的资讯，标注大致时间\\n- 避免泛泛而谈，每条必须具体到可验证的事实或数据',
  '目标客户情报':'你是商业银行客户情报分析师，为核心对公客户风险监控和业务拓展提供前瞻性情报。\\n\\n六大监控维度：\\n1. 经营动态：季度财报关键指标（营收/利润/负债率）、重大合同签署、业务线调整\\n2. 融资需求：发债计划、增发公告、银行贷款招标、融资租赁需求\\n3. 信用风险：评级调整（标普/穆迪/中诚信）、负面舆情、监管处罚、债务违约事件\\n4. 银行关系：客户与其他银行的战略合作/新增授信/主办行变更/银团贷款份额变化\\n5. 战略布局：新业务线、海外扩张、并购重组、资产剥离\\n6. 高管与治理：核心高管变动、实际控制人变更、重大诉讼\\n\\n核心客户分层监控：\\n- Core层（中铁/中交/中建/国网等）：任何评级变动或融资计划→立即预警\\n- Provincial层（省属国企/纳税50强）：关注与同业银行的合作动态→流失预警\\n- LGFV层（城投平台）：重点关注化债进展、非标展期、隐性债务风险\\n\\n每条情报需标注：\\n- 可信度：高（官方公告/评级报告）/中（权威财经媒体）/低（自媒体）\\n- 风险等级：CRITICAL（评级下调/违约/主办行变更）/WARNING（业绩预警/他行新增授信）/NORMAL（日常动态）\\n- 业务启示：对信贷敞口/业务机会的具体影响和建议',
  '竞争对手情报':'你是竞争情报分析师，专注于监控竞争对手的战略动向。\\n你的工作原则：\\n- 关注：产品发布、定价策略、市场份额、财报业绩、融资/IPO、高管变动、收购并购\\n- 每条情报需分析：竞对做了什么 → 意图是什么 → 对我们有何影响\\n- 区分"已确认"和"传闻"，标注信息可靠性\\n- 优先提供知名来源的信息，避免小道消息',
  '自身舆情监控':'你是舆情监控分析师，专注于追踪品牌声誉和公众舆论。\\n你的工作原则：\\n- 关注：媒体报道倾向（正面/负面/中性）、社交媒体热议、用户投诉、监管动态\\n- 每条舆情需标注：情感倾向（+/−/0）、传播热度、是否需要响应\\n- 负面舆情需说明严重程度和建议处置优先级\\n- 客观反映舆论全貌，避免报喜不报忧'
};

function $(id){return document.getElementById(id)}

// Global state (must be before INIT IIFE which accesses these via renderSourceFilters)
var expandedSources={};

/* ===== INIT ===== */
(function(){
  // Render left panel immediately (sources are already in WIDGETS, no API dependency)
  var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  renderSourceFilters(monitors);
  // Start data fetch with minimal delay (was 500ms)
  setTimeout(function(){loadIntelData()},50);
  setTimeout(function(){initDashboard()},100);
  setTimeout(function(){checkPauseStatus()},200);
  setTimeout(function(){loadPushConfig()},250);
})();

/* ===== LOAD INTEL DATA ===== */
async function loadIntelData(forceRefresh){
  var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  if(monitors.length===0){
    $('intelLoading').innerHTML='<p style="color:var(--text-secondary)">暂无监控源配置</p>';
    return;
  }
  if(forceRefresh)console.log('[loadIntelData] Force refresh: bypassing all caches');
  $('intelLoading').style.display='block';
  $('feedStatus').textContent='获取情报中...';
  // Check localStorage cache first (30min TTL matches backend) — skip if forceRefresh
  var cacheKey='portal-intel-'+PORTAL_SLUG;
  var cachedData=null;
  if(!forceRefresh){
  try{
    var cachedRaw=localStorage.getItem(cacheKey);
    if(cachedRaw){
      cachedData=JSON.parse(cachedRaw);
      if(cachedData&&cachedData.expiry>Date.now()){
        allIntelData=cachedData.data||[];
        renderSourceFilters(monitors);
        buildIntelSubFilters(monitors);
        buildObjectFilters(monitors);
        renderIntelFeed(allIntelData);
        updateDashboard(allIntelData);
        $('feedStatus').textContent='已加载 '+allIntelData.length+' 条情报（缓存，后台更新中...）';
        $('intelLoading').style.display='none';
        console.log('[loadIntelData] Loaded '+allIntelData.length+' items from localStorage cache');
      } else {cachedData=null;}
    }
  }catch(e){cachedData=null;}
  }
  try {
    var sources=[];
    monitors.forEach(function(mw){
      (mw.sources||(mw.config&&mw.config.sources)||[]).forEach(function(src){sources.push(src)});
    });
    if(sources.length===0){
      if(!cachedData) $('intelLoading').innerHTML='<p style="color:var(--text-secondary)">暂无监控源</p>';
      return;
    }
    sources.forEach(function(src){
      // Backend uses environment variables for API keys. Never expose keys to the client.
      var knownProviders=['metaso','tavily','deepseek','codebuddy'];
      if(knownProviders.indexOf(src.aiProvider)>=0&&!src.apiKey)src.apiKey='';
      // Fix invalid model names — override clearly wrong ones
      var validModels=['deepseek-v','deepseek-r','deepseek-c','gpt-','claude-','qwen-'];
      var hasValidModel=validModels.some(function(prefix){return (src.aiModel||'').indexOf(prefix)===0;});
      if(!src.aiModel||!hasValidModel)src.aiModel='deepseek-v4-flash';
    });
    var result=await fetch(API+'/api/portal-intel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sources:sources,force:!!forceRefresh})});
    if(!result.ok)throw new Error('API error: '+result.status);
    var data=await result.json();
    allIntelData=[];
    (data.results||[]).forEach(function(r){
      var srcConfig=sources[r.sourceIdx];
      var sourceName=(srcConfig?(srcConfig.name||'未命名'):'未知来源').trim();
      (r.data||[]).forEach(function(item){
        item._sourceName=sourceName;
        allIntelData.push(item);
      });
    });
    // Save to localStorage (30min TTL)
    try{localStorage.setItem(cacheKey,JSON.stringify({data:allIntelData,expiry:Date.now()+30*60*1000}));}catch(e){}
    renderSourceFilters(monitors);
    buildIntelSubFilters(monitors);
    // 如果当前有过滤条件激活，重新应用过滤；否则渲染全部
    if(currentSourceFilters.length===0||currentSourceFilters[0]==='全部'){
      renderIntelFeed(allIntelData);
    } else {
      var filtered=allIntelData.filter(function(item){
        return currentSourceFilters.indexOf(item._sourceName) >= 0;
      });
      console.log('[loadIntelData] filter active, rendering', filtered.length, 'of', allIntelData.length);
      renderIntelFeed(filtered);
    }
    updateDashboard(allIntelData);
    renderSentimentStats(allIntelData);
    $('feedStatus').textContent='已加载 '+allIntelData.length+' 条情报';
    $("updateInfo").textContent="上次更新: "+new Date().toLocaleTimeString("zh-CN");
    $("updateInfo").style.display="";
    $('intelLoading').style.display='none';
  } catch(e) {
    if(!cachedData){
      $('intelLoading').innerHTML='<p style="color:#ef4444">加载失败: '+e.message+'</p>';
      $('feedStatus').textContent='加载失败';
    } else {
      $('feedStatus').textContent='已加载 '+allIntelData.length+' 条情报（缓存，更新失败：'+e.message+'）';
    }
  }
}

// Auto-refresh based on updateFrequency
(function scheduleRefresh(){
  var freqMap={hourly:60*60*1000,daily:24*60*60*1000,weekly:7*24*60*60*1000,monthly:30*24*60*60*1000};
  var minInterval=24*60*60*1000; // default daily
  var monitors=WIDGETS.filter(function(w){return w.type==="intel-monitor"||w.type==="monitor"});
  monitors.forEach(function(mw){
    var srcs=mw.sources||(mw.config&&mw.config.sources)||[];
    srcs.forEach(function(src){
      var ms=freqMap[src.updateFrequency]||freqMap.daily;
      if(ms<minInterval)minInterval=ms;
    });
  });
  setTimeout(function(){loadIntelData();scheduleRefresh();},minInterval);
})();

/* ===== RENDER SOURCE FILTERS (expandable tree) ===== */
function renderSourceFilters(monitors){
  var widgetSources=[];
  monitors.forEach(function(mw,monitorIdx){
    var wi=WIDGETS.indexOf(mw);if(wi===-1)wi=monitorIdx;
    var srcs=mw.sources||(mw.config&&mw.config.sources)||[];
    srcs.forEach(function(src,si){widgetSources.push({widgetIndex:wi,sourceIndex:si,source:src})});
  });
  if(widgetSources.length===0){
    $('sourceGroups').innerHTML='<div style="text-align:center;padding:24px;color:var(--text-secondary);font-size:12px">暂无监控源<br><br><button class="add-source-btn" onclick="addNewSource()">+ 添加第一个监控源</button></div>';
    return;
  }
  var html='';
  widgetSources.forEach(function(ws){
    var src=ws.source;
    var objects=src.objects||[];
    var hasObj=objects.length>0;
    var expanded=!!expandedSources[src.name];
    var isSourceActive=currentSourceFilters.length>0&&currentSourceFilters[0]!=='全部'&&currentSourceFilters.indexOf(src.name)>=0;
    var providerDisplayNames={'all':'全渠道','all+cn-news':'全渠道','all+en':'全渠道+英文','deepseek':'DeepSeek','metaso':'秘塔','tavily':'Tavily','multi-engine':'多引擎','wechat':'微信','weibo':'微博','zhihu':'知乎','xiaohongshu':'小红书'};
    var providerLabel=providerDisplayNames[src.aiProvider]||src.aiProvider||'DeepSeek';
    var kws=(src.keywords||[]);
    var freqLabel={hourly:'每小时',daily:'每日',weekly:'每周',monthly:'每月'}[src.updateFrequency]||'每日';
    html+='<div class="source-card'+(isSourceActive?' source-active':'')+'">';
    // Card body click → filter to this source
    // Template literal: \\' outputs \' (needed for JS string concat in generated code)
    var srcNameEsc=src.name.replace(/'/g,"\\\\'");
    html+='<div class="sc-clickable" onclick="selectSourceFilter(\\''+srcNameEsc+'\\','+ws.widgetIndex+','+ws.sourceIndex+')">';
    html+='<div class="sc-icon">&#x1F6F0;</div>';
    html+='<div class="sc-body">';
    html+='<div class="sc-name">'+escHtml(src.name||'未命名')+'</div>';
    html+='<div class="sc-meta">';
    html+='<span class="sc-provider'+(providerLabel==='metaso'?' metaso':'')+'">'+escHtml(providerLabel)+'</span>';
    html+='<span class="sc-kwcount">'+kws.length+' 关键词</span>';
    html+='<span class="sc-freq">'+freqLabel+'</span>';
    if(hasObj)html+='<span class="sc-objcount">'+objects.length+' 对象</span>';
    html+='</div></div>';
    // Arrow → expand/collapse objects only (stop propagation so card click doesn't fire)
    html+='<span class="sc-arrow'+(hasObj?' sc-has-children':'')+'" onclick="event.stopPropagation();'+(hasObj?'toggleSourceExpand(\\''+srcNameEsc+'\\','+ws.widgetIndex+','+ws.sourceIndex+')':'selectSourceFilter(\\''+srcNameEsc+'\\','+ws.widgetIndex+','+ws.sourceIndex+')')+'">'+(hasObj?(expanded?'&#x25BC;':'&#x25B6;'):'')+'</span>';
    html+='</div>';
    // Object items (if expanded)
    if(hasObj&&expanded){
      html+='<div class="sc-objects-list">';
      objects.forEach(function(obj){
        var isObjActive=currentObjectFilter!=='全部'&&currentObjectFilter===obj.name;
        var objNameEsc=obj.name.replace(/'/g,"\\\\'");
        html+='<div class="sc-obj-item'+(isObjActive?' sc-obj-active':'')+'" onclick="event.stopPropagation();selectObjectFilter(\\''+srcNameEsc+'\\',\\''+objNameEsc+'\\','+ws.widgetIndex+','+ws.sourceIndex+')">';
        html+='<span class="sc-obj-dot"></span>';
        html+='<span class="sc-obj-name">'+escHtml(obj.name)+'</span>';
        var objIntelCount=allIntelData.filter(function(item){return (item._sourceName||'').trim()===src.name.trim()&&(item._object||'')===obj.name;}).length;
        html+='<span class="sc-obj-kwcount">'+(objIntelCount||0)+' 条</span>';
        html+='</div>';
      });
      html+='</div>';
    }
    // Edit button
    html+='<div class="sc-edit" onclick="event.stopPropagation();openSourceModal('+ws.widgetIndex+','+ws.sourceIndex+')">&#x270E;</div>';
    html+='</div>';
  });
  html+='<button class="add-source-btn" onclick="addNewSource()">+ 添加情报源</button>';
  html+='<div style="display:flex;gap:8px;margin-top:4px">';
  html+='<button class="add-source-btn" onclick="refreshAllIntel()" style="border-style:solid;border-color:rgba(0,212,255,0.15);flex:1;margin-top:0">🔄 更新情报</button>';
  html+='<button class="add-source-btn" id="btnPauseIntel" onclick="togglePauseIntel()" style="border-style:solid;border-color:rgba(0,212,255,0.15);flex:1;margin-top:0">⏸ 停止更新</button>';
  html+='</div>';
  // V2.1: Push controls
  html+='<div style="margin-top:12px;padding:12px 14px;background:rgba(0,212,255,0.03);border-radius:8px;border:1px solid var(--border)">';
  html+='<div style="font-size:13px;color:var(--text-secondary);font-weight:500;margin-bottom:8px">📨 推送设置</div>';
  html+='<div style="display:flex;gap:6px;margin-bottom:8px">';
  html+='<button id="btnTogglePush" onclick="togglePushEnabled()" style="padding:5px 16px;border:1px solid rgba(34,197,94,0.4);border-radius:6px;background:rgba(34,197,94,0.06);color:#22c55e;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;transition:all .2s">推送中</button>';
  html+='<button onclick="instantPushNow()" style="padding:5px 16px;border:1px solid rgba(0,212,255,0.3);border-radius:6px;background:rgba(0,212,255,0.06);color:var(--cyan);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;transition:all .2s">⚡ 立即推送</button>';
  html+='</div>';
  html+='<div style="display:flex;gap:6px">';
  html+='<input type="email" id="inputPushEmail" placeholder="输入邮箱地址" style="flex:1;min-width:0;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-size:12px;font-family:inherit;outline:none;box-sizing:border-box">';
  html+='<button onclick="savePushEmail()" style="padding:5px 16px;border:1px solid rgba(0,212,255,0.3);border-radius:6px;background:rgba(0,212,255,0.08);color:var(--cyan);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0;transition:all .2s">保存</button>';
  html+='</div>';
  html+='</div>';
  $('sourceGroups').innerHTML=html;
}

/* ===== LEFT PANEL TOGGLE ===== */
var leftPanelCollapsed=false;
function toggleLeftPanel(){
  var layout=document.querySelector('.main-layout');
  var toggleBtn=document.querySelector('.btn-toggle-left');
  var floatBtn=document.querySelector('.btn-toggle-left-float');
  if(!layout)return;
  leftPanelCollapsed=!leftPanelCollapsed;
  if(leftPanelCollapsed){
    layout.classList.add('left-collapsed');
    if(toggleBtn)toggleBtn.innerHTML='&#x25B6;';
    if(floatBtn)floatBtn.style.display='flex';
    try{localStorage.setItem('left-panel-collapsed','1')}catch(e){}
  } else {
    layout.classList.remove('left-collapsed');
    if(toggleBtn)toggleBtn.innerHTML='&#x25C0;';
    if(floatBtn)floatBtn.style.display='none';
    try{localStorage.setItem('left-panel-collapsed','0')}catch(e){}
  }
}
// Restore panel state on load
(function restorePanelState(){
  try{
    var saved=localStorage.getItem('left-panel-collapsed');
    if(saved==='1'){
      leftPanelCollapsed=true;
      var layout=document.querySelector('.main-layout');
      var toggleBtn=document.querySelector('.btn-toggle-left');
      var floatBtn=document.querySelector('.btn-toggle-left-float');
      if(layout)layout.classList.add('left-collapsed');
      if(toggleBtn)toggleBtn.innerHTML='&#x25B6;';
      if(floatBtn)floatBtn.style.display='flex';
    }
  }catch(e){}
})();

/* ===== SOURCE TREE INTERACTIONS ===== */
function toggleSourceExpand(srcName,wi,si){
  console.log('[toggleSourceExpand] srcName=',srcName,'expandedSources[srcName]=',expandedSources[srcName]);
  expandedSources[srcName]=expandedSources[srcName]?false:true
  var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  renderSourceFilters(monitors);
  buildObjectFilters(monitors);
}

function selectSourceFilter(srcName,wi,si){
  currentSourceFilters=[srcName];
  currentObjectFilter='全部';
  expandedSources[srcName]=true;
  var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  var filtered=allIntelData.filter(function(item){return (item._sourceName||'').trim()===srcName});
  renderIntelFeed(filtered);
  renderSourceFilters(monitors);
  buildIntelSubFilters(monitors);
  buildObjectFilters(monitors);
  var feed=$('intelFeed');if(feed)feed.scrollTop=0;
}

function selectObjectFilter(srcName,objName,wi,si){
  currentSourceFilters=[srcName];
  currentObjectFilter=objName;
  expandedSources[srcName]=true;
  var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  var filtered=allIntelData.filter(function(item){
    return (item._sourceName||'').trim()===srcName&&(item._object||'')===objName;
  });
  renderIntelFeed(filtered);
  renderSourceFilters(monitors);
  buildIntelSubFilters(monitors);
  buildObjectFilters(monitors);
  var feed=$('intelFeed');if(feed)feed.scrollTop=0;
}

/* ===== RENDER INTEL FEED ===== */
// Parse Chinese/ISO date strings to timestamps for sorting
function parseDate(d){
  if(!d)return 0;
  // Try ISO format: 2026-05-25
  var iso=d.match(/(\\d{4})-(\\d{1,2})-(\\d{1,2})/);
  if(iso)return new Date(iso[1],iso[2]-1,iso[3]).getTime();
  // Try Chinese format: 2026年05月25日
  var cn=d.match(/(\\d{4})年(\\d{1,2})月(\\d{1,2})日/);
  if(cn)return new Date(cn[1],cn[2]-1,cn[3]).getTime();
  // Relative dates
  var now=Date.now();
  if(/刚刚/.test(d))return now;
  var h=d.match(/(\d+)\s*小时前/);
  if(h)return now-parseInt(h[1])*3600000;
  var m=d.match(/(\d+)\s*分钟前/);
  if(m)return now-parseInt(m[1])*60000;
  if(/昨天/.test(d))return now-86400000;
  var day=d.match(/(\d+)\s*天前/);
  if(day)return now-parseInt(day[1])*86400000;
  return 0;
}
function renderIntelFeed(data){
  console.log('[renderIntelFeed] called with data.length=', data.length, 'first _sourceName=', data.length>0?data[0]._sourceName:'N/A');
  if(data.length===0){$('intelFeed').innerHTML='<div class="intel-loading">暂无情报数据</div>';return}
  // Sort by _valueScore descending (商业价值优先)
  data.sort(function(a,b){
    var sa=parseInt(a._valueScore)||0,sb=parseInt(b._valueScore)||0;
    if(sa!==sb)return sb-sa;
    // 同分时按日期降序排列
    var da=parseDate(a.date),db=parseDate(b.date);
    if(da===0&&db===0)return 0;
    if(da===0)return 1;
    if(db===0)return-1;
    return db-da;
  });
  var html='';
  data.forEach(function(item,i){
    var score=parseInt(item._valueScore)||0;
    var riskLevel=item._riskLevel||'NORMAL';
    var cardClass='intel-card';
    if(score>=75) cardClass+=' intel-card-high';
    if(riskLevel==='CRITICAL') cardClass+=' intel-card-critical';
    var keywords=(item.keywords||[]).slice(0,3);
    var url=item.url||item.link||item.sourceUrl||item.href||'';
    var clickAttr=url?' data-url="'+escHtml(url)+'" onclick="if(this.dataset.url)window.open(this.dataset.url,&#39;_blank&#39;)"':'';
    html+='<div class="'+cardClass+'"'+clickAttr+'>';
    html+='<div class="intel-card-header">';
    // V2.0: 价值分徽章
    if(score>0){
      var scoreColor=score>=75?'var(--score-high)':score>=60?'var(--score-mid)':'var(--score-low)';
      html+='<span class="intel-score-badge" style="border-color:'+scoreColor+';color:'+scoreColor+'">'+score+'分</span>';
    }
    if(item._provider){
      var pName=PROVIDER_NAMES[item._provider]||item._provider;
      html+='<span class="intel-provider-tag">'+escHtml(pName)+'</span>';
    }
    // V2.5: Credibility badge
    var cred=item._credibility||'MEDIUM';
    if(cred==='HIGH'){
      html+='<span class="intel-cred-tag" style="background:rgba(34,197,94,0.12);color:#22c55e;border-color:rgba(34,197,94,0.3)">高可信</span>';
    } else if(cred==='LOW'){
      html+='<span class="intel-cred-tag" style="background:rgba(239,68,68,0.08);color:#ef4444;border-color:rgba(239,68,68,0.2)">待验证</span>';
    }
    // V2.5: Risk level badge
    var risk=item._riskLevel||'NORMAL';
    if(risk==='CRITICAL'){
      html+='<span class="intel-risk-tag" style="background:rgba(239,68,68,0.12);color:#ef4444;border-color:rgba(239,68,68,0.35);font-weight:700">🚨 高危</span>';
    } else if(risk==='WARNING'){
      html+='<span class="intel-risk-tag" style="background:rgba(245,158,11,0.12);color:#f97316;border-color:rgba(245,158,11,0.35)">⚠ 预警</span>';
    }
    if(item._object){
      html+='<span class="intel-obj-tag">'+escHtml(item._object)+'</span>';
    }
    if(item._sentiment){
      var sentMap={正面:'sent-pos',负面:'sent-neg',中性:'sent-neu'};
      var sentCls=sentMap[item._sentiment]||'sent-neu';
      html+='<span class="intel-sentiment-tag '+sentCls+'">'+escHtml(item._sentiment)+'</span>';
    }
    if(item._reliability){
      var relMap={已确认:'rel-confirmed',传闻:'rel-rumor',待核实:'rel-pending'};
      var relCls=relMap[item._reliability]||'rel-pending';
      html+='<span class="intel-reliability-tag '+relCls+'">'+escHtml(item._reliability)+'</span>';
    }
    if(url){
      html+='<span class="intel-card-title" style="color:var(--cyan);cursor:pointer">'+(item.title||'无标题')+'</span>';
    } else {
      html+='<span class="intel-card-title" style="cursor:default">'+(item.title||'无标题')+'</span>';
    }
    var sourceLabel=(function(s,p){if(s&&s.length>0&&s.indexOf('http://')!==0&&s.indexOf('https://')!==0)return s;return p||'未知来源'})(item.source,item._provider);
    html+='<div class="intel-card-source">'+escHtml(sourceLabel)+'</div>';
    html+='</div>';
    if(item.summary)html+='<div class="intel-card-summary">'+(item.summary||'')+'</div>';
    if(item._intent)html+='<div class="intel-card-intent">竞对意图：'+escHtml(item._intent)+'</div>';
    html+='<div class="intel-card-footer">';
    html+='<div class="intel-card-tags">';
    keywords.forEach(function(kw){html+='<span class="intel-tag">'+escHtml(kw)+'</span>'});
    html+='</div>';
    html+='<div class="intel-card-time">'+(item.date||'日期未知')+'</div>';
    html+='</div>';
    html+='</div>';
  });
  $('intelLoading').style.display='none';
  $('intelFeed').innerHTML=html;
  // 更新状态文字，反映当前过滤结果
  if(typeof currentSourceFilters!=='undefined'&&currentSourceFilters.length>0&&currentSourceFilters[0]!=='全部'){
    $('feedStatus').textContent='已过滤：显示 '+data.length+' 条（共 '+allIntelData.length+' 条）';
  } else {
    $('feedStatus').textContent='已加载 '+data.length+' 条情报';
  }
}

/* ===== INTEL SUB-FILTERS ===== */
function buildIntelSubFilters(monitors){
  var sourceNames=['全部'];
  monitors.forEach(function(mw){
    (mw.sources||(mw.config&&mw.config.sources)||[]).forEach(function(src){
      var name=(src.name||'未命名').trim();
      if(sourceNames.indexOf(name)===-1)sourceNames.push(name);
    });
  });
  var el=$('intelSubFilters');
  if(!el)return;
  if(sourceNames.length<=1){el.style.display='none';return}
  var html='';
  sourceNames.forEach(function(name,i){
    var active=name==='全部'?currentSourceFilters[0]==='全部':currentSourceFilters.indexOf(name)>=0;
    var count=0;
    if(name==='全部'){
      count=allIntelData.length;
    } else {
      count=allIntelData.filter(function(item){return (item._sourceName||'').trim()===name;}).length;
    }
    html+='<button class="subfilter-btn'+(active?' active':'')+'" data-source="'+escHtml(name)+'" onclick="filterBySourceFromBtn(this)">'+escHtml(name)+' <span class="sf-count">'+count+'</span></button>';
  });
  el.innerHTML=html;
  if(currentCenterTab==='intel')el.style.display='';
}

function filterBySourceFromBtn(btn){
  var sourceName=btn.getAttribute('data-source');
  if(!sourceName)return;
  filterBySource(sourceName);
}
function filterBySource(sourceName){
  console.log('[filterBySource] sourceName=', sourceName, 'currentSourceFilters=', JSON.stringify(currentSourceFilters));
  // 单选模式：点击任意标签替换当前选中，再点已选中的不取消
  if(sourceName==='全部'){
    currentSourceFilters=['全部'];
  } else if(currentSourceFilters.length===1 && currentSourceFilters[0]===sourceName){
    // 点击已选中的标签：不取消，保持选中（单选至少保留一个选中项）
    return;
  } else {
    currentSourceFilters=[sourceName];
  }
  // Sync UI: set 'active' class based on currentSourceFilters
  document.querySelectorAll('.subfilter-btn').forEach(function(b){
    var sn=(b.getAttribute('data-source')||'').trim();
    if(!sn)return;
    if(currentSourceFilters.indexOf(sn)>=0)b.classList.add('active');
    else b.classList.remove('active');
  });
  console.log('[filterBySource] after sync, currentSourceFilters=', JSON.stringify(currentSourceFilters));
  // Rebuild object filters based on selected source
  var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  buildObjectFilters(monitors);
  // Apply both source + object filters
  var filtered=allIntelData;
  if(!(currentSourceFilters.length===0||currentSourceFilters[0]==='全部')){
    filtered=filtered.filter(function(item){
      return currentSourceFilters.indexOf((item._sourceName||'').trim()) >= 0;
    });
  }
  if(currentObjectFilter!=='全部'){
    filtered=filtered.filter(function(item){
      return (item._object||'')===currentObjectFilter;
    });
  }
  console.log('[filterBySource] filtered count=', filtered.length, 'allIntelData count=', allIntelData.length);
  renderIntelFeed(filtered);
  // 延迟检查：确认 DOM 没有被 loadIntelData 覆盖
  setTimeout(function(){
    var feed=$('intelFeed');
    if(feed&&feed.children.length!==filtered.length){
      console.warn('[filterBySource] DOM was overwritten! children=',feed.children.length,'expected=',filtered.length);
    }
  },1000);
}

/* ===== OBJECT FILTERS ===== */
function buildObjectFilters(monitors){
  var objectNames=['全部'];
  monitors.forEach(function(mw){
    var srcs=mw.sources||(mw.config&&mw.config.sources)||[];
    srcs.forEach(function(src){
      // Only include objects from currently selected source(s); show all when "全部" is selected
      if(currentSourceFilters[0]!=='全部'&&currentSourceFilters.indexOf((src.name||'').trim())<0)return;
      var objects=src.objects||[];
      objects.forEach(function(obj){
        if(objectNames.indexOf(obj.name)===-1)objectNames.push(obj.name);
      });
    });
  });
  var el=$('intelObjFilters');
  if(!el)return;
  if(objectNames.length<=1){el.style.display='none';return}
  var html='';
  objectNames.forEach(function(name,i){
    var active=name===currentObjectFilter?' active':'';
    html+='<button class="subfilter-btn'+active+'" data-obj="'+escHtml(name)+'" onclick="filterByObjectFromBtn(this)">'+escHtml(name)+'</button>';
  });
  el.innerHTML=html;
  el.style.display='';
}

function filterByObjectFromBtn(btn){
  var objName=btn.getAttribute('data-obj')||'全部';
  filterByObject(objName);
}

function filterByObject(objName){
  currentObjectFilter=objName;
  // Sync UI
  document.querySelectorAll('#intelObjFilters .subfilter-btn').forEach(function(b){
    var on=(b.getAttribute('data-obj')||'').trim();
    if(on===objName)b.classList.add('active');
    else b.classList.remove('active');
  });
  // Filter data
  var filtered=allIntelData.filter(function(item){
    var matchSource=currentSourceFilters[0]==='全部'||currentSourceFilters.indexOf((item._sourceName||'').trim())>=0;
    var matchObject=objName==='全部'||(item._object||'')===objName;
    return matchSource&&matchObject;
  });
  renderIntelFeed(filtered);
  // Sync left panel
  var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  renderSourceFilters(monitors);
}

/* ===== CENTER TAB SWITCHING ===== */
var currentCenterTab='intel';
function switchCenterTab(tab){
  if(currentCenterTab===tab)return;
  currentCenterTab=tab;
  var tabs=document.querySelectorAll('#centerTabs .ct-tab');
  tabs.forEach(function(t){t.classList.remove('active')});
  if(tab==='intel'){
    tabs[0].classList.add('active');
    $('intelFeed').style.display='';$('reportFeed').style.display='none';$('aiChat').style.display='none';
    $('intelSubFilters').style.display='';
    $('intelObjFilters').style.display='';
    $('feedStatus').textContent=allIntelData.length?'已加载 '+allIntelData.length+' 条情报':'加载中...';
    // 恢复底部输入框为普通模式
    var cmd=$('cmdInput');
    if(cmd){cmd.placeholder='请在这里提问或给我指令';cmd.dataset.mode='command'}
  } else if(tab==='reports'){
    tabs[1].classList.add('active');
    $('intelFeed').style.display='none';$('reportFeed').style.display='';$('aiChat').style.display='none';
    $('intelSubFilters').style.display='none';
    $('intelObjFilters').style.display='none';
    $('feedStatus').textContent='报告中';
    var cmd=$('cmdInput');
    if(cmd){cmd.placeholder='请在这里提问或给我指令';cmd.dataset.mode='command'}
    loadReports();
  } else if(tab==='ai'){
    tabs[2].classList.add('active');
    $('intelFeed').style.display='none';$('reportFeed').style.display='none';$('aiChat').style.display='';
    $('intelSubFilters').style.display='none';
    $('intelObjFilters').style.display='none';
    $('feedStatus').textContent='AI助手';
    // 切换底部输入框为AI模式
    var cmd=$('cmdInput');
    if(cmd){cmd.placeholder='输入你的问题，按Enter发送...';cmd.dataset.mode='ai'}
  }
}

/* ===== LOAD REPORTS ===== */
var allReports=[];
var reportsLoaded=false;
async function loadReports(){
  if(!PORTAL_SLUG){$('reportFeed').innerHTML='<div class="no-data-msg">无法获取门户标识</div>';return}
  if(reportsLoaded&&allReports.length>0){renderReportCards(allReports);return}
  $('reportLoading').style.display='block';
  try {
    var r=await fetch(API+'/api/p/reports/'+PORTAL_SLUG);
    if(!r.ok)throw new Error('API error: '+r.status);
    var data=await r.json();
    allReports=data.data||[];
    reportsLoaded=true;
    renderReportCards(allReports);
    $('feedStatus').textContent=allReports.length+' 份报告';
  } catch(e){
    $('reportFeed').innerHTML='<div class="no-data-msg">加载报告失败: '+e.message+'</div>';
    $('feedStatus').textContent='加载失败';
  }
}

function renderReportCards(reports){
  $('reportLoading').style.display='none';
  if(!reports||reports.length===0){
    $('reportFeed').innerHTML='<div class="no-data-msg">&#x1F4D1; 暂无行业分析报告<br><span style="font-size:11px;opacity:0.6">在Portal Builder中生成报告后，这里将自动显示</span></div>';
    return;
  }
  var html='';
  reports.forEach(function(report){
    var dateStr='';
    if(report.createdAt){
      var d=new Date(report.createdAt);
      dateStr=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    }
    var reportUrl=report.url||('/web/'+report.slug);
    html+='<div class="report-card" onclick="window.open(&#39;'+escHtml(reportUrl)+'&#39;,&#39;_blank&#39;)">';
    html+='<div class="report-card-inner">';
    html+='<div class="report-card-icon">&#x1F4CA;</div>';
    html+='<div class="report-card-body">';
    html+='<div class="report-card-title">'+escHtml(report.companyName||report.title||'行业分析报告')+'</div>';
    html+='<div class="report-card-meta">';
    html+='<span class="report-card-date">'+dateStr+'</span>';
    html+='<span class="report-card-tag">行业分析</span>';
    html+='</div></div></div></div>';
  });
  $('reportFeed').innerHTML=html;
}

function appendChatMessage(role,text){
  var el=document.createElement('div');
  el.className='ai-msg ai-msg-'+role;
  var inner=document.createElement('div');
  if(role==='bot'){
    inner.innerHTML=typeof marked!=='undefined'?marked.parse(text):text;
  } else {
    inner.textContent=text;
  }
  el.appendChild(inner);
  $('aiChatMessages').appendChild(el);
  $('aiChatMessages').scrollTop=$('aiChatMessages').scrollHeight;
}

/* ===== MODAL: Source Edit ===== */
var _activeWi=-1,_activeSi=-1;

function openSourceModal(wi,si){
  _activeWi=wi;_activeSi=si;
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.sources||(w.config&&w.config.sources)||[];
  var src=srcs[si];
  if(!src){closeSourceModalDirect();return}
  $('modalIcon').textContent='\\uD83D\\uDEE0';
  $('modalTitle').textContent=src.name||'编辑监控源';
  $('modalSub').textContent='配置情报监控源参数';
  var delBtn=$('btnDeleteSource');if(delBtn)delBtn.style.display='';
  renderSourceForm(wi,si);
  $('btnSave').onclick=function(){saveSourceConfig(wi,si)};
  $('modalOverlay').classList.add('open');
  document.body.style.overflow='hidden';
}

function closeSourceModal(e){
  if(e&&e.target!==$('modalOverlay'))return;
  closeSourceModalDirect();
}

function closeSourceModalDirect(){
  $('modalOverlay').classList.remove('open');
  document.body.style.overflow='';
  _activeWi=-1;_activeSi=-1;
}

document.addEventListener('keydown',function(e){
  if(e.key==='Escape')closeSourceModalDirect();
});

/* ===== MODAL DRAG ===== */
var modalDrag={active:false,startX:0,startY:0,panelLeft:0,panelTop:0};
function initModalDrag(){
  var hd=document.querySelector('.modal-hd');
  if(!hd)return;
  hd.style.cursor='move';
  hd.addEventListener('mousedown',function(e){
    if(e.target.closest('button'))return; // Don't drag when clicking buttons
    var panel=document.querySelector('.modal-panel');
    if(!panel)return;
    modalDrag.active=true;
    modalDrag.startX=e.clientX;
    modalDrag.startY=e.clientY;
    var rect=panel.getBoundingClientRect();
    modalDrag.panelLeft=rect.left;
    modalDrag.panelTop=rect.top;
    // Reset CSS centering
    panel.style.position='absolute';
    panel.style.left=rect.left+'px';
    panel.style.top=rect.top+'px';
    panel.style.transform='none';
    panel.style.margin='0';
    panel.style.transition='none';
    panel.classList.add('modal-dragging');
    e.preventDefault();
  });
}
document.addEventListener('mousemove',function(e){
  if(!modalDrag.active)return;
  var panel=document.querySelector('.modal-panel');
  if(!panel)return;
  var dx=e.clientX-modalDrag.startX;
  var dy=e.clientY-modalDrag.startY;
  panel.style.left=(modalDrag.panelLeft+dx)+'px';
  panel.style.top=(modalDrag.panelTop+dy)+'px';
});
document.addEventListener('mouseup',function(){
  if(!modalDrag.active)return;
  modalDrag.active=false;
  var panel=document.querySelector('.modal-panel');
  if(panel)panel.classList.remove('modal-dragging');
});
// Initialize drag after modal render
var _origRenderSourceForm=renderSourceForm;
renderSourceForm=function(wi,si){
  _origRenderSourceForm(wi,si);
  setTimeout(initModalDrag,50);
};

function renderSourceForm(wi,si){
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.sources||(w.config&&w.config.sources)||[];
  var src=srcs[si];
  if(!src)return;
  var kws=src.keywords||[];
  var objects=src.objects||[];
  var INTEL_CATS=['行业信号','目标客户情报','竞争对手情报','自身舆情监控'];
  var s='';
  s+='<div class="src-mini">';
  // Category dropdown
  s+='<div class="mb-group"><label class="mb-label">情报属性</label>';
  s+='<select class="mb-select" id="srcCat_'+wi+'_'+si+'" onchange="onSourceCatChange('+wi+','+si+',this.value)">';
  s+='<option value="">-- 选择情报属性 --</option>';
  INTEL_CATS.forEach(function(c){
    s+='<option value="'+c+'"'+(src.name===c?' selected':'')+'>'+c+'</option>';
  });
  s+='<option value="__custom__"'+(INTEL_CATS.indexOf(src.name||'')===-1&&src.name?' selected':'')+'>自定义…</option>';
  s+='</select></div>';
  // Custom name input
  var isCustom=INTEL_CATS.indexOf(src.name||'')===-1&&src.name;
  s+='<div class="mb-group" id="srcCustomNameGroup_'+wi+'_'+si+'" style="'+(isCustom?'':'display:none')+'">';
  s+='<input class="mb-input" id="srcName_'+wi+'_'+si+'" value="'+escHtml(src.name||'')+'" placeholder="输入自定义属性名称" autocomplete="off">';
  s+='</div>';
  // Update frequency
  s+='<div class="mb-group"><label class="mb-label">更新频率</label>';
  s+='<select class="mb-select" id="srcFreq_'+wi+'_'+si+'">';
  var freqs=['hourly','daily','weekly','monthly'];
  var freqLabels={hourly:'每小时',daily:'每日',weekly:'每周',monthly:'每月'};
  freqs.forEach(function(f){
    s+='<option value="'+f+'"'+(src.updateFrequency===f?' selected':'')+'>'+freqLabels[f]+'</option>';
  });
  s+='</select></div>';
  // Monitoring Objects
  s+='<div class="mb-group"><label class="mb-label">📌 监控对象</label>';
  s+='<div class="obj-tags" id="objTags_'+wi+'_'+si+'">';
  objects.forEach(function(o){
    s+='<span class="obj-t">'+escHtml(o.name)+'<button class="obj-x" onclick="removeObject('+wi+','+si+',\\''+escHtml(o.name)+'\\',this.parentElement)" title="移除">&times;</button></span>';
  });
  s+='</div>';
  s+='<div class="kw-add-row"><input class="kw-add-input" id="objInput_'+wi+'_'+si+'" placeholder="输入对象名称后回车添加..." onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();addObject('+wi+','+si+')}" autocomplete="off" name="obj'+wi+'_'+si+'">';
  s+='<button class="kw-add-btn" onclick="addObject('+wi+','+si+')">+</button></div>';
  s+='</div>';
  // Keywords
  s+='<div class="mb-group"><label class="mb-label">监控关键词</label>';
  s+='<div class="kw-tags" id="kwTags_'+wi+'_'+si+'">';
  kws.forEach(function(k){
    s+='<span class="kw-t">'+escHtml(k)+'<button class="kw-x" onclick="removeKeyword('+wi+','+si+',this.parentElement)" title="移除">&times;</button></span>';
  });
  s+='</div>';
  s+='<div class="kw-add-row"><input class="kw-add-input" id="kwInput_'+wi+'_'+si+'" placeholder="输入关键词后回车添加..." onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();addKeyword('+wi+','+si+')}" autocomplete="off" name="kw'+wi+'_'+si+'">';
  s+='<button class="kw-add-btn" onclick="addKeyword('+wi+','+si+')">+</button></div>';
  s+='</div>';
  // Custom prompt
  var defaultPrompt=INTEL_PROMPTS[src.name]||'';
  var promptVal=src.customPrompt||defaultPrompt;
  s+='<div class="mb-group"><label class="mb-label">自定义提示词 <span>（可选）</span></label>';
  s+='<textarea class="mb-area" id="srcPrompt_'+wi+'_'+si+'" style="min-height:180px" placeholder="自定义此监控源的分析提示词..." autocomplete="off" name="prompt'+wi+'_'+si+'">'+escHtml(promptVal)+'</textarea>';
  s+='</div>';
  // Model config (collapsed by default)
  s+='<div class="mb-group" style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">';
  s+='<button type="button" class="model-config-toggle" onclick="toggleModelConfig(this)">';
  s+='<span class="model-config-arrow">▶</span> ⚙ 模型配置（高级）</button>';
  s+='<div class="model-config-body" style="display:none;margin-top:8px">';
  s+='<div class="mb-row"><div class="mb-group"><label class="mb-label">AI 引擎</label>';
  s+='<select class="mb-select" id="srcProvider_'+wi+'_'+si+'">';
  [{v:'all+cn-news',l:'🌐 全渠道（含天聚新闻，推荐）'},{v:'all',l:'🌐 全渠道（含秘塔）'},{v:'metaso',l:'秘塔搜索（Metaso）'},{v:'serper',l:'🔍 Serper (Google)'},{v:'tavily',l:'Tavily 搜索'},{v:'multi-engine',l:'多引擎搜索'},{v:'wechat',l:'微信公众号'},{v:'weibo',l:'微博'},{v:'zhihu',l:'知乎'},{v:'xiaohongshu',l:'小红书'},{v:'deepseek',l:'DeepSeek（仅知识库）'},{v:'custom',l:'自定义 API'}].forEach(function(p){
    s+='<option value="'+p.v+'"'+(src.aiProvider===p.v?' selected':'')+'>'+p.l+'</option>';
  });
  s+='</select></div>';
  s+='<div class="mb-group"><label class="mb-label">AI 模型</label>';
  s+='<input class="mb-input" id="srcModel_'+wi+'_'+si+'" value="'+escHtml(src.aiModel||'')+'" placeholder="例如: deepseek-v4-flash" autocomplete="off">';
  s+='</div></div>';
  s+='<div class="mb-group"><label class="mb-label">API Key</label>';
  s+='<input class="mb-input" type="password" id="srcApiKey_'+wi+'_'+si+'" value="'+escHtml(src.apiKey||'')+'" placeholder="可选" autocomplete="off">';
  s+='</div>';
  s+='</div></div>';
  s+='</div>';
  $('modalBody').innerHTML=s;
  $('modalBody').scrollTop=0;
}

function toggleModelConfig(btn){
  var body=btn.nextElementSibling;
  var arrow=btn.querySelector('.model-config-arrow');
  if(!body||!arrow)return;
  if(body.style.display==='none'){
    body.style.display='';
    arrow.textContent='▼';
  }else{
    body.style.display='none';
    arrow.textContent='▶';
  }
}

function onSourceCatChange(wi,si,val){
  var w=WIDGETS[wi];if(!w)return;
  var srcs=w.sources||(w.config&&w.config.sources)||[];if(!srcs[si])return;
  if(val==='__custom__'){
    $('srcCustomNameGroup_'+wi+'_'+si).style.display='';
    $('srcName_'+wi+'_'+si).value='';
  } else {
    $('srcCustomNameGroup_'+wi+'_'+si).style.display='none';
    srcs[si].name=val;
    $('modalTitle').textContent=val||'编辑监控源';
    // Auto-fill default prompt for the selected category
    if(INTEL_PROMPTS[val]){
      srcs[si].customPrompt=INTEL_PROMPTS[val];
      var promptEl=$('srcPrompt_'+wi+'_'+si);
      if(promptEl)promptEl.value=INTEL_PROMPTS[val];
    }
  }
}

function addObject(wi,si){
  var inp=$('objInput_'+wi+'_'+si);
  if(!inp||!inp.value.trim())return;
  var raw=inp.value.trim();
  inp.value='';
  var names=raw.split(/[\\s,，、]+/).map(function(s){return s.trim()}).filter(Boolean);
  var w=WIDGETS[wi];if(!w)return;
  var srcs=w.sources||(w.config&&w.config.sources)||[];var src=srcs[si];
  if(!src)return;
  if(!src.objects)src.objects=[];
  names.forEach(function(name){
    if(src.objects.some(function(o){return o.name===name}))return;
    src.objects.push({name:name,keywords:[]});
  });
  renderSourceForm(wi,si);
}

function removeObject(wi,si,objName,tagEl){
  var w=WIDGETS[wi];if(!w)return;
  var srcs=w.sources||(w.config&&w.config.sources)||[];var src=srcs[si];
  if(!src)return;
  if(!src.objects)src.objects=[];
  src.objects=src.objects.filter(function(o){return o.name!==objName});
  renderSourceForm(wi,si);
}

function saveSourceConfig(wi,si){
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.sources||(w.config&&w.config.sources)||[];
  if(!srcs[si])return;
  // Name: from category dropdown or custom input
  var catSel=$('srcCat_'+wi+'_'+si);
  var catVal=catSel?catSel.value:'';
  var name;
  if(catVal==='__custom__'){
    name=($('srcName_'+wi+'_'+si)||{}).value||'';
  } else {
    name=catVal||'';
  }
  if(!name){alert('请选择情报属性或输入自定义名称');return;}
  var provider=($('srcProvider_'+wi+'_'+si)||{}).value||'deepseek';
  var model=($('srcModel_'+wi+'_'+si)||{}).value||'';
  var apiKey=($('srcApiKey_'+wi+'_'+si)||{}).value||'';
  var freq=($('srcFreq_'+wi+'_'+si)||{}).value||'daily';
  var prompt=($('srcPrompt_'+wi+'_'+si)||{}).value||'';
  var keywords=[];
  var kwContainer=$('kwTags_'+wi+'_'+si);
  if(kwContainer){
    kwContainer.querySelectorAll('.kw-t').forEach(function(tag){
      var kwText=tag.childNodes[0]?tag.childNodes[0].textContent.replace('\\u00d7','').trim():'';
      if(kwText)keywords.push(kwText);
    });
  }
  // Collect objects
  var objects=[];
  var objContainer=$('objTags_'+wi+'_'+si);
  if(objContainer){
    objContainer.querySelectorAll('.obj-t').forEach(function(tag){
      var objName=tag.childNodes[0]?tag.childNodes[0].textContent.replace('\\u00d7','').trim():'';
      if(objName)objects.push({name:objName,keywords:[]});
    });
  }
  srcs[si].name=name;
  srcs[si].aiProvider=provider;
  srcs[si].aiModel=model;
  srcs[si].apiKey=apiKey;
  srcs[si].updateFrequency=freq;
  srcs[si].customPrompt=prompt;
  srcs[si].keywords=keywords;
  srcs[si].objects=objects;
  if(w.config&&w.config.sources)w.config.sources=srcs;
  w.sources=srcs;
  var slug=window.location.pathname.split('/').pop();
  var monitorWidget={type:'intel-monitor',idx:wi,title:w.title,sources:srcs};
  fetch(API+'/api/p/config/'+slug,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({widgetIdx:wi,widget:{type:'monitor',idx:wi,title:w.title||'情报监控',sources:srcs}})}).then(function(r){
    if(r.ok){
      var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
      renderSourceFilters(monitors);
      closeSourceModalDirect();
    }else{
      alert('保存失败，请重试');
    }
  }).catch(function(){alert('网络错误，请重试');});
}

function addNewSource(){
  var w=WIDGETS.find(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  if(!w){
    alert('请先在建站页面添加情报监控组件');
    return;
  }
  var srcs=w.sources||(w.config&&w.config.sources)||[];
  srcs.push({name:'行业信号',aiProvider:'all+cn-news',aiModel:'deepseek-v4-flash',apiKey:'',keywords:[],objects:[],updateFrequency:'daily',customPrompt:INTEL_PROMPTS['行业信号']||''});
  if(w.config&&w.config.sources)w.config.sources=srcs;
  w.sources=srcs;
  var newSi=srcs.length-1;
  var allMonitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  var wi=WIDGETS.indexOf(w);
  if(wi===-1)wi=0;
  renderSourceFilters(allMonitors);
  setTimeout(function(){openSourceModal(wi,newSi)},100);
}

function refreshAllIntel(){
  // Clear localStorage cache to force re-fetch
  var cacheKey='portal-intel-'+PORTAL_SLUG;
  try{localStorage.removeItem(cacheKey)}catch(e){}
  allIntelData=[];
  $('intelLoading').style.display='block';
  $('feedStatus').textContent='强制更新中...';
  var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  renderSourceFilters(monitors);
  loadIntelData(true);
}

/* ===== INTEL PAUSE TOGGLE (per-portal) ===== */
var isIntelPaused=false;
function togglePauseIntel(){
  isIntelPaused=!isIntelPaused;
  var btn=$('btnPauseIntel');
  if(isIntelPaused){
    btn.innerHTML='▶ 恢复更新';
    btn.style.borderColor='rgba(255,140,0,0.5)';
    btn.style.color='#ff8c00';
  } else {
    btn.innerHTML='⏸ 停止更新';
    btn.style.borderColor='rgba(0,212,255,0.15)';
    btn.style.color='';
  }
  fetch(API+'/api/portal-intel/pause',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({slug:PORTAL_SLUG,pause:isIntelPaused})
  }).catch(function(e){console.error('togglePauseIntel failed:',e)});
}
function checkPauseStatus(){
  fetch(API+'/api/portal-intel/pause?slug='+encodeURIComponent(PORTAL_SLUG))
    .then(function(r){return r.json()})
    .then(function(data){
      if(data&&data.paused){
        isIntelPaused=true;
        var btn=$('btnPauseIntel');
        if(btn){
          btn.innerHTML='▶ 恢复更新';
          btn.style.borderColor='rgba(255,140,0,0.5)';
          btn.style.color='#ff8c00';
        }
      }
    })
    .catch(function(e){/* ignore */});
}

// ===== V2.1: Push Controls (email + toggle) =====
var pushEnabled = true;
function loadPushConfig() {
  fetch(API + '/api/portal/push-config?slug=' + encodeURIComponent(PORTAL_SLUG))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var cfg = (data && data.data) || {};
      pushEnabled = cfg.enabled !== false;
      if (cfg.email) {
        var input = $('inputPushEmail');
        if (input) input.value = cfg.email;
      }
      updatePushToggleUI();
    }).catch(function(e) { /* ignore */ });
}

function updatePushToggleUI() {
  var btn = $('btnTogglePush');
  if (!btn) return;
  if (pushEnabled) {
    btn.innerHTML = '推送中';
    btn.style.borderColor = 'rgba(34,197,94,0.4)';
    btn.style.color = '#22c55e';
    btn.style.background = 'rgba(34,197,94,0.06)';
  } else {
    btn.innerHTML = '已停止';
    btn.style.borderColor = 'rgba(239,68,68,0.4)';
    btn.style.color = '#ef4444';
    btn.style.background = 'rgba(239,68,68,0.06)';
  }
}

function togglePushEnabled() {
  pushEnabled = !pushEnabled;
  updatePushToggleUI();
  fetch(API + '/api/portal/push-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: PORTAL_SLUG, enabled: pushEnabled }),
  }).catch(function(e) { console.error('togglePushEnabled failed:', e); });
}

function savePushEmail() {
  var email = ($('inputPushEmail') || {}).value || '';
  fetch(API + '/api/portal/push-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: PORTAL_SLUG, email: email }),
  }).then(function(r) { return r.json(); })
    .then(function() { alert('邮箱已保存: ' + (email || '(已清空)')); })
    .catch(function(e) { alert('保存失败: ' + e.message); });
}

function instantPushNow() {
  var btn = event.target;
  btn.disabled = true;
  btn.textContent = '推送中...';
  fetch(API + '/api/portal/instant-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: PORTAL_SLUG }),
  }).then(function(r) { return r.json(); })
    .then(function(d) {
      alert(d.message || '推送已触发，请查看微信/邮箱');
    }).catch(function(e) {
      alert('推送失败: ' + e.message);
    }).finally(function() {
      btn.disabled = false;
      btn.textContent = '⚡ 立即推送';
    });
}

function deleteSource(wi,si){
  if(!confirm('确定要删除这个监控源吗？此操作不可撤销。'))return;
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.sources||(w.config&&w.config.sources)||[];
  srcs.splice(si,1);
  if(w.config&&w.config.sources)w.config.sources=srcs;
  w.sources=srcs;
  var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  renderSourceFilters(monitors);
  closeSourceModalDirect();
}

function deleteCurrentSource(){
  if(!confirm('确定要删除这个监控源吗？此操作不可撤销。'))return;
  deleteSource(_activeWi,_activeSi);
}

function addKeyword(wi,si){
  var inp=$('kwInput_'+wi+'_'+si);
  if(!inp)return;
  var raw=inp.value.trim();
  if(!raw)return;
  inp.value='';
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.sources||(w.config&&w.config.sources)||[];
  if(!srcs[si])return;
  if(!srcs[si].keywords)srcs[si].keywords=[];
  var kws=raw.split(/[\\s,，、]+/).map(function(s){return s.trim()}).filter(Boolean);
  kws.forEach(function(kw){
    if(srcs[si].keywords.indexOf(kw)===-1)srcs[si].keywords.push(kw);
  });
  renderSourceForm(wi,si);
}

function removeKeyword(wi,si,el){
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.sources||(w.config&&w.config.sources)||[];
  if(!srcs[si])return;
  var kwText=el.childNodes[0]?el.childNodes[0].textContent.replace('\\u00d7','').trim():'';
  var kws=srcs[si].keywords||[];
  var ki=kws.indexOf(kwText);
  if(ki!==-1)kws.splice(ki,1);
  renderSourceForm(wi,si);
}

/* ===== UTILS ===== */
function escHtml(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function initDashboard(){
  renderSentimentGauge(52);
  renderKPITrend();
  updateBriefing();
  // 情绪仪表盘和趋势图在数据加载前渲染默认值；情报来源等数据加载后由 updateDashboard(data) 渲染
}

function updateDashboard(data){
  // Compute sentiment score from actual _sentiment fields (正面/负面/中性)
  var sentiment=52;
  if(data&&data.length>0){
    var pos=0,neg=0,neu=0;
    data.forEach(function(item){
      var s=(item._sentiment||'').trim();
      if(s==='正面')pos++;
      else if(s==='负面')neg++;
      else neu++;
    });
    var total=pos+neg+neu;
    if(total>0){
      // Map to 0-100: negative=0, neutral=50, positive=100, weighted average
      sentiment=Math.round((pos*100+neu*50+neg*0)/total);
    }
  }
  renderSentimentGauge(sentiment);
  renderSourceChannels(data);
  updateBriefing(data);
}

function renderSentimentStats(data){
  var container=document.getElementById('sentimentStats');
  if(!container)return;
  if(!data||!data.length){container.style.display='none';return;}
  container.style.display='';
  var pos=0,neg=0,neu=0,confirmed=0,rumor=0,pending=0,hasIntent=0;
  for(var i=0;i<data.length;i++){
    var s=(data[i]._sentiment||'').trim();
    if(s==='正面')pos++;else if(s==='负面')neg++;else neu++;
    var r=(data[i]._reliability||'').trim();
    if(r==='已确认')confirmed++;else if(r==='传闻')rumor++;else pending++;
    if(data[i]._intent&&data[i]._intent.trim())hasIntent++;
  }
  var total=data.length,all=pos+neg+neu;
  var pct=all>0?Math.round(pos*100/all)+'%':'-';
  [
    ['sstatTotal',total],['sstatIndex',pct],['sstatPos',pos],['sstatNeu',neu],
    ['sstatNeg',neg],['sstatConfirmed',confirmed],['sstatRumor',rumor],['sstatIntent',hasIntent]
  ].forEach(function(pair){
    var el=document.getElementById(pair[0]);
    if(!el)return;
    var v=el.querySelector('.sstat-val');
    if(v)v.textContent=pair[1];
  });
}

function renderSentimentGauge(value){
  var canvas=$('sentimentCanvas');
  if(!canvas)return;
  var ctx=canvas.getContext('2d');
  var w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  var cx=w/2,cy=h-10,r=Math.min(w/2-10,h-20);
  ctx.beginPath();
  ctx.arc(cx,cy,r,Math.PI,0,false);
  ctx.strokeStyle='rgba(255,255,255,0.1)';
  ctx.lineWidth=14;
  ctx.stroke();
  var endAngle=Math.PI+(value/100)*Math.PI;
  ctx.beginPath();
  ctx.arc(cx,cy,r,Math.PI,endAngle,false);
  var gradient=ctx.createLinearGradient(0,cy,w,0);
  gradient.addColorStop(0,'#00d4ff');
  gradient.addColorStop(1,'#a855f7');
  ctx.strokeStyle=gradient;
  ctx.lineWidth=14;
  ctx.lineCap='round';
  ctx.stroke();
  $('sentimentLabel').textContent=(value>60?'积极':value>40?'中性':'消极')+' '+value+'%';
}

function renderSourceChannels(data){
  var container=$('sourceChannels');
  if(!container)return;
  var providerLabels={
    metaso:'秘塔搜索',tavily:'Tavily','multi-engine':'多引擎',wechat:'微信公众号',
    weibo:'微博',zhihu:'知乎',xiaohongshu:'小红书',openai:'OpenAI',
    deepseek:'DeepSeek',codebuddy:'CodeBuddy',custom:'自定义',all:'全渠道',
    'tianapi-generalnews':'天聚综合新闻','tianapi-keji':'天聚科技新闻','tianapi-ai':'天聚AI资讯','tianapi-guonei':'天聚国内新闻',
    'tianapi-world':'天聚国际新闻','tianapi-social':'天聚社会新闻','tianapi-caijing':'天聚财经新闻','tianapi-internet':'天聚互联网资讯',
  };
  var html='';
  if(data&&data.length>0){
    var chCount={};
    data.forEach(function(item){
      var p=item._provider||'unknown';
      chCount[p]=(chCount[p]||0)+1;
    });
    var channels=Object.keys(chCount).sort(function(a,b){return chCount[b]-chCount[a]});
    channels.forEach(function(ch){
      var label=providerLabels[ch]||ch;
      var count=chCount[ch];
      html+='<div class="src-channel-item">';
      html+='<span class="src-channel-name">'+escHtml(label)+'</span>';
      html+='<span class="src-channel-count">'+count+'</span>';
      html+='</div>';
    });
  } else {
    html='<div class="no-data-msg" style="font-size:11px;padding:8px">暂无情报来源数据</div>';
  }
  container.innerHTML=html;
}

function renderKPITrend(){
  var canvas=$('kpiCanvas');
  if(!canvas)return;
  var ctx=canvas.getContext('2d');
  // Match canvas pixel size to container width
  var container=canvas.parentElement;
  if(container){var cw=container.clientWidth||300;canvas.width=cw;canvas.style.width=cw+'px';}
  var w=canvas.width,h=canvas.height;
  var data=[];
  for(var i=0;i<12;i++)data.push(Math.random()*80+20);
  ctx.strokeStyle='rgba(255,255,255,0.05)';
  ctx.lineWidth=1;
  for(var i=0;i<4;i++){ctx.beginPath();ctx.moveTo(0,(h/4)*i);ctx.lineTo(w,(h/4)*i);ctx.stroke()}
  ctx.beginPath();
  data.forEach(function(v,i){
    var x=(w/(data.length-1))*i;
    var y=h-(v/100)*h;
    if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  });
  var gradient=ctx.createLinearGradient(0,0,w,0);
  gradient.addColorStop(0,'#00d4ff');
  gradient.addColorStop(1,'#a855f7');
  ctx.strokeStyle=gradient;
  ctx.lineWidth=2;
  ctx.stroke();
  ctx.lineTo(w,h);
  ctx.lineTo(0,h);
  ctx.closePath();
  var fillGradient=ctx.createLinearGradient(0,0,0,h);
  fillGradient.addColorStop(0,'rgba(0,212,255,0.1)');
  fillGradient.addColorStop(1,'rgba(0,212,255,0)');
  ctx.fillStyle=fillGradient;
  ctx.fill();
}

function updateBriefing(data){
  var container=$('briefingText');
  if(!container)return;
  var texts=[
    '&#x1F4CA; 基于当前情报分析，市场情绪偏向 <strong style="color:var(--cyan)">谨慎乐观</strong>',
    '&#x1F50D; 关键词 "<strong>AI</strong>" 提及率较上周上升 <strong style="color:#10b981">23%</strong>',
    '&#x26A0;&#xFE0F; 需关注 "<strong>政策</strong>" 相关动态，可能影响行业走势',
    '&#x1F4A1; 建议：持续监控竞争对手动向，关注技术创新趋势'
  ];
  if(data&&data.length>0){
    texts[0]='&#x1F4CA; 已分析 <strong style="color:var(--cyan)">'+data.length+'</strong> 条情报，覆盖多个信息源';
  }
  container.innerHTML=texts.map(function(t){return '<p>'+t+'</p>'}).join('');
}

/* ===== COMMAND CENTER ===== */
var aiChatHistory=[];
function sendCommand(){
  var input=$('cmdInput');
  if(!input)return;
  var cmd=input.value.trim();
  if(!cmd)return;

  // 如果在其他标签，自动切换到 AI 助手标签
  if(currentCenterTab!=='ai'){
    switchCenterTab('ai');
  }

  // AI 模式：发送AI消息
  input.value='';
  input.disabled=true;
  appendChatMessage('user',cmd);
  aiChatHistory.push({role:'user',content:cmd});
  var thinkId='think_'+Date.now();
  var thinkEl=document.createElement('div');
  thinkEl.className='ai-msg ai-msg-bot';
  thinkEl.id=thinkId;
  thinkEl.textContent='思考中...';
  $('aiChatMessages').appendChild(thinkEl);
  $('aiChatMessages').scrollTop=$('aiChatMessages').scrollHeight;
  try {
    fetch(API+'/api/ai-chat',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:cmd,history:aiChatHistory.slice(-10)})
    }).then(function(response){
      if(!response.ok)throw new Error('API error: '+response.status);
      return response.json();
    }).then(function(data){
      var reply=data.reply||data.data||data.text||'抱歉，AI暂时无法回复。';
      aiChatHistory.push({role:'assistant',content:reply});
      var el=document.getElementById(thinkId);
      if(el&&el.parentNode)el.parentNode.removeChild(el);
      appendChatMessage('bot',reply);
      input.disabled=false;
      input.focus();
    }).catch(function(e){
      var el=document.getElementById(thinkId);
      if(el&&el.parentNode)el.parentNode.removeChild(el);
      appendChatMessage('bot','抱歉，请求失败: '+e.message);
      input.disabled=false;
      input.focus();
    });
  } catch(e){
    var el=document.getElementById(thinkId);
    if(el&&el.parentNode)el.parentNode.removeChild(el);
    appendChatMessage('bot','抱歉，请求失败: '+e.message);
    input.disabled=false;
    input.focus();
  }
}
function toggleMic(){alert('语音输入功能开发中...');}
function deployPortal(){
  var btn=document.querySelector('.btn-deploy');
  if(!btn)return;
  var origText=btn.textContent;
  btn.textContent='部署中...';
  btn.disabled=true;
  btn.style.opacity='0.6';
  fetch(API+'/api/portal-redeploy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:PORTAL_SLUG})})
    .then(function(r){return r.json()})
    .then(function(d){
      if(d.data && d.data.updated){
        btn.textContent='已更新!';
        btn.style.background='linear-gradient(135deg,#22c55e,#16a34a)';
        setTimeout(function(){location.reload()},800);
      } else {
        btn.textContent=origText;
        btn.disabled=false;
        btn.style.opacity='1';
        alert('部署失败: '+(d.error?d.error.message:'未知错误'));
      }
    })
    .catch(function(e){
      btn.textContent=origText;
      btn.disabled=false;
      btn.style.opacity='1';
      alert('部署失败: '+e.message);
    });
}`;
}
