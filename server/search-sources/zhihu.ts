// 知乎搜索源 — 抓取 zhihu.com/search 搜索结果
import type { RawSearchItem, SearchModule } from './types';
import * as cheerio from 'cheerio';

const zhihuModule: SearchModule = {
  name: 'zhihu',
  label: '知乎',
  async search(query: string, _apiKey: string): Promise<RawSearchItem[]> {
    try {
      const url = `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        console.warn('[ZhihuSearch] HTTP ' + resp.status);
        return [];
      }
      const html = await resp.text();
      const $ = cheerio.load(html);

      const items: RawSearchItem[] = [];

      // 知乎搜索结果：.List-item 容器
      $('.List-item').each((_i: number, el: any) => {
        const $el = $(el);

        // 提取标题
        const titleEl = $el.find('.ContentItem-title a, h2 a, .title a').first();
        const title = titleEl.text().trim();
        if (!title) return;

        // 提取链接
        let link = titleEl.attr('href') || '';
        if (link && !link.startsWith('http')) {
          link = 'https://www.zhihu.com' + link;
        }

        // 提取摘要
        const snippetEl = $el.find('.RichContent-inner, .SearchItem-summary, .content').first();
        const snippet = snippetEl.text().replace(/\s+/g, ' ').trim().substring(0, 200);

        // 提取点赞/评论数作为热度参考
        const metaEl = $el.find('.ContentItem-actions, .meta');
        const meta = metaEl.text().trim();

        items.push({
          title,
          url: link || `https://www.zhihu.com/search?q=${encodeURIComponent(query)}`,
          snippet: snippet || meta || title,
          date: '',
        });
      });

      // 如果主选择器没结果，尝试备选选择器
      if (items.length === 0) {
        $('.SearchResult-Card, .Card').each((_i: number, el: any) => {
          const $el = $(el);
          const titleEl = $el.find('a[data-za-detail-view-element_name="Title"]').first();
          const title = titleEl.text().trim();
          if (!title || title.length < 3) return;
          let link = titleEl.attr('href') || '';
          if (link && !link.startsWith('http')) link = 'https://www.zhihu.com' + link;
          const snippet = $el.find('.RichText, .SearchItem-summary').text().replace(/\s+/g, ' ').trim().substring(0, 200);
          items.push({ title, url: link, snippet, date: '' });
        });
      }

      console.log('[ZhihuSearch] Found ' + items.length + ' results for "' + query + '"');
      return items.slice(0, 15);
    } catch (e) {
      console.warn('[ZhihuSearch] Failed:', e instanceof Error ? e.message : String(e));
      return [];
    }
  },
};

export default zhihuModule;
