#!/usr/bin/env node
// Search WeChat articles via weixin.sogou.com
const https = require('https');
const querystring = require('querystring');

const query = process.argv[2] || '';
const n = parseInt(process.argv[4] || '15', 10);

if (!query) {
  console.log(JSON.stringify([]));
  process.exit(0);
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(data); });
    }).on('error', reject);
  });
}

function extractResults(html) {
  const items = [];
  // Simple regex-based extraction from sogou weixin search results
  const itemRegex = /<a[^>]*href="([^"]*)"[^>]*uigs="article_title_\d+"[^>]*>\s*<[^>]*>\s*([\s\S]*?)\s*<\/[^>]*>\s*<\/a>/gi;
  let match;
  while ((match = itemRegex.exec(html)) !== null && items.length < n) {
    const url = match[1].replace(/&amp;/g, '&');
    const title = match[2].replace(/<[^>]*>/g, '').replace(/&\w+;/g, ' ').trim();
    if (title && url) {
      items.push({ title, url, date: '', snippet: '' });
    }
  }
  // Fallback: try to find any article links
  if (items.length === 0) {
    const fallbackRegex = /<a[^>]*href="(\/link\?url=[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = fallbackRegex.exec(html)) !== null && items.length < n) {
      const url = 'https://weixin.sogou.com' + match[1].replace(/&amp;/g, '&');
      const title = match[2].replace(/<[^>]*>/g, '').replace(/&\w+;/g, ' ').trim();
      if (title && url) items.push({ title, url, date: '', snippet: '' });
    }
  }
  return items;
}

(async () => {
  try {
    const searchUrl = `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}&ie=utf8`;
    const html = await fetch(searchUrl);
    const results = extractResults(html);
    console.log(JSON.stringify(results.slice(0, n)));
  } catch (e) {
    console.warn('[search_wechat] Error:', e.message);
    console.log(JSON.stringify([]));
  }
})();
