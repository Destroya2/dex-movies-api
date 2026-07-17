export const API_BASE_URL = process.env.API_BASE_URL || 'https://api3.aoneroom.com';
export const API_H5_URL = process.env.API_H5_URL || 'https://h5-api.aoneroom.com';

// Hôte du site web MovieBox : sert les endpoints /wefeed-h5-bff/web/* (différents
// de l'API h5api-bff). On y trouve les recommandations par titre (detail-rec) et
// la liste directe des fichiers de téléchargement (download). Vérifié depuis Vercel.
export const API_WEB_URL = process.env.API_WEB_URL || 'https://h5.aoneroom.com';
export const API_WEB_MIRRORS: string[] = [
  'https://h5.aoneroom.com',
  'https://moviebox.ph',
];

// Hôtes miroirs du backend v2 (tous servent le même API h5api-bff).
// Testés depuis Vercel : h5-api.aoneroom.com et moviebox.ph répondent 200.
export const API_H5_MIRRORS: string[] = [
  'https://h5-api.aoneroom.com',
  'https://moviebox.ph',
];

// Pool d'hôtes de l'API mobile Android (v3). L'app essaie chaque hôte
// dans l'ordre jusqu'à obtenir une réponse. api3 = défaut, api4-6 + inmoviebox = fallback.
export const API_MOBILE_HOSTS: string[] = [
  'https://api3.aoneroom.com',
  'https://api4.aoneroom.com',
  'https://api5.aoneroom.com',
  'https://api6.aoneroom.com',
  'https://api.inmoviebox.com',
  'https://api4sg.aoneroom.com',
  'https://api6sg.aoneroom.com',
];

export const ENDPOINTS = {
  rankingList: '/wefeed-mobile-bff/tab/ranking-list',
  subjectList: '/wefeed-mobile-bff/subject-api/list',
  search: '/wefeed-mobile-bff/subject-api/search/v2',
  detail: '/wefeed-mobile-bff/subject-api/get',
  seasonInfo: '/wefeed-mobile-bff/subject-api/season-info',
  playInfo: '/wefeed-mobile-bff/subject-api/play-info',
  resource: '/wefeed-mobile-bff/subject-api/resource',
  tabOperating: '/wefeed-mobile-bff/tab-operating',
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
  // Endpoints du site web (hôte API_WEB_URL) : pas de token bearer requis,
  // juste le géo-spoof. Découverts via le repo script-hunter-moviebox-api.
  webDetailRec: '/wefeed-h5-bff/web/subject/detail-rec',
  webDownload: '/wefeed-h5-bff/web/subject/download',
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
  EDUCATION: 5,
  MUSIC: 6,
  ANIME: 7,
} as const;

export const TAB_IDS: Record<string, number> = {
  home: 0,
  movies: 1,
  series: 2,
  anime: 3,
  ranking: 4,
};

// IDs des onglets pour l'endpoint H5 /subject/filter (POST).
// Utilisé par la catégorie Explorer. Ces IDs sont différents des TAB_IDS
// de l'API mobile.
export const H5_FILTER_TAB_IDS: Record<string, number> = {
  trending: 0,
  movies: 2,
  series: 5,
  animation: 8,
};
