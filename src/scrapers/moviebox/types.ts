export interface HomeSection {
  id: string;
  title: string;
  type: 'banner' | 'row' | 'grid';
  items: ContentItem[];
}

export interface ContentItem {
  subjectId: string;
  title: string;
  posterUrl: string;
  type: 'movie' | 'series';
  rating?: string;
  year?: string;
  badge?: string;
  /** Slug MovieBox, requis par /stream. L'amont ne le donne que dans `detailUrl`. */
  detailPath?: string;
  /** Image paysage (bannières). */
  coverUrl?: string;
  genres?: string[];
  plot?: string;
  country?: string;
  /** Marqueurs de langue déduits de `corner` (« En français », « VOSTFR »…). */
  isFrench?: boolean;
  language?: string;
}

export interface ContentDetail {
  subjectId: string;
  title: string;
  description: string;
  posterUrl: string;
  backdropUrl?: string;
  type: 'movie' | 'series';
  year: string;
  duration?: string;
  genres: string[];
  country: string;
  rating: string;
  imdbRating: string;
  seasons: SeasonInfo[];
  dubs: DubInfo[];
  cast: CastMember[];
  trailerUrl?: string;
  hasResource: boolean;
  freeEpisodes: number;
  vipLevel: number;
}

export interface SeasonInfo {
  season: number;
  maxEpisodes: number;
}

export interface DubInfo {
  subjectId: string;
  language: string;
  isOriginal: boolean;
}

export interface CastMember {
  name: string;
  character: string;
  avatarUrl?: string;
}

export interface StreamSource {
  url: string;
  format: 'MP4' | 'HLS' | 'DASH';
  quality: number;
  size?: number;
  duration?: number;
  codec?: string;
  signCookie?: string;
  /** Voir providers/types.ts — 'translated' = doublage de langue inconnue. */
  audioTrack?: 'original' | 'unknown' | 'translated';
  /** Langue déclarée par l'amont (« esla dub »…). Voir providers/types.ts. */
  audioLabel?: string;
}

export interface SubtitleTrack {
  url: string;
  language: string;
}

export interface SearchResult {
  subjectId: string;
  /** Slug requis par /stream — jamais optionnel côté app. */
  detailPath?: string;
  title: string;
  posterUrl: string;
  type: 'movie' | 'series';
  year?: string;
  rating?: string;
  /** Badge de langue affiché sur l'affiche ("VF" / "VOSTFR"). */
  language?: string;
  isFrench?: boolean;
  /** Libellé `corner` upstream, tel quel ("En français"…). */
  badge?: string;
}

export interface CategoryContent {
  items: ContentItem[];
  total: number;
  page: number;
  hasMore: boolean;
}
