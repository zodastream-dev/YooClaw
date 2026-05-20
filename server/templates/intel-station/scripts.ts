// server/templates/intel-station/scripts.ts
// Client-side JavaScript for IntelStation portal template

export function intelStationScripts(apiBase: string, slug: string, wlistJson: string): string {
  return `
var API='${apiBase}';
var DEFAULT_DEEPSEEK_KEY='${process.env.DEEPSEEK_API_KEY || ""}';
var DEFAULT_METASO_KEY='${process.env.METASO_API_KEY || ""}';
var WIDGETS=${wlistJson};
var PORTAL_SLUG='${slug.replace(/'/g, "\\'")}';
var currentSourceFilters=['全部'];
var allIntelData=[];
var currentFilter='all';
var aiChatHistory=[];
var currentCenterTab='intel';

function $(id){return document.getElementById(id)}

/* ===== INIT ===== */
(function(){
  setTimeout(function(){loadIntelData()},500);
  setTimeout(function(){initDashboard()},300);
})();

/* ===== LOAD INTEL DATA ===== */
async function loadIntelData(){
  var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  if(monitors.length===0){
    $('intelLoading').innerHTML='<p style="color:var(--text-secondary)">暂无监控源配置</p>';
    return;
  }
  $('intelLoading').style.display='block';
  $('feedStatus').textContent='获取情报中...';
  // Check localStorage cache first (30min TTL matches backend)
  var cacheKey='portal-intel-'+PORTAL_SLUG;
  var cachedData=null;
  try{
    var cachedRaw=localStorage.getItem(cacheKey);
    if(cachedRaw){
      cachedData=JSON.parse(cachedRaw);
      if(cachedData&&cachedData.expiry>Date.now()){
        allIntelData=cachedData.data||[];
        renderSourceFilters(monitors);
        buildIntelSubFilters(monitors);
        renderIntelFeed(allIntelData);
        updateDashboard(allIntelData);
        $('feedStatus').textContent='已加载 '+allIntelData.length+' 条情报（缓存，后台更新中...）';
        $('intelLoading').style.display='none';
        console.log('[loadIntelData] Loaded '+allIntelData.length+' items from localStorage cache');
      } else {cachedData=null;}
    }
  }catch(e){cachedData=null;}
  try {
    var sources=[];
    monitors.forEach(function(mw){
      (mw.config&&mw.config.sources||mw.sources||[]).forEach(function(src){sources.push(src)});
    });
    if(sources.length===0){
      if(!cachedData) $('intelLoading').innerHTML='<p style="color:var(--text-secondary)">暂无监控源</p>';
      return;
    }
    sources.forEach(function(src){
      if(!src.apiKey)src.apiKey=src.aiProvider==='metaso'?DEFAULT_METASO_KEY:DEFAULT_DEEPSEEK_KEY;
    });
    var result=await fetch(API+'/api/portal-intel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sources:sources})});
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
    $('feedStatus').textContent='已加载 '+allIntelData.length+' 条情报';
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

/* ===== RENDER SOURCE FILTERS ===== */
function renderSourceFilters(monitors){
  var widgetSources=[];
  monitors.forEach(function(mw,monitorIdx){
    var wi=WIDGETS.indexOf(mw);if(wi===-1)wi=monitorIdx;
    var srcs=mw.config&&mw.config.sources||mw.sources||[];
    srcs.forEach(function(src,si){widgetSources.push({widgetIndex:wi,sourceIndex:si,source:src})});
  });
  if(widgetSources.length===0){
    $('sourceGroups').innerHTML='<div style="text-align:center;padding:24px;color:var(--text-secondary);font-size:12px">暂无监控源<br><br><button class="add-source-btn" onclick="addNewSource()">+ 添加第一个监控源</button></div>';
    return;
  }
  var html='';
  widgetSources.forEach(function(ws){
    var src=ws.source;
    var providerLabel=src.aiProvider||'deepseek';
    var kws=(src.keywords||[]);
    var freqLabel={hourly:'每小时',daily:'每日',weekly:'每周',monthly:'每月'}[src.updateFrequency]||'每日';
    html+='<div class="source-card" onclick="openSourceModal('+ws.widgetIndex+','+ws.sourceIndex+')" title="点击编辑此监控源">';
    html+='<div class="sc-icon">&#x1F6F0;</div>';
    html+='<div class="sc-body">';
    html+='<div class="sc-name">'+escHtml(src.name||'未命名')+'</div>';
    html+='<div class="sc-meta">';
    html+='<span class="sc-provider'+(providerLabel==='metaso'?' metaso':'')+'">'+escHtml(providerLabel)+'</span>';
    html+='<span class="sc-kwcount">'+kws.length+' 关键词</span>';
    html+='<span class="sc-freq">'+freqLabel+'</span>';
    html+='</div></div>';
    html+='<div class="sc-edit">&#x270E;</div>';
    html+='</div>';
  });
  html+='<button class="add-source-btn" onclick="addNewSource()">+ 添加监控源</button>';
  $('sourceGroups').innerHTML=html;
}

/* ===== RENDER INTEL FEED ===== */
function renderIntelFeed(data){
  console.log('[renderIntelFeed] called with data.length=', data.length, 'first _sourceName=', data.length>0?data[0]._sourceName:'N/A');
  if(data.length===0){$('intelFeed').innerHTML='<div class="intel-loading">暂无情报数据</div>';return}
  var html='';
  data.forEach(function(item,i){
    var keywords=(item.keywords||[]).slice(0,3);
    var url=item.url||item.link||item.sourceUrl||item.href||'';
    var clickAttr=url?' data-url="'+escHtml(url)+'" onclick="if(this.dataset.url)window.open(this.dataset.url,&#39;_blank&#39;)"':'';
    html+='<div class="intel-card"'+clickAttr+'>';
    html+='<div class="intel-card-header">';
    if(url){
      html+='<span class="intel-card-title" style="color:var(--cyan);cursor:pointer">'+(item.title||'无标题')+'</span>';
    } else {
      html+='<span class="intel-card-title" style="cursor:default">'+(item.title||'无标题')+'</span>';
    }
    html+='<div class="intel-card-source">'+(item.source||'未知来源')+'</div>';
    html+='</div>';
    if(item.summary)html+='<div class="intel-card-summary">'+(item.summary||'')+'</div>';
    html+='<div class="intel-card-footer">';
    html+='<div class="intel-card-tags">';
    keywords.forEach(function(kw){html+='<span class="intel-tag">'+escHtml(kw)+'</span>'});
    html+='</div>';
    html+='<div class="intel-card-time">'+(item.date||'刚刚')+'</div>';
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
    (mw.config&&mw.config.sources||mw.sources||[]).forEach(function(src){
      var name=(src.name||'未命名').trim();
      if(sourceNames.indexOf(name)===-1)sourceNames.push(name);
    });
  });
  var el=$('intelSubFilters');
  if(!el)return;
  if(sourceNames.length<=1){el.style.display='none';return}
  var html='';
  sourceNames.forEach(function(name,i){
    html+='<button class="subfilter-btn'+(i===0?' active':'')+'" data-source="'+escHtml(name)+'" onclick="filterBySourceFromBtn(this)">'+escHtml(name)+'</button>';
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
  if(sourceName==='全部'){
    currentSourceFilters=['全部'];
  } else {
    var allIdx=currentSourceFilters.indexOf('全部');
    if(allIdx >= 0)currentSourceFilters.splice(allIdx,1);
    var idx=currentSourceFilters.indexOf(sourceName);
    if(idx >= 0){
      currentSourceFilters.splice(idx,1);
    }else{
      currentSourceFilters.push(sourceName);
    }
  }
  // Sync UI: set 'active' class based on currentSourceFilters
  document.querySelectorAll('.subfilter-btn').forEach(function(b){
    var sn=(b.getAttribute('data-source')||'').trim();
    if(!sn)return;
    if(currentSourceFilters.indexOf(sn)>=0)b.classList.add('active');
    else b.classList.remove('active');
  });
  console.log('[filterBySource] after sync, currentSourceFilters=', JSON.stringify(currentSourceFilters));
  if(currentSourceFilters.length===0||currentSourceFilters[0]==='全部'){
    renderIntelFeed(allIntelData);
    return;
  }
  var filtered=allIntelData.filter(function(item){
    return currentSourceFilters.indexOf((item._sourceName||'').trim()) >= 0;
  });
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
    $('feedStatus').textContent=allIntelData.length?'已加载 '+allIntelData.length+' 条情报':'加载中...';
    // 恢复底部输入框为普通模式
    var cmd=$('cmdInput');
    if(cmd){cmd.placeholder='请在这里提问或给我指令';cmd.dataset.mode='command'}
  } else if(tab==='reports'){
    tabs[1].classList.add('active');
    $('intelFeed').style.display='none';$('reportFeed').style.display='';$('aiChat').style.display='none';
    $('intelSubFilters').style.display='none';
    $('feedStatus').textContent='报告中';
    var cmd=$('cmdInput');
    if(cmd){cmd.placeholder='请在这里提问或给我指令';cmd.dataset.mode='command'}
    loadReports();
  } else if(tab==='ai'){
    tabs[2].classList.add('active');
    $('intelFeed').style.display='none';$('reportFeed').style.display='none';$('aiChat').style.display='';
    $('intelSubFilters').style.display='none';
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
  var srcs=w.config&&w.config.sources||w.sources||[];
  var src=srcs[si];
  if(!src){closeSourceModalDirect();return}
  $('modalIcon').textContent='\\uD83D\\uDEE0';
  $('modalTitle').textContent=src.name||'编辑监控源';
  $('modalSub').textContent='配置情报监控源参数';
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

function renderSourceForm(wi,si){
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.config&&w.config.sources||w.sources||[];
  var src=srcs[si];
  if(!src)return;
  var kws=src.keywords||[];
  var s='';
  s+='<div class="src-mini">';
  s+='<div class="src-top"><input class="st-name-input" id="srcName_'+wi+'_'+si+'" value="'+escHtml(src.name||'')+'" placeholder="监控源名称">';
  s+='<span class="src-del" onclick="deleteSource('+wi+','+si+')" title="删除此监控源">\\u2715 删除</span></div>';
  s+='<div class="mb-row"><div class="mb-group"><label class="mb-label">AI 引擎</label>';
  s+='<select class="mb-select" id="srcProvider_'+wi+'_'+si+'">';
  ['deepseek','metaso','codebuddy','custom'].forEach(function(p){
    s+='<option value="'+p+'"'+(src.aiProvider===p?' selected':'')+'>'+p+'</option>';
  });
  s+='</select></div>';
  s+='<div class="mb-group"><label class="mb-label">AI 模型</label>';
  s+='<input class="mb-input" id="srcModel_'+wi+'_'+si+'" value="'+escHtml(src.aiModel||'')+'" placeholder="例如: deepseek-v3.1">';
  s+='</div></div>';
  s+='<div class="mb-row"><div class="mb-group"><label class="mb-label">API Key</label>';
  s+='<input class="mb-input" type="password" id="srcApiKey_'+wi+'_'+si+'" value="'+escHtml(src.apiKey||'')+'" placeholder="可选">';
  s+='</div><div class="mb-group"><label class="mb-label">更新频率</label>';
  s+='<select class="mb-select" id="srcFreq_'+wi+'_'+si+'">';
  var freqs=['hourly','daily','weekly','monthly'];
  var freqLabels={hourly:'每小时',daily:'每日',weekly:'每周',monthly:'每月'};
  freqs.forEach(function(f){
    s+='<option value="'+f+'"'+(src.updateFrequency===f?' selected':'')+'>'+freqLabels[f]+'</option>';
  });
  s+='</select></div></div>';
  s+='<div class="mb-group"><label class="mb-label">监控关键词</label>';
  s+='<div class="kw-tags" id="kwTags_'+wi+'_'+si+'">';
  kws.forEach(function(k){
    s+='<span class="kw-t">'+escHtml(k)+'<button class="kw-x" onclick="removeKeyword('+wi+','+si+',this.parentElement)" title="移除">&times;</button></span>';
  });
  s+='</div>';
  s+='<div class="kw-add-row"><input class="kw-add-input" id="kwInput_'+wi+'_'+si+'" placeholder="输入关键词后回车添加..." onkeydown="if(event.key===\\\\'Enter\\\\'){event.preventDefault();addKeyword('+wi+','+si+')}">';
  s+='<button class="kw-add-btn" onclick="addKeyword('+wi+','+si+')">+</button></div>';
  s+='</div>';
  s+='<div class="mb-group"><label class="mb-label">自定义提示词 <span>（可选）</span></label>';
  s+='<textarea class="mb-area" id="srcPrompt_'+wi+'_'+si+'" style="min-height:80px" placeholder="自定义此监控源的分析提示词...">'+escHtml(src.customPrompt||'')+'</textarea>';
  s+='</div>';
  s+='</div>';
  $('modalBody').innerHTML=s;
  $('modalBody').scrollTop=0;
}

function saveSourceConfig(wi,si){
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.config&&w.config.sources||w.sources||[];
  if(!srcs[si])return;
  var name=($('srcName_'+wi+'_'+si)||{}).value||'';
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
  srcs[si].name=name;
  srcs[si].aiProvider=provider;
  srcs[si].aiModel=model;
  srcs[si].apiKey=apiKey;
  srcs[si].updateFrequency=freq;
  srcs[si].customPrompt=prompt;
  srcs[si].keywords=keywords;
  if(w.config&&w.config.sources)w.config.sources=srcs;
  else w.sources=srcs;
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
  var srcs=w.config&&w.config.sources||w.sources||[];
  srcs.push({name:'新监控源',aiProvider:'deepseek',aiModel:'',apiKey:'',keywords:[],updateFrequency:'daily',customPrompt:''});
  if(w.config&&w.config.sources)w.config.sources=srcs;
  else w.sources=srcs;
  var newSi=srcs.length-1;
  var allMonitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  var wi=WIDGETS.indexOf(w);
  if(wi===-1)wi=0;
  renderSourceFilters(allMonitors);
  setTimeout(function(){openSourceModal(wi,newSi)},100);
}

function deleteSource(wi,si){
  if(!confirm('确定要删除这个监控源吗？此操作不可撤销。'))return;
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.config&&w.config.sources||w.sources||[];
  srcs.splice(si,1);
  if(w.config&&w.config.sources)w.config.sources=srcs;
  else w.sources=srcs;
  var monitors=WIDGETS.filter(function(w){return w.type==='intel-monitor'||w.type==='monitor'});
  renderSourceFilters(monitors);
  closeSourceModalDirect();
}

function addKeyword(wi,si){
  var inp=$('kwInput_'+wi+'_'+si);
  if(!inp)return;
  var kw=inp.value.trim();
  if(!kw)return;
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.config&&w.config.sources||w.sources||[];
  if(!srcs[si])return;
  if(!srcs[si].keywords)srcs[si].keywords=[];
  if(srcs[si].keywords.indexOf(kw)===-1)srcs[si].keywords.push(kw);
  renderSourceForm(wi,si);
}

function removeKeyword(wi,si,el){
  var w=WIDGETS[wi];
  if(!w)return;
  var srcs=w.config&&w.config.sources||w.sources||[];
  if(!srcs[si])return;
  var kwText=el.childNodes[0]?el.childNodes[0].textContent.replace('\\u00d7','').trim():'';
  var kws=srcs[si].keywords||[];
  var ki=kws.indexOf(kwText);
  if(ki!==-1)kws.splice(ki,1);
  renderSourceForm(wi,si);
}

/* ===== UTILS ===== */
function escHtml(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function initDashboard(){
  renderSentimentGauge(52);
  renderKPITrend();
  updateBriefing();
  // 关键词云等数据加载后由 updateDashboard(data) 渲染，此处不填充默认词
}

function updateDashboard(data){
  var sentiment=Math.floor(Math.random()*40+40);
  renderSentimentGauge(sentiment);
  renderKeywordCloud(data);
  updateBriefing(data);
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

function renderKeywordCloud(data){
  var container=$('keywordCloud');
  if(!container)return;
  var keywords=['AI','芯片','新能源','股价','财报','市场份额','技术创新','政策支持','竞争','风险'];
  if(data&&data.length>0){
    var kwCount={};
    data.forEach(function(item){(item.keywords||[]).forEach(function(kw){kwCount[kw]=(kwCount[kw]||0)+1})});
    keywords=Object.keys(kwCount).sort(function(a,b){return kwCount[b]-kwCount[a]}).slice(0,10);
  }
  var html='';
  keywords.forEach(function(kw,i){
    var cls=i<3?' important':'';
    html+='<span class="kw-cloud-item'+cls+'">'+escHtml(kw)+'</span>';
  });
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
function deployPortal(){alert('部署功能开发中...');}`;
}
