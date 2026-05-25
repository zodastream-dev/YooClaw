import type { SearchModule } from './types';
import metasoModule from './metaso';
import tavilyModule from './tavily';
import multiEngineModule from './multi-engine';
import wechatModule from './wechat';

const modules: Record<string, SearchModule> = {
  metaso: metasoModule,
  tavily: tavilyModule,
  'multi-engine': multiEngineModule,
  wechat: wechatModule,
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
