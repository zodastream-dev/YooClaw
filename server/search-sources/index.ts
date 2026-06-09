import type { SearchModule } from './types';
import metasoModule from './metaso';
import tavilyModule from './tavily';
import multiEngineModule from './multi-engine';
import wechatModule from './wechat';
import weiboModule from './weibo';
import zhihuModule from './zhihu';
import xiaohongshuModule from './xiaohongshu';
import serperModule from './serper';
import {
  tianapiKejiModule,
  tianapiAiModule,
  tianapiGuoneiModule,
  tianapiWorldModule,
  tianapiSocialModule,
  tianapiGeneralnewsModule,
  tianapiCaijingModule,
  tianapiInternetModule,
} from './tianapi-news';

const modules: Record<string, SearchModule> = {
  // Chinese domestic sources first (priority dedup order)
  metaso: metasoModule,
  weibo: weiboModule,
  zhihu: zhihuModule,
  xiaohongshu: xiaohongshuModule,
  serper: serperModule,
  wechat: wechatModule,
  'multi-engine': multiEngineModule,
  // tavily is only included in explicit "all+en" provider, not in default "all"
  tavily: tavilyModule,
  // Tianapi news modules (8 categories)
  'tianapi-keji': tianapiKejiModule,
  'tianapi-ai': tianapiAiModule,
  'tianapi-guonei': tianapiGuoneiModule,
  'tianapi-world': tianapiWorldModule,
  'tianapi-social': tianapiSocialModule,
  'tianapi-generalnews': tianapiGeneralnewsModule,
  'tianapi-caijing': tianapiCaijingModule,
  'tianapi-internet': tianapiInternetModule,
};

export function getSearchModule(name: string): SearchModule | undefined {
  return modules[name];
}

// "all" provider: Chinese-centric sources only
// tavily excluded (English dominance) + weibo excluded (low yield) + tianapi-* excluded (separate API quota)
export function getAllModules(): SearchModule[] {
  return Object.entries(modules)
    .filter(([name]) => name !== 'tavily' && name !== 'weibo' && !name.startsWith('tianapi-'))
    .map(([, mod]) => mod);
}

// "all+cn-news" provider: all sources including tianapi Chinese news (but NOT tavily English or weibo)
export function getAllModulesTianapi(): SearchModule[] {
  return Object.values(modules).filter((mod) => mod.name !== 'tavily' && mod.name !== 'weibo');
}

// "all+en" provider: all sources including English international (tavily, but NOT weibo)
export function getAllModulesIntl(): SearchModule[] {
  return Object.values(modules).filter((mod) => mod.name !== 'weibo');
}

export function hasSearchModule(name: string): boolean {
  return name in modules;
}
