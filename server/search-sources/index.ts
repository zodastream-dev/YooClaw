import type { SearchModule } from './types';
import metasoModule from './metaso';
import tavilyModule from './tavily';
import multiEngineModule from './multi-engine';
import wechatModule from './wechat';
import weiboModule from './weibo';
import zhihuModule from './zhihu';
import xiaohongshuModule from './xiaohongshu';

const modules: Record<string, SearchModule> = {
  metaso: metasoModule,
  // Chinese social media sources first — claim dedup priority over global engines
  weibo: weiboModule,
  zhihu: zhihuModule,
  xiaohongshu: xiaohongshuModule,
  wechat: wechatModule,
  tavily: tavilyModule,
  'multi-engine': multiEngineModule,
};

export function getSearchModule(name: string): SearchModule | undefined {
  return modules[name];
}

export function getAllModules(): SearchModule[] {
  return Object.values(modules);
}

export function hasSearchModule(name: string): boolean {
  return name in modules;
}
