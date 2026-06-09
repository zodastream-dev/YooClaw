import p from 'postgres';
const db = p('postgresql://postgres.gshktfexvcyacyjtridi:Zodastream1!@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require', { ssl: 'require' });

import { generateIntelStationHtml } from './server/templates/intel-station/index';

function getBankingWidgets(): any[] {
  return [
    { type: 'intel-monitor', title: '行业信号', config: { sources: [{ name: '行业信号', aiProvider: 'serper', aiModel: 'deepseek-v4-flash', keywords: ['金监总局 窗口指导','地方专债 分配额度','信贷投向 考核指标','地方政府工作报告 基础设施项目','央行货币政策执行报告','银行业净息差 趋势','资本新规 落地','LPR报价 最新','数字人民币试点 扩容','金融科技监管沙盒'], objects: [], updateFrequency: 'daily', customPrompt: '你是银行业趋势研究分析师，为商业银行高管提供行业信号监测...' }] } },
    { type: 'intel-monitor', title: '目标客户情报', config: { sources: [{ name: '目标客户情报', aiProvider: 'serper', aiModel: 'deepseek-v4-pro', keywords: ['央企融资需求','国企改革','城投平台 债务展期'], objects: [{ name: '中国中铁', keywords: ['基建订单','海外工程','应收账款','评级'] },{ name: '中国交建', keywords: ['港口建设','一带一路','PPP项目','融资'] },{ name: '中国建筑', keywords: ['城市更新','保障房','房地产开发','订单'] },{ name: '国家电网', keywords: ['电网投资','新能源','电力改革','债券'] }], updateFrequency: 'daily', customPrompt: '你是商业银行客户情报分析师...' }] } },
    { type: 'intel-monitor', title: '竞争对手情报', config: { sources: [{ name: '竞争对手情报', aiProvider: 'serper', aiModel: 'deepseek-v4-pro', keywords: ['分行行长 战略合作协议','银团贷款 牵头行','对公贷款 竞争'], objects: [{ name: '工商银行', keywords: ['金融科技','海外分行','数字人民币','绿色金融'] },{ name: '建设银行', keywords: ['住房金融','基建贷款','科技投入','普惠金融'] },{ name: '农业银行', keywords: ['三农金融','县域金融','乡村振兴','数字乡村'] },{ name: '中国银行', keywords: ['跨境业务','外汇交易','海外扩张','投行'] },{ name: '招商银行', keywords: ['零售银行','财富管理','私人银行','数字化'] }], updateFrequency: 'daily', customPrompt: '你是竞争情报分析师...' }] } },
    { type: 'intel-monitor', title: '自身舆情监控', config: { sources: [{ name: '自身舆情监控', aiProvider: 'serper', aiModel: 'deepseek-v4-pro', keywords: ['金监局 监管处罚 银行','银行 违规放贷 调查','不良贷款 核销','银行高管 被查 违纪','银行 理财 违约 投诉','银行 风险事件 挤兑','银行 数据泄露','银行 反洗钱 处罚','银行 违规 资金挪用','银行 员工 违法 案件'], objects: [], updateFrequency: 'daily', customPrompt: '你是银行风险与舆情监控分析师...' }] } },
  ];
}

(async () => {
  const rows = await db`SELECT * FROM report_sites WHERE slug = 'site-4ca7fa'`;
  const s = rows[0];
  if (!s) { console.log('Not found'); process.exit(1); }
  console.log('Found:', s.slug, '| title:', s.title, '| type:', s.type, '| published:', s.is_published);
  console.log('HTML length:', (s.html_content||'').length);
  
  if (!s.html_content || s.html_content.length < 100) {
    console.log('Regenerating HTML...');
    const widgets = getBankingWidgets();
    const html = generateIntelStationHtml(s.title, '', 'https://api.yookeer.com', s.slug, widgets, 'banking-blue');
    await db`UPDATE report_sites SET html_content = ${html}, updated_at = now() WHERE slug = 'site-4ca7fa'`;
    console.log('Regenerated, new HTML length:', html.length);
  }
  
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
