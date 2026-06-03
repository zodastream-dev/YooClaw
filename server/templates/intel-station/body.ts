// server/templates/intel-station/body.ts
// HTML body template for IntelStation portal

export function intelStationBody(sn: string): string {
  return `
<!-- ===== TOP BAR ===== -->
<div class="top-bar">
  <div class="top-logo">
    <div class="logo-icon">&#x1F680;</div>
    <span>${sn}</span>
  </div>
  <div class="top-status">
    <div class="status-dot"></div>
    <span class="status-text">实时监控中</span>
  </div>
  <div class="top-actions">
    <button class="btn-deploy" onclick="deployPortal()">部署更新</button>
  </div>
</div>

<!-- ===== MAIN LAYOUT ===== -->
<div class="main-layout">
  <!-- Left Column - Filter -->
  <div class="left-col">
    <div class="left-header">
      <h3>&#x1F6F0; 监控源</h3>
      <button class="btn-toggle-left" onclick="toggleLeftPanel()" title="收起面板">&#x25C0;</button>
    </div>
    <div class="source-groups" id="sourceGroups">
      <!-- Dynamic content -->
    </div>
  </div>

  <!-- Center Column - Intel Feed -->
  <div class="center-col">
    <div class="center-header">
      <div class="center-tabs" id="centerTabs">
        <span class="ct-tab active" onclick="switchCenterTab('intel')">&#x1F4CA; 动态情报流</span>
        <span class="ct-tab" onclick="switchCenterTab('reports')">&#x1F4C8; 行业分析报告</span>
        <span class="ct-tab" onclick="switchCenterTab('ai')">&#x1F916; AI助手</span>
      </div>
      <span class="status-text" id="feedStatus">加载中...</span>
      <span class="update-info" id="updateInfo" style="display:none"></span>
      <button class="btn-refresh-intel" id="btnRefreshIntel" onclick="refreshAllIntel()" title="立即更新所有情报">🔄 立即更新</button>
    </div>
    <!-- Tech Stats Bar -->
    <div class="intel-subfilters" id="intelSubFilters" style="display:none"></div>
    <div class="intel-objfilters" id="intelObjFilters" style="display:none"></div>
    <div class="intel-loading" id="intelLoading">
      <div class="spinner"></div>正在获取情报数据...
    </div>
    <div class="intel-feed" id="intelFeed"></div>
    <div class="report-feed" id="reportFeed" style="display:none">
      <div class="intel-loading" id="reportLoading">
        <div class="spinner"></div>加载报告中...
      </div>
    </div>
    <div class="ai-chat" id="aiChat" style="display:none">
      <div class="ai-chat-messages" id="aiChatMessages">
        <div class="ai-msg ai-msg-bot">&#x1F44B; 你好！我是AI助手，可以帮你分析行业趋势、解读情报数据、回答相关问题。请随时向我提问。</div>
      </div>
    </div>
  </div>

  <!-- Right Column - Dashboard -->
  <div class="right-col">
    <div class="right-header">
      <h3>&#x1F9E0; AI 摘要看板</h3>
    </div>
    <div class="dashboard-content" id="dashboardContent">
      <!-- Sentiment Gauge -->
      <div class="dashboard-section">
        <h4>&#x1F4C8; 情绪分析</h4>
        <div class="sentiment-gauge">
          <canvas id="sentimentCanvas" width="260" height="130"></canvas>
          <div class="sentiment-label" id="sentimentLabel">中性 52%</div>
<div class="sentiment-stats" id="sentimentStats">          <div class="sstat-row" id="sstatTotal">            <div class="sstat-cell sstat-total" id="sstatTotal"><span class="sstat-val">0</span><span class="sstat-lbl">情报总数</span></div>            <div class="sstat-cell sstat-index" id="sstatIndex"><span class="sstat-val">-</span><span class="sstat-lbl">情绪指数</span></div>          </div>          <div class="sstat-row">            <div class="sstat-cell sstat-pos" id="sstatPos"><span class="sstat-val">0</span><span class="sstat-lbl">正面</span></div>            <div class="sstat-cell sstat-neu" id="sstatNeu"><span class="sstat-val">0</span><span class="sstat-lbl">中性</span></div>          </div>          <div class="sstat-row">            <div class="sstat-cell sstat-neg" id="sstatNeg"><span class="sstat-val">0</span><span class="sstat-lbl">负面</span></div>            <div class="sstat-cell sstat-confirmed" id="sstatConfirmed"><span class="sstat-val">0</span><span class="sstat-lbl">已确认</span></div>          </div>          <div class="sstat-row" id="sstatRumorRow">            <div class="sstat-cell sstat-rumor" id="sstatRumor"><span class="sstat-val">0</span><span class="sstat-lbl">传闻</span></div>            <div class="sstat-cell sstat-intent" id="sstatIntent" id="sstatIntentCell"><span class="sstat-val">0</span><span class="sstat-lbl">竞对意图</span></div>          </div>        </div>
        </div>
      </div>
      <!-- Source Channel Distribution -->
      <div class="dashboard-section">
        <h4>&#x1F4E1; 情报来源</h4>
        <div class="source-channels" id="sourceChannels">
          <!-- Dynamic source channels -->
        </div>
      </div>
      <!-- KPI Trend -->
      <div class="dashboard-section">
        <h4>&#x1F4C9; 关注度趋势</h4>
        <div class="kpi-trend">
          <canvas id="kpiCanvas" width="300" height="100"></canvas>
        </div>
      </div>
      <!-- AI Briefing -->
      <div class="dashboard-section">
        <h4>&#x1F916; AI 简报</h4>
        <div class="ai-briefing" id="aiBriefing">
          <div class="ai-briefing-header">
            <div class="ai-icon">&#x1F9E0;</div>
            <div class="ai-title">智能摘要</div>
          </div>
          <div class="briefing-text" id="briefingText">
            <p>正在分析情报数据...</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== BOTTOM BAR - AI Command Center ===== -->
  <div class="bottom-bar">
    <div class="cmd-outer">
      <div class="cmd-wrapper">
        <input class="cmd-input" id="cmdInput" placeholder="请在这里提问或给我指令" onkeydown="if(event.key==='Enter'){event.preventDefault();sendCommand()}">
        <button class="cmd-btn mic" onclick="toggleMic()">&#x1F399;</button>
        <button class="cmd-btn send" onclick="sendCommand()">&#x27A4;</button>
      </div>
    </div>
    <div class="cmd-hint">你可以问AI：给我总结一下今天所有的最新情报</div>
  </div>
</div>

<!-- ===== SITE FOOTER ===== -->
<div class="site-footer">
  <span>上海聚核信息技术有限公司 ICP备案/许可证号：<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">沪ICP备13025394号</a></span>
</div>

<!-- Floating toggle when left panel is collapsed -->
<button class="btn-toggle-left-float" onclick="toggleLeftPanel()" title="展开面板">&#x25B6;</button>

<!-- ===== MODAL ===== -->
<div class="modal-overlay" id="modalOverlay" onclick="closeSourceModal(event)">
  <div class="modal-bg"></div>
  <div class="modal-panel" id="modalPanel" onclick="event.stopPropagation()">
    <div class="modal-hd">
      <div class="mh-icon" id="modalIcon">&#x1F6F0;</div>
      <div class="mh-info">
        <div class="mh-title" id="modalTitle">编辑监控源</div>
        <div class="mh-sub" id="modalSub">修改情报监控源配置</div>
      </div>
      <button class="modal-delete" id="btnDeleteSource" onclick="deleteCurrentSource()" title="删除此情报源" style="display:none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
      <button class="modal-close" onclick="closeSourceModalDirect()">&times;</button>
    </div>
    <div class="modal-bd" id="modalBody"></div>
    <div class="modal-ft" id="modalFooter">
      <button class="btn-cancel" onclick="closeSourceModalDirect()">取消</button>
      <button class="btn-save" id="btnSave">保存配置</button>
    </div>
  </div>
</div>`;
}
