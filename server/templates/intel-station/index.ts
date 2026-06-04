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
</body>
</html>`;
}
