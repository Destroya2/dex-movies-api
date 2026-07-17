export const API_BASE_URL = process.env.API_BASE_URL || 'https://api3.aoneroom.com';
export const API_H5_URL = process.env.API_H5_URL || 'https://h5-api.aoneroom.com';

// Hôtes miroirs du backend v2 (tous servent le même API h5api-bff).
// Testés depuis Vercel : h5-api.aoneroom.com et moviebox.ph répondent 200.
export const API_H5_MIRRORS: string[] = [
  'https://h5-api.aoneroom.com',
  'https://moviebox.ph',
];

export const ENDPOINTS = {
  rankingList: '/wefeed-mobile-bff/tab/ranking-list',
  subjectList: '/wefeed-mobile-bff/subject-api/list',
  search: '/wefeed-mobile-bff/subject-api/search/v2',
  detail: '/wefeed-mobile-bff/subject-api/get',
  seasonInfo: '/wefeed-mobile-bff/subject-api/season-info',
  playInfo: '/wefeed-mobile-bff/subject-api/play-info',
  streamCaptions: '/wefeed-mobile-bff/subject-api/get-stream-captions',
  extCaptions: '/wefeed-mobile-bff/subject-api/get-ext-captions',
  h5Home: '/wefeed-h5api-bff/home',
  h5Search: '/wefeed-h5api-bff/subject/search',
  h5SearchSuggest: '/wefeed-h5api-bff/subject/search-suggest',
  h5Detail: '/wefeed-h5api-bff/detail',
  h5PlayDomain: '/wefeed-h5api-bff/media-player/get-domain',
  h5Play: '/wefeed-h5api-bff/subject/play',
  h5Trending: '/wefeed-h5api-bff/subject/trending',
  h5Filter: '/wefeed-h5api-bff/subject/filter',
  h5Caption: '/wefeed-h5api-bff/subject/caption',
};

export const CDN_DOMAINS = [
  'bcdnxw.hakunaymatata.com',
  'valiw.hakunaymatata.com',
  'bcdnw.hakunaymatata.com',
  'sacdn.hakunaymatata.com',
  'netfilm.world',
];

export const SUBJECT_TYPE = {
  ALL: 0,
  MOVIE: 1,
  TV_SERIES: 2,
  MUSIC: 6,
} as const;
