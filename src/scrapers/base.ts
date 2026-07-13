export interface ScraperConfig {
  name: string;
  version: string;
  baseUrl: string;
  priority: number;
}

export interface HomeResult {
  sections: any[];
  tabs: any[];
}

export interface SearchResult {
  items: any[];
  total: number;
  page: number;
}

export interface SuggestResult {
  title: string;
  subjectId: string;
  detailPath?: string;
}

export interface DetailResult {
  subjectId: string;
  detailPath?: string;
  title: string;
  posterUrl: string;
  coverUrl?: string;
  type: string;
  year?: string;
  rating?: string;
  genres?: string[];
  plot?: string;
  duration?: string;
  country?: string;
  cast?: string[];
  dubs: { subjectId: string; language: string }[];
  seasons?: any[];
  freeEpisodes: number;
}

export interface StreamResult {
  sources: any[];
  dubs: { subjectId: string; language: string }[];
  subtitles: any[];
  hasResource: boolean;
  freeEpisodes: number;
}

export interface Scraper {
  config: ScraperConfig;
  home(page?: number): Promise<HomeResult>;
  search(query: string, page?: number): Promise<SearchResult>;
  suggest(query: string): Promise<SuggestResult[]>;
  detail(subjectId: string): Promise<DetailResult>;
  stream(subjectId: string, season?: number, episode?: number, detailPath?: string): Promise<StreamResult>;
  category(tabId: string, page?: number): Promise<{ items: any[]; page: number; hasMore: boolean }>;
  isAvailable(): Promise<boolean>;
}
