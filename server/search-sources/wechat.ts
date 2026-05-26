import type { RawSearchItem, SearchModule } from './types';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const wechatModule: SearchModule = {
  name: 'wechat',
  label: '微信公众号',
  async search(query: string, _apiKey: string): Promise<RawSearchItem[]> {
    try {
      const scriptPath = process.env.WECHAT_SEARCH_SCRIPT || join(dirname(fileURLToPath(import.meta.url)), '../../scripts/search_wechat.js');
      const result = execSync('node ' + scriptPath + ' "' + query + '" -n 15', { encoding: 'utf-8', timeout: 30000 });
      const data = JSON.parse(result);
      return (Array.isArray(data) ? data : []).map((r: any) => ({
        title: r.title || rthitle || '',
        url: r.url || r.link || '',
        snippet: r.summary || r.abstract || r.content || '',
        date: r.date || r.publishTime || '',
      }));
    } catch (e) {
      console.warn('[WeChatSearch] Failed:', e instanceof Error ? e.message : String(e));
      return [];
    }
  },
};

export default wechatModule;
