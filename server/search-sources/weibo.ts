// 微博搜索源 — 抓取 s.weibo.com 搜索结果
import type { RawSearchItem, SearchModule } from './types';
import * as cheerio from 'cheerio';

const weiboModule: SearchModule = {
  name: 'weibo',
  label: '微博',
  async search(query: string, _apiKey: string): Promise<RawSearchItem[]> {
    try {
      // 微博高级搜索：综合排序，最近30天
      const url = `https://s.weibo.com/weibo?q=${encodeURIComponent(query)}&typeall=1&suball=1&Refer=g`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Cookie': '', // 空 Cookie 获取公开搜索结果
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        console.warn('[WeiboSearch] HTTP ' + resp.status);
        return [];
      }
      const html = await resp.text();
      const $ = cheerio.load(html);

      const items: RawSearchItem[] = [];
      // 微博搜索结果容器：.card-wrap 或 .m-wrap
      $('.card-wrap, .m-wrap').each((_i: number, el: any) => {
        const $el = $(el);

        // 提取微博正文（第一个 p.txt 是昵称，第二个 p.txt 是正文）
        const txtEls = $el.find('.txt');
        let content = '';
        if (txtEls.length >= 2) {
          content = $(txtEls[1]).text().trim();
        } else {
          // 兼容不同的 DOM 结构
          content = $el.find('.content p').last().text().trim();
          if (!content) content = txtEls.first().text().trim();
        }
        // 清理 HTML 标签和特殊字符
        content = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (!content || content.length < 5) return;

        // 提取来源链接
        const linkEl = $el.find('.from a').first();
        const url = linkEl.attr('href') || '';

        // 提取时间
        const dateEl = $el.find('.from .date, .time').first();
        const date = dateEl.text().trim() || '';

        // 用内容前 40 字作为标题
        const title = content.substring(0, 40) + (content.length > 40 ? '...' : '');

        items.push({
          title,
          url: url || `https://s.weibo.com/weibo?q=${encodeURIComponent(query)}`,
          snippet: content.substring(0, 200),
          date,
        });
      });

      console.log('[WeiboSearch] Found ' + items.length + ' results for "' + query + '"');
      return items.slice(0, 15);
    } catch (e) {
      console.warn('[WeiboSearch] Failed:', e instanceof Error ? e.message : String(e));
      return [];
    }
  },
};

export default weiboModule;
