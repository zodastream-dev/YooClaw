// 小红书搜索源 — 双策略：先直接抓取 + 百度 site: 兜底
import type { RawSearchItem, SearchModule } from './types';
import * as cheerio from 'cheerio';

async function directSearch(query: string): Promise<RawSearchItem[]> {
  try {
    const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}&source=web_search_result_notes`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return [];
    const html = await resp.text();

    // 尝试从 __INITIAL_STATE__ 中提取数据
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})\s*<\/script>/);
    if (stateMatch) {
      try {
        // 替换 undefined 为 null 以便 JSON 解析
        const cleaned = stateMatch[1].replace(/undefined/g, 'null');
        const state = JSON.parse(cleaned);
        const notes = state?.search?.notes || state?.note?.noteList || [];
        if (Array.isArray(notes) && notes.length > 0) {
          return notes.slice(0, 15).map((n: any) => ({
            title: (n.displayTitle || n.title || '').substring(0, 80),
            url: `https://www.xiaohongshu.com/explore/${n.id || n.noteId || ''}`,
            snippet: (n.desc || n.content || '').substring(0, 200),
            date: n.time ? new Date(n.time).toISOString().split('T')[0] : '',
          }));
        }
      } catch {
        // JSON 解析失败，继续尝试 HTML 解析
      }
    }

    // Fallback: 从 HTML 中解析笔记卡片
    const $ = cheerio.load(html);
    const items: RawSearchItem[] = [];
    $('.note-item, .search-result-item, .feeds-page .note-item').each((_i: number, el: any) => {
      const $el = $(el);
      const titleEl = $el.find('.title, .note-title').first();
      const title = titleEl.text().trim();
      if (!title) return;
      const linkEl = $el.find('a.cover, a[href*="/explore/"]').first();
      let link = linkEl.attr('href') || '';
      if (link && !link.startsWith('http')) link = 'https://www.xiaohongshu.com' + link;
      const authorEl = $el.find('.author .name, .nickname').first();
      const author = authorEl.text().trim();
      const likeEl = $el.find('.like-wrapper .count, .like-count').first();
      const likes = likeEl.text().trim();
      items.push({
        title,
        url: link || `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`,
        snippet: [author, likes ? `👍${likes}` : ''].filter(Boolean).join(' · '),
        date: '',
      });
    });
    return items;
  } catch {
    return [];
  }
}

// 兜底：用百度搜索 site:xiaohongshu.com
async function baiduFallbackSearch(query: string): Promise<RawSearchItem[]> {
  try {
    const baiduQuery = `site:xiaohongshu.com ${query}`;
    const url = `https://www.baidu.com/s?wd=${encodeURIComponent(baiduQuery)}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const $ = cheerio.load(html);

    const items: RawSearchItem[] = [];
    $('.result, .c-container').each((_i: number, el: any) => {
      const $el = $(el);
      const titleEl = $el.find('.t a, h3 a').first();
      const title = titleEl.text().trim();
      if (!title || title.length < 5) return;
      const url = titleEl.attr('href') || '';
      const snippet = $el.find('.c-abstract, .c-span-last').text().trim().substring(0, 200);
      items.push({ title, url, snippet, date: '' });
    });
    return items.slice(0, 10);
  } catch {
    return [];
  }
}

const xiaohongshuModule: SearchModule = {
  name: 'xiaohongshu',
  label: '小红书',
  async search(query: string, _apiKey: string): Promise<RawSearchItem[]> {
    // 策略 1：直接抓取小红书搜索页
    const direct = await directSearch(query);
    if (direct.length > 0) {
      console.log('[XHSSearch] Direct search found ' + direct.length + ' results for "' + query + '"');
      return direct;
    }
    // 策略 2：百度 site: 兜底
    console.log('[XHSSearch] Direct search returned 0, trying Baidu fallback for "' + query + '"');
    const fallback = await baiduFallbackSearch(query);
    console.log('[XHSSearch] Baidu fallback found ' + fallback.length + ' results for "' + query + '"');
    return fallback;
  },
};

export default xiaohongshuModule;
