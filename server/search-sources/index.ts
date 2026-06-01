import type { SearchModule } from './types';
import metasoModule from './metaso';
import tavilyModule from './tavily';
import multiEngineModule from './multi-engine';
import wechatModule from './wechat';
import weiboModule from './weibo';
import zhihuModule from './zhihu';
import xiaohongshuModule from './xiaohongshu';

const modules: Record<string, SearchModule> = {
  // Chinese domestic sources first (priority dedup order)
  metaso: metasoModule,
  weibo: weiboModule,
  zhihu: zhihuModule,
  xiaohongshu: xiaohongshuModule,
  wechat: wechatModule,
  'multi-engine': multiEngineModule,
  // tavily is only included in explicit "all+en" provider, not in default "all"
  tavily: tavilyModule,
};

export function getSearchModule(name: string): SearchModule | undefined {
  return modules[name];
}

// "all" provider: Chinese-centric sources only (tavily excluded to avoid English dominance)
export function getAllModules(): SearchModule[] {
  return Object.entries(modules)
    .filter(([name]) => name !== 'tavily')
    .map(([, mod]) => mod);
}

// "all+en" provider: all sources including English international (tavily)
export function getAllModulesIntl(): SearchModule[] {
  return Object.values(modules);
}

export function hasSearchModule(name: string): boolean {
  return name in modules;
}
