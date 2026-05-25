// server/search-sources/types.ts
export interface RawSearchItem {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}

export interface SearchModule {
  name: string;
  label: string;
  search(query: string, apiKey: string): Promise<RawSearchItem[]>;
}
