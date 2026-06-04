// server/templates/intel-station/styles.ts
// CSS styles for IntelStation portal template

export function intelStationStyles(rootVars: string): string {
  return `
*{margin:0;padding:0;box-sizing:border-box}
:root{${rootVars}}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei","PingFang SC",sans-serif;background:var(--bg-primary);color:var(--text-primary);display:flex;flex-direction:column;overflow:hidden;-webkit-font-smoothing:antialiased;position:relative}
body::before{content:'';position:fixed;top:0;left:0;right:0;bottom:0;background:radial-gradient(ellipse at 20% 50%,rgba(0,212,255,0.03) 0%,transparent 50%),radial-gradient(ellipse at 80% 50%,rgba(168,85,247,0.03) 0%,transparent 50%);pointer-events:none;z-index:0}
::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(0,212,255,0.3);border-radius:10px}
::-webkit-scrollbar-thumb:hover{background:rgba(0,212,255,0.5)}

/* ===== NEON ANIMATIONS ===== */
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.2)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes neonScan{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
@keyframes borderGlow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}

/* ===== TOP BAR ===== */
.top-bar{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;background:rgba(2,6,23,0.95);border-bottom:1px solid var(--border);backdrop-filter:blur(16px);z-index:100;flex-shrink:0;box-shadow:0 2px 20px rgba(0,0,0,0.3),0 1px 0 rgba(0,212,255,0.05);position:relative;overflow:hidden}
.top-bar::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(0,212,255,0.4),rgba(168,85,247,0.4),rgba(0,212,255,0.4),transparent);animation:neonScan 4s linear infinite;pointer-events:none}
.top-logo{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:700;color:var(--cyan)}
.top-logo .logo-icon{width:32px;height:32px;background:linear-gradient(135deg,var(--cyan),var(--purple));border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 0 16px rgba(0,212,255,0.3),0 0 32px rgba(168,85,247,0.2);position:relative;overflow:hidden}
.top-logo .logo-icon::after{content:'';position:absolute;inset:0;background:linear-gradient(135deg,transparent 40%,rgba(255,255,255,0.2) 50%,transparent 60%);animation:neonScan 2s linear infinite}
.top-status{display:flex;align-items:center;gap:16px}
.status-dot{width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 8px rgba(16,185,129,0.6),0 0 16px rgba(16,185,129,0.3);animation:pulse 2s infinite}
.status-text{font-size:12px;color:var(--text-secondary)}
.btn-refresh-intel{padding:4px 12px;border:1px solid var(--border);border-radius:6px;background:rgba(0,212,255,0.05);color:var(--cyan);cursor:pointer;font-size:11px;font-weight:600;transition:all .2s;font-family:inherit;white-space:nowrap}
.btn-refresh-intel:hover{background:rgba(0,212,255,0.12);border-color:rgba(0,212,255,0.3);box-shadow:0 0 8px rgba(0,212,255,0.08)}
.update-info{font-size:10px;color:var(--text-secondary);margin-left:8px;white-space:nowrap}
.top-tabs{display:flex;gap:4px}
.tab-btn{padding:6px 14px;border:1px solid var(--border);background:transparent;color:var(--text-secondary);border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;transition:all .2s;font-family:inherit}
.tab-btn:hover{border-color:rgba(0,212,255,0.4);color:var(--cyan);box-shadow:0 0 12px rgba(0,212,255,0.12),inset 0 1px 0 rgba(255,255,255,0.03)}
.tab-btn.active{background:linear-gradient(135deg,rgba(0,212,255,0.15),rgba(168,85,247,0.15));border-color:rgba(0,212,255,0.5);color:var(--cyan);box-shadow:0 0 16px rgba(0,212,255,0.15),0 0 8px rgba(168,85,247,0.1),inset 0 1px 0 rgba(255,255,255,0.05)}
.top-actions{display:flex;gap:8px}
.btn-deploy{padding:8px 18px;background:linear-gradient(135deg,var(--cyan),var(--purple));border:none;border-radius:8px;color:#020617;font-size:12px;font-weight:700;cursor:pointer;transition:all .2s;font-family:inherit;letter-spacing:0.3px;box-shadow:0 0 12px rgba(0,212,255,0.2)}
.btn-deploy:hover{transform:translateY(-1px);box-shadow:0 4px 20px rgba(0,212,255,0.3),0 0 30px rgba(168,85,247,0.2)}

/* ===== MAIN LAYOUT ===== */
.main-layout{display:grid;grid-template-columns:320px 1fr 340px;grid-template-rows:1fr auto;grid-template-areas:"left center right""left bottom right";flex:1;overflow:hidden;position:relative;z-index:1;transition:grid-template-columns .35s cubic-bezier(.4,0,.2,1)}
.main-layout::before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(0,212,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,255,0.02) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0}
/* Collapsed left panel */
.main-layout.left-collapsed{grid-template-columns:0 1fr 340px}
.main-layout.left-collapsed .left-col{width:0;min-width:0;overflow:hidden;border-right:none;padding:0}

/* ===== LEFT COLUMN - Source Cards ===== */
.left-col{grid-area:left;background:var(--bg-secondary);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;box-shadow:inset -1px 0 0 var(--border),2px 0 10px rgba(0,0,0,0.1);transition:all .35s cubic-bezier(.4,0,.2,1)}
.left-header{padding:18px 20px;border-bottom:1px solid var(--border);flex-shrink:0;position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px}
.left-header::after{content:'';position:absolute;bottom:-1px;left:0;width:60px;height:2px;background:linear-gradient(90deg,var(--cyan),var(--purple));border-radius:1px}
.left-header h3{font-size:15px;font-weight:700;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:0.5px}
/* Toggle button for left panel */
.btn-toggle-left{width:22px;height:22px;border-radius:4px;border:1px solid var(--border);background:rgba(0,212,255,0.04);color:var(--cyan);cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0;padding:0;line-height:1;opacity:0.5}
.btn-toggle-left:hover{opacity:1;background:rgba(0,212,255,0.12);border-color:rgba(0,212,255,0.3);box-shadow:0 0 8px rgba(0,212,255,0.1)}
/* Floating toggle when panel is collapsed */
.btn-toggle-left-float{position:fixed;top:80px;left:2px;width:18px;height:18px;border-radius:3px;border:1px solid var(--border);background:rgba(15,23,42,0.9);color:var(--cyan);cursor:pointer;font-size:9px;display:none;align-items:center;justify-content:center;transition:all .2s;z-index:200;backdrop-filter:blur(6px);opacity:0.6;padding:0}
.btn-toggle-left-float:hover{opacity:1;background:rgba(0,212,255,0.15);border-color:rgba(0,212,255,0.4)}
.main-layout.left-collapsed+.btn-toggle-left-float{display:flex}
.source-groups{flex:1;overflow-y:auto;padding:14px 13px}
.source-card{display:flex;flex-direction:column;gap:0;padding:14px;margin-bottom:10px;border:1px solid var(--border);border-radius:12px;cursor:pointer;transition:all .25s;background:rgba(15,23,42,0.4);position:relative;overflow:hidden}
.source-card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(0,212,255,0.15),transparent);opacity:0;transition:opacity .25s}
.source-card:hover{border-color:rgba(0,212,255,0.4);background:rgba(0,212,255,0.05);box-shadow:0 0 16px rgba(0,212,255,0.1),inset 0 1px 0 rgba(255,255,255,0.03);transform:translateX(2px)}
.source-card:hover::before{opacity:1}
.source-card.active{border-color:rgba(0,212,255,0.5);background:rgba(0,212,255,0.08);box-shadow:0 0 20px rgba(0,212,255,0.15),0 0 8px rgba(168,85,247,0.08)}
.source-card .sc-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;background:rgba(0,212,255,0.1);box-shadow:0 0 8px rgba(0,212,255,0.08)}
.source-card .sc-body{flex:1;min-width:0}
.source-card .sc-name{font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:5px}
.source-card .sc-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.source-card .sc-provider{font-size:11px;padding:3px 8px;border-radius:5px;font-weight:600;background:rgba(0,212,255,0.12);color:var(--cyan)}
.source-card .sc-provider.metaso{background:rgba(168,85,247,0.12);color:var(--purple)}
.source-card .sc-kwcount{font-size:12px;color:var(--text-secondary)}
.source-card .sc-freq{font-size:12px;color:var(--text-secondary)}
.source-card .sc-edit{font-size:18px;color:var(--text-secondary);opacity:0;transition:opacity .2s;flex-shrink:0;position:absolute;top:10px;right:10px}
.source-card:hover .sc-edit{opacity:1}
.add-source-btn{width:100%;padding:14px;border:1px dashed var(--border);border-radius:12px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:14px;font-weight:500;transition:all .2s;font-family:inherit;margin-top:4px}
.add-source-btn:hover{border-color:rgba(0,212,255,0.3);color:var(--cyan);background:rgba(0,212,255,0.05);box-shadow:0 0 8px rgba(0,212,255,0.05)}
/* Source card active state */
.source-card.source-active{border-color:rgba(0,212,255,0.4);background:rgba(0,212,255,0.04)}
/* Source card clickable header */
.source-card .sc-clickable{display:flex;align-items:center;gap:10px;cursor:pointer;padding:4px}
.source-card .sc-arrow{font-size:12px;color:var(--text-secondary);flex-shrink:0;width:16px;text-align:center}
.source-card .sc-arrow.sc-has-children{color:var(--cyan)}
.source-card .sc-objcount{font-size:12px;color:var(--purple)}
/* Object list under expanded source */
.source-card .sc-objects-list{margin-top:8px;padding:8px 2px 2px;border-top:1px solid var(--border)}
.source-card .sc-obj-item{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;transition:background .15s;border-radius:6px}
.source-card .sc-obj-item:hover{background:rgba(168,85,247,0.06)}
.source-card .sc-obj-active{background:rgba(168,85,247,0.1)}
.source-card .sc-obj-dot{width:7px;height:7px;border-radius:50%;background:var(--text-secondary);flex-shrink:0}
.source-card .sc-obj-active .sc-obj-dot{background:var(--purple)}
.source-card .sc-obj-name{font-size:14px;color:var(--text-primary);flex:1}
.source-card .sc-obj-kwcount{font-size:12px;color:var(--text-secondary)}
/* Object filter buttons */
.intel-objfilters{display:flex;gap:4px;padding:4px 24px;flex-wrap:wrap}
/* Object tag on intel cards */
.intel-obj-tag{font-size:9px;padding:1px 6px;border-radius:3px;background:linear-gradient(135deg,rgba(0,212,255,0.15),rgba(168,85,247,0.15));color:var(--cyan);font-weight:500;margin-right:6px;white-space:nowrap;flex-shrink:0}
.intel-provider-tag{font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(251,191,36,0.12);color:var(--monitorAccent);font-weight:500;margin-right:6px;white-space:nowrap;flex-shrink:0}
.intel-sentiment-tag,.intel-reliability-tag{font-size:9px;padding:1px 6px;border-radius:3px;font-weight:500;margin-right:6px;white-space:nowrap;flex-shrink:0}
.intel-sentiment-tag.sent-pos{background:rgba(34,197,94,0.12);color:#22c55e}
.intel-sentiment-tag.sent-neg{background:rgba(239,68,68,0.12);color:#ef4444}
.intel-sentiment-tag.sent-neu{background:rgba(148,163,184,0.12);color:#94a3b8}
.intel-reliability-tag.rel-confirmed{background:rgba(34,197,94,0.10);color:#22c55e}
.intel-reliability-tag.rel-rumor{background:rgba(245,158,11,0.12);color:#f59e0b}
.intel-reliability-tag.rel-pending{background:rgba(148,163,184,0.10);color:#94a3b8}
.intel-card-intent{font-size:11px;color:var(--text-secondary);line-height:1.5;margin-bottom:6px;padding-left:4px;border-left:2px solid rgba(168,85,247,0.3)}

/* ===== CENTER COLUMN - Intel Feed ===== */
.center-col{grid-area:center;display:flex;flex-direction:column;overflow:hidden;background:var(--bg-primary)}
.center-header{padding:16px 24px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;position:relative}
.center-header::after{content:'';position:absolute;bottom:-1px;left:0;width:80px;height:2px;background:linear-gradient(90deg,var(--cyan),var(--purple));border-radius:1px}
.center-header h2{font-size:15px;font-weight:700;background:linear-gradient(135deg,var(--text-primary),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
/* Intel Feed Cards */
.intel-feed{flex:1;overflow-y:auto;padding:16px 24px}
.intel-card{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:12px;cursor:pointer;transition:all .25s;position:relative;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.15)}
.intel-card:hover{border-color:rgba(0,212,255,0.3);transform:translateY(-1px);box-shadow:0 4px 20px rgba(0,212,255,0.1),0 0 16px rgba(168,85,247,0.08),inset 0 1px 0 rgba(255,255,255,0.03)}
.intel-card-header{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.intel-card-title{font-size:14px;font-weight:600;color:var(--text-primary);flex:1;min-width:0;word-break:break-all;line-height:1.4}
.intel-card-source{font-size:11px;color:var(--text-secondary);margin-left:auto;padding:2px 8px;background:rgba(0,212,255,0.06);border-radius:4px;border:1px solid rgba(0,212,255,0.1);white-space:nowrap}
.intel-card-summary{font-size:12px;color:var(--text-secondary);line-height:1.7;margin-bottom:10px}
.intel-card-footer{display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.04)}
.intel-card-tags{display:flex;gap:4px;flex-wrap:wrap}
.intel-tag{font-size:10px;padding:2px 8px;border-radius:4px;background:rgba(0,212,255,0.08);color:var(--cyan);border:1px solid rgba(0,212,255,0.15)}
.intel-card-time{font-size:11px;color:var(--text-secondary);white-space:nowrap}

/* ===== V2.0: Value Score ===== */
.intel-score-badge{font-size:10px;padding:1px 7px;border-radius:4px;border:1.5px solid;font-weight:700;margin-right:4px;white-space:nowrap;flex-shrink:0;letter-spacing:0.3px}
.intel-card-high{background:var(--bg-card);border:1px solid rgba(245,158,11,0.35);border-radius:12px;padding:14px 16px;margin-bottom:12px;cursor:pointer;transition:all .25s;position:relative;overflow:hidden;box-shadow:0 2px 10px rgba(245,158,11,0.08),0 2px 8px rgba(0,0,0,0.15)}
.intel-card-high::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,rgba(245,158,11,0.8),rgba(245,158,11,0.3));border-radius:0 2px 2px 0}
.intel-card-high:hover{border-color:rgba(245,158,11,0.5);transform:translateY(-1px);box-shadow:0 4px 24px rgba(245,158,11,0.15),0 0 16px rgba(168,85,247,0.08),inset 0 1px 0 rgba(255,255,255,0.03)}

/* ===== CENTER TABS ===== */
.center-tabs{display:flex;gap:2px;background:rgba(15,23,42,0.4);border-radius:10px;padding:3px;border:1px solid var(--border)}
.ct-tab{padding:6px 18px;border-radius:8px;font-size:13px;font-weight:500;color:var(--text-secondary);cursor:pointer;transition:all .25s;white-space:nowrap;font-family:inherit;background:transparent;border:none}
.ct-tab:hover{color:var(--cyan);background:rgba(0,212,255,0.06)}
.ct-tab.active{color:var(--cyan);background:linear-gradient(135deg,rgba(0,212,255,0.15),rgba(168,85,247,0.12));box-shadow:0 0 12px rgba(0,212,255,0.1),inset 0 1px 0 rgba(255,255,255,0.05);font-weight:600}
/* ===== INTEL SUB-FILTERS (enlarged) ===== */
.subfilter-btn{padding:7px 18px;border:1px solid var(--border);background:transparent;color:var(--text-secondary);border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;transition:all .2s;font-family:inherit}
.subfilter-btn .sf-count{font-size:11px;font-weight:400;opacity:0.6;margin-left:3px}
.subfilter-btn:hover{border-color:rgba(0,212,255,0.4);color:var(--cyan)}
.subfilter-btn.active{background:linear-gradient(135deg,rgba(0,212,255,0.15),rgba(168,85,247,0.15));border-color:rgba(0,212,255,0.5);color:var(--cyan)}
.subfilter-btn.active .sf-count{opacity:0.8}
.intel-subfilters{display:flex;gap:8px;flex-wrap:wrap;padding:8px 0 16px 0;border-bottom:1px solid var(--border);margin-bottom:12px}
/* ===== REPORT FEED ===== */
.report-feed{flex:1;overflow-y:auto;padding:16px 24px}
.report-card{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;cursor:pointer;transition:all .3s;position:relative;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.2)}
.report-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,#10b981,#34d399);transition:all .3s}
.report-card:hover{border-color:rgba(16,185,129,0.4);transform:translateX(3px);box-shadow:0 4px 24px rgba(16,185,129,0.12),0 0 24px rgba(52,211,153,0.08),inset 0 1px 0 rgba(255,255,255,0.04)}
.report-card-icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;background:linear-gradient(135deg,rgba(16,185,129,0.14),rgba(52,211,153,0.06));box-shadow:0 0 10px rgba(16,185,129,0.12)}
.report-card-body{flex:1;min-width:0}
.report-card-title{font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px}
.report-card-meta{display:flex;align-items:center;gap:10px}
.report-card-date{font-size:10px;color:var(--text-secondary)}
.report-card-tag{font-size:9px;padding:2px 8px;border-radius:4px;background:rgba(16,185,129,0.1);color:#34d399}
/* ===== AI CHAT ===== */
.ai-chat{flex:1;display:flex;flex-direction:column;overflow:hidden}
.ai-chat-messages{flex:1;overflow-y:auto;padding:16px 24px}
.ai-msg{margin-bottom:12px;max-width:85%;line-height:1.6}
.ai-msg-user{display:flex;justify-content:flex-end}
.ai-msg-user>div{background:linear-gradient(135deg,var(--cyan),var(--purple));color:#020617;padding:10px 14px;border-radius:14px 14px 4px 14px;font-size:13px;font-weight:500;box-shadow:0 2px 12px rgba(0,212,255,0.15)}
.ai-msg-bot{background:rgba(15,23,42,0.6);border:1px solid var(--border);padding:10px 14px;border-radius:14px 14px 14px 4px;font-size:13px;color:var(--text-secondary)}
/* Report card inner layout */
.report-card-inner{display:flex;align-items:center;gap:12px}
.no-data-msg{text-align:center;padding:40px 20px;color:var(--text-secondary);font-size:13px;line-height:1.8}

/* ===== RIGHT COLUMN - Dashboard ===== */
.right-col{grid-area:right;background:var(--bg-secondary);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;box-shadow:inset 1px 0 0 var(--border),-2px 0 10px rgba(0,0,0,0.1)}
.right-header{padding:16px 18px;border-bottom:1px solid var(--border);flex-shrink:0;position:relative}
.right-header::after{content:'';position:absolute;bottom:-1px;left:0;width:60px;height:2px;background:linear-gradient(90deg,var(--purple),var(--cyan));border-radius:1px}
.right-header h3{font-size:13px;font-weight:700;background:linear-gradient(135deg,var(--purple),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:0.5px}
.dashboard-content{flex:1;overflow-y:auto;padding:16px 18px}
.dashboard-section{margin-bottom:20px;position:relative;background:rgba(15,23,42,0.4);border:1px solid var(--border);border-radius:12px;padding:14px;transition:all .3s}
.dashboard-section:hover{border-color:rgba(0,212,255,0.2);box-shadow:0 0 16px rgba(0,212,255,0.05)}
.dashboard-section::before{content:'';position:absolute;top:-1px;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,rgba(0,212,255,0.2),rgba(168,85,247,0.2),transparent)}
.dashboard-section h4{font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:12px;letter-spacing:0.5px;text-transform:uppercase}
/* Sentiment Gauge */
.sentiment-gauge{position:relative;width:100%;max-width:260px;height:auto;margin:0 auto;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:8px}
.sentiment-gauge canvas{display:block;max-width:100%;height:auto}
.sentiment-label{font-size:16px;font-weight:700;color:rgba(255,255,255,0.9);text-shadow:0 0 16px rgba(0,212,255,0.3);margin-top:4px;text-align:center}
/* Keyword Cloud */
.keyword-cloud{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
.kw-cloud-item{font-size:11px;padding:4px 10px;border-radius:12px;background:rgba(0,212,255,0.08);color:var(--cyan);border:1px solid rgba(0,212,255,0.2);transition:all .3s;cursor:default;box-shadow:0 0 6px rgba(0,212,255,0.1)}
.kw-cloud-item:hover{transform:scale(1.1);background:rgba(0,212,255,0.15);box-shadow:0 0 16px rgba(0,212,255,0.25),0 0 8px rgba(0,212,255,0.15)}
.kw-cloud-item.important{font-size:13px;font-weight:600;background:rgba(168,85,247,0.15);color:var(--purple);border-color:rgba(168,85,247,0.35);box-shadow:0 0 10px rgba(168,85,247,0.2)}
.kw-cloud-item.important:hover{box-shadow:0 0 20px rgba(168,85,247,0.3),0 0 10px rgba(168,85,247,0.2)}
/* Source Channel Distribution */
.source-channels{display:flex;flex-direction:column;gap:6px}
.src-channel-item{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.1);border-radius:8px;transition:all .2s}
.src-channel-item:hover{background:rgba(0,212,255,0.08);border-color:rgba(0,212,255,0.2);transform:translateX(2px)}
.src-channel-name{font-size:12px;font-weight:500;color:var(--text-primary)}
.src-channel-count{font-size:13px;font-weight:700;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;min-width:24px;text-align:right}
/* KPI Trend */
.kpi-trend{position:relative;height:100px;margin-bottom:12px;overflow:hidden}
.kpi-trend canvas{display:block;width:100%!important;height:100px}
/* AI Briefing */
.ai-briefing{background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.15);border-radius:10px;padding:14px;box-shadow:0 0 16px rgba(0,212,255,0.06),inset 0 1px 0 rgba(255,255,255,0.03);position:relative;overflow:hidden}
.ai-briefing::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(0,212,255,0.3),rgba(168,85,247,0.3),transparent)}
.ai-briefing-header{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.ai-briefing-header .ai-icon{width:24px;height:24px;background:linear-gradient(135deg,var(--cyan),var(--purple));border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 0 12px rgba(0,212,255,0.25),0 0 20px rgba(168,85,247,0.15)}
.ai-briefing-header .ai-title{font-size:12px;font-weight:600;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.briefing-text{font-size:11px;color:var(--text-secondary);line-height:1.6}
.briefing-text p{margin-bottom:6px}

/* ===== BOTTOM BAR - AI Command Center ===== */
.bottom-bar{grid-area:bottom;display:flex;align-items:center;justify-content:center;gap:0;padding:10px 24px 8px;background:rgba(2,6,23,0.98);border-top:1px solid var(--border);backdrop-filter:blur(20px);flex-shrink:0;position:relative;overflow:hidden;flex-direction:column}
.bottom-bar::before{content:'';position:absolute;inset:0;border-radius:0;background:linear-gradient(135deg,rgba(0,212,255,0.06),rgba(168,85,247,0.06));pointer-events:none;z-index:0}
.cmd-outer{position:relative;width:100%;max-width:600px;padding:2px;border-radius:30px;background:linear-gradient(135deg,#00d4ff,#a855f7,#00d4ff);background-size:200% 200%;animation:borderGlow 3s ease infinite;box-shadow:0 0 20px rgba(0,212,255,0.15),0 0 40px rgba(168,85,247,0.1);z-index:1;transition:all .3s}
.cmd-outer:focus-within{background:linear-gradient(135deg,#00f0ff,#d946ef,#00f0ff);background-size:200% 200%;animation:borderGlow 2s ease infinite;box-shadow:0 0 30px rgba(0,212,255,0.25),0 0 60px rgba(168,85,247,0.15),0 0 100px rgba(0,212,255,0.08)}
.cmd-wrapper{display:flex;align-items:center;gap:8px;width:100%;padding:4px 8px 4px 16px;background:linear-gradient(135deg,rgba(0,212,255,0.06),rgba(168,85,247,0.06));border-radius:28px;position:relative;z-index:1;transition:all .3s}
.cmd-wrapper:focus-within{background:linear-gradient(135deg,rgba(0,212,255,0.1),rgba(168,85,247,0.1))}
.cmd-label{display:none}
.cmd-input{flex:1;padding:6px 12px;border:none;background:transparent;color:var(--text-primary);font-size:13px;outline:none;font-family:inherit;min-width:0}
.cmd-input::placeholder{color:rgba(255,255,255,0.65);font-size:13px;font-weight:400}
.cmd-input:focus{outline:none}
.cmd-btn{width:32px;height:32px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .2s;flex-shrink:0}
.cmd-btn.mic{background:rgba(255,255,255,0.08);color:#ffffff}
.cmd-btn.mic:hover{background:rgba(0,212,255,0.2);color:#ffffff}
.cmd-btn.send{background:linear-gradient(135deg,var(--cyan),var(--purple));color:#020617;font-weight:700;box-shadow:0 2px 12px rgba(0,212,255,0.3)}
.cmd-btn.send:hover{transform:scale(1.05);box-shadow:0 4px 20px rgba(0,212,255,0.4),0 0 30px rgba(168,85,247,0.25)}
.cmd-hint{font-size:13px;color:rgba(255,255,255,0.35);margin-top:5px;text-align:center;letter-spacing:0.3px}

/* ===== MODAL ===== */
.modal-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .25s}
.modal-overlay.open{opacity:1;pointer-events:auto}
.modal-bg{position:absolute;inset:0;background:rgba(2,6,23,0.85);backdrop-filter:blur(8px)}
.modal-panel{position:relative;width:100%;max-width:640px;max-height:88vh;background:linear-gradient(135deg,#0f172a,#1e293b);border:1px solid var(--border);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transform:scale(.92) translateY(20px);transition:transform .35s cubic-bezier(.34,1.56,.64,1);box-shadow:0 24px 64px rgba(0,0,0,0.6)}
.modal-overlay.open .modal-panel{transform:scale(1) translateY(0)}
.modal-panel.modal-dragging{transition:none!important;box-shadow:0 32px 80px rgba(0,0,0,0.7),0 0 50px rgba(0,212,255,0.15)!important}
.modal-hd{cursor:move;user-select:none}
.modal-hd{display:flex;align-items:center;gap:12px;padding:16px 24px;border-bottom:1px solid var(--border);flex-shrink:0;position:sticky;top:0;z-index:10;background:linear-gradient(135deg,#0f172a,#1e293b);backdrop-filter:blur(8px)}
.mh-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;background:rgba(0,212,255,0.12);box-shadow:0 0 12px rgba(0,212,255,0.1)}
.mh-info{flex:1;min-width:0}
.mh-title{font-size:14px;font-weight:700;color:var(--text-primary)}
.mh-sub{font-size:11px;color:var(--text-secondary);margin-top:2px}
.modal-close{width:30px;height:30px;border-radius:8px;border:none;background:transparent;color:var(--text-secondary);font-size:18px;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center}
.modal-close:hover{background:rgba(239,68,68,0.15);color:#ef4444}
/* Delete button in modal header */
.modal-delete{width:30px;height:30px;border-radius:8px;border:none;background:transparent;color:#ef4444;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;padding:0}
.modal-delete:hover{background:rgba(239,68,68,0.12)}
.modal-bd{flex:1;overflow-y:auto;padding:20px 24px}
.modal-ft{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:16px 24px;border-top:1px solid var(--border);flex-shrink:0;position:sticky;bottom:0;z-index:10;background:linear-gradient(135deg,#0f172a,#1e293b);backdrop-filter:blur(8px)}
.btn-cancel{padding:8px 20px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:14px;font-weight:500;transition:all .2s;font-family:inherit}
.btn-cancel:hover{border-color:rgba(255,255,255,0.2);color:var(--text-primary)}
.btn-save{padding:8px 20px;border:none;border-radius:8px;background:linear-gradient(135deg,var(--cyan),var(--purple));color:#020617;cursor:pointer;font-size:14px;font-weight:700;transition:all .2s;font-family:inherit;box-shadow:0 0 12px rgba(0,212,255,0.2)}
.btn-save:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,212,255,0.3),0 0 20px rgba(168,85,247,0.2)}
.btn-save:disabled{opacity:0.5;cursor:not-allowed;transform:none;box-shadow:none}
/* Modal Form Fields */
.mb-group{margin-bottom:16px}
.mb-label{display:block;font-size:14px;font-weight:600;color:var(--text-secondary);margin-bottom:6px}
.mb-label span{font-weight:400;color:var(--text-secondary);opacity:0.6}
.mb-input{width:100%;padding:8px 12px;background:rgba(2,6,23,0.5);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;outline:none;font-family:inherit;transition:border .2s}
.mb-input:focus{border-color:var(--cyan)}
.mb-select{width:100%;padding:8px 12px;background:rgba(2,6,23,0.5);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;outline:none;font-family:inherit;transition:border .2s;cursor:pointer}
.mb-select:focus{border-color:var(--cyan)}
.mb-area{width:100%;padding:8px 12px;background:rgba(2,6,23,0.5);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;outline:none;font-family:inherit;transition:border .2s;resize:vertical}
.mb-area:focus{border-color:var(--cyan)}
.mb-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
/* Keyword Tags in Modal */
.kw-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.kw-t{display:flex;align-items:center;gap:4px;padding:4px 10px;background:rgba(0,212,255,0.1);border:1px solid rgba(0,212,255,0.2);border-radius:10px;font-size:12px;color:var(--cyan);box-shadow:0 0 6px rgba(0,212,255,0.05)}
.kw-x{background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:14px;padding:0 2px;transition:color .2s}
.kw-x:hover{color:#ef4444}
.kw-add-row{display:flex;gap:6px}
.kw-add-input{flex:1;padding:6px 10px;background:rgba(2,6,23,0.5);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:13px;outline:none;font-family:inherit;transition:border .2s}
.kw-add-input:focus{border-color:var(--cyan)}
.kw-add-btn{padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:rgba(0,212,255,0.05);color:var(--cyan);cursor:pointer;font-size:14px;font-weight:700;transition:all .2s}
.kw-add-btn:hover{background:rgba(0,212,255,0.15);border-color:rgba(0,212,255,0.3)}
/* Object tags (purple theme) */
.obj-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.obj-t{display:flex;align-items:center;gap:4px;padding:4px 10px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.2);border-radius:10px;font-size:12px;color:var(--purple);box-shadow:0 0 6px rgba(168,85,247,0.05)}
.obj-x{background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:14px;padding:0 2px;transition:color .2s}
.obj-x:hover{color:#ef4444}
/* Model config toggle in modal */
.model-config-toggle{display:flex;align-items:center;gap:6px;padding:6px 0;background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:14px;font-family:inherit;font-weight:600;width:100%}
.model-config-toggle:hover{color:var(--text-primary)}
/* Delete source button in form footer */
.src-del-btn{padding:6px 14px;border:1px solid rgba(239,68,68,0.3);border-radius:8px;background:rgba(239,68,68,0.05);color:#ef4444;cursor:pointer;font-size:12px;font-weight:500;transition:all .2s;font-family:inherit}
.src-del-btn:hover{background:rgba(239,68,68,0.12);border-color:rgba(239,68,68,0.5)}
/* Source top row */
.src-del{font-size:11px;color:var(--text-secondary);cursor:pointer;padding:4px 8px;border-radius:4px;transition:all .2s}
.src-del:hover{color:#ef4444;background:rgba(239,68,68,0.1)}
.btn-add-src{width:100%;margin-top:8px;padding:10px;border:1px dashed var(--border);border-radius:8px;background:transparent;color:var(--cyan);cursor:pointer;font-size:12px;font-weight:600;transition:all .2s;font-family:inherit}
.btn-add-src:hover{border-color:var(--cyan);background:rgba(0,212,255,0.05);box-shadow:0 0 8px rgba(0,212,255,0.08)}

/* Source Row Header */
.src-top{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.st-name-input{flex:1;padding:6px 10px;background:rgba(2,6,23,0.5);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:12px;font-weight:600;outline:none;font-family:inherit;transition:border .2s}
.st-name-input:focus{border-color:var(--cyan)}
.src-mini{border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px;background:rgba(15,23,42,0.3);transition:border .2s}
.src-mini:hover{border-color:rgba(0,212,255,0.2)}

/* ===== SITE FOOTER ===== */
.site-footer{text-align:center;padding:12px 20px;font-size:12px;color:var(--text-secondary);border-top:1px solid var(--border);background:rgba(2,6,23,0.6)}
.site-footer a{color:var(--text-secondary);text-decoration:none;transition:color .2s}
.site-footer a:hover{color:var(--cyan)}

/* ===== RESPONSIVE ===== */
@media(max-width:1280px){.main-layout{grid-template-columns:280px 1fr 300px;grid-template-rows:1fr auto;grid-template-areas:"left center right""left bottom right"}}
@media(max-width:1024px){.main-layout{grid-template-columns:1fr;height:100%;grid-template-rows:1fr auto;grid-template-areas:"center""bottom"}.left-col,.right-col{display:none}}
/* Sentiment Stats Grid */
.sentiment-stats{margin-top:12px}
.sstat-row{display:flex;gap:6px;margin-bottom:6px}
.sstat-row:first-child .sstat-val{font-size:18px}
.sstat-cell{flex:1;display:flex;flex-direction:column;align-items:center;padding:8px 2px;border-radius:8px;background:rgba(15,23,42,0.5);border:1px solid rgba(0,212,255,0.08);transition:all .2s}
.sstat-cell:hover{border-color:rgba(0,212,255,0.25);background:rgba(15,23,42,0.7)}
.sstat-val{font-size:15px;font-weight:700;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.2}
.sstat-cell.sstat-pos .sstat-val{background:linear-gradient(135deg,#22c55e,#4ade80);-webkit-background-clip:text}
.sstat-cell.sstat-neg .sstat-val{background:linear-gradient(135deg,#ef4444,#f87171);-webkit-background-clip:text}
.sstat-cell.sstat-neu .sstat-val{background:linear-gradient(135deg,#94a3b8,#cbd5e1);-webkit-background-clip:text}
.sstat-lbl{font-size:9px;font-weight:500;color:var(--text-secondary);margin-top:3px;white-space:nowrap}

@media(max-width:768px){.top-bar{padding:10px 16px}.center-header{padding:12px 16px}.intel-feed{padding:12px 16px}}`;
}
