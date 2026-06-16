// server/templates/intel-station/index.ts
// IntelStation portal template assembler

import { COLOR_SCHEMES, type ColorScheme } from '../schemes';
import { intelStationBody } from './body';
import { intelStationStyles } from './styles';
import { intelStationScripts } from './scripts';

export function generateIntelStationHtml(
  siteName: string,
  _siteDesc: string,
  apiBase: string,
  slug: string,
  widgets?: any[],
  colorScheme: string = 'tech-blue'
): string {
  const sn = siteName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const wlist =
    widgets && widgets.length > 0
      ? widgets
      : [{ type: 'intel-monitor', title: '情报监控', config: { sources: [] } }];
  const wlistJson = JSON.stringify(wlist).replace(/'/g, '\\x27');

  const scheme = COLOR_SCHEMES[colorScheme as ColorScheme] || COLOR_SCHEMES['tech-blue'];
  const rootVars =
    '--cyan:' + scheme.cyan + ';' +
    '--purple:' + scheme.purple + ';' +
    '--neon-blue:' + scheme.neonBlue + ';' +
    '--neon-purple:' + scheme.neonPurple + ';' +
    '--neon-pink:' + scheme.neonPink + ';' +
    '--bg-primary:' + scheme.bgPrimary + ';' +
    '--bg-secondary:' + scheme.bgSecondary + ';' +
    '--bg-card:' + scheme.bgCard + ';' +
    '--border:' + scheme.border + ';' +
    '--text-primary:' + scheme.textPrimary + ';' +
    '--text-secondary:' + scheme.textSecondary + ';' +
    '--score-high:#f59e0b;' +
    '--score-mid:var(--cyan);' +
    '--score-low:' + scheme.textSecondary + ';';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${sn}</title>
<style>
${intelStationStyles(rootVars)}
</style>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body>
${intelStationBody(sn)}
<script>
${intelStationScripts(apiBase, slug, wlistJson)}
</script>
<script>
// V3.1 hotfix: override PROVIDER_NAMES with full Chinese mappings (源 scripts.ts 的 tsx 缓存未刷新)
window._PROVIDER_NAMES={metaso:'秘塔',serper:'Serper',newsbank:'Serper新闻库',xiaohongshu:'小红书',zhihu:'知乎',weibo:'微博',wechat:'微信','multi-engine':'多引擎',tavily:'Tavily','tianapi-generalnews':'天聚综合','tianapi-keji':'天聚科技','tianapi-ai':'天聚AI','tianapi-guonei':'天聚国内','tianapi-world':'天聚国际','tianapi-social':'天聚社会','tianapi-caijing':'天聚财经','tianapi-internet':'天聚互联网','rss-ndrc':'发改委','rss-ndrc-news':'发改委新闻','rss-mof':'财政部','rss-people':'人民网','rss-xinhua':'新华网','rss-ce':'经济日报','rss-financialnews':'金融时报','rss-jfdaily':'解放日报','rss-gmw':'光明日报','rss-cnr':'央广网','rss-stcn':'证券时报','rss-jjckb':'经济参考报','gov-mee-eia':'环保部','gov-ndrc-projects':'发改委项目','gov-cbirc-notices':'金监总局'};
Object.assign(window._PROVIDER_NAMES,PROVIDER_NAMES);
PROVIDER_NAMES=window._PROVIDER_NAMES;
</script>
</body>
</html>`;
}
