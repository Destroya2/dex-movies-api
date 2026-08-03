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
  language?: string;
  isFrench?: boolean;
  subtitleLangs?: string;
  // Clé vidéo YouTube de la bande-annonce (enrichissement TMDB, best-effort).
  trailerKey?: string;
}

export interface StreamResult {
  sources: any[];
  dubs: { subjectId: string; language: string }[];
  subtitles: any[];
  hasResource: boolean;
  freeEpisodes: number;
  // Langue audio connue avec certitude (pas une estimation) : 'fr' quand la
  // source vient de MovieBox (VF garantie) ou d'un provider VF identifié
  // (coflix), absent/'?' pour un provider dont on ne connaît pas la langue
  // réelle (vixsrc/vidcore, VO la plupart du temps mais jamais garanti).
  audioLanguage?: string;
}

export interface RecommendResult {
  items: any[];
  page: number;
  hasMore: boolean;
}

export interface DownloadResult {
  files: any[];
  captions: any[];
  hasResource: boolean;
}

export interface Scraper {
  config: ScraperConfig;
  home(page?: number): Promise<HomeResult>;
  search(query: string, page?: number): Promise<SearchResult>;
  suggest(query: string): Promise<SuggestResult[]>;
  detail(subjectId: string): Promise<DetailResult>;
  stream(subjectId: string, season?: number, episode?: number, detailPath?: string): Promise<StreamResult>;
  category(tabId: string, page?: number): Promise<{ items: any[]; page: number; hasMore: boolean }>;
  // Optionnels : implémentés par le scraper h5 (endpoints du site web)
  recommendations?(subjectId: string, page?: number): Promise<RecommendResult>;
  downloads?(subjectId: string, season?: number, episode?: number, detailPath?: string): Promise<DownloadResult>;
  isAvailable(): Promise<boolean>;
}
