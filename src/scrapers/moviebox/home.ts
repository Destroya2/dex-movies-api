import { buildSignedHeaders } from '../../utils/headers';
import { request } from '../../utils/http';
import { API_BASE_URL, ENDPOINTS } from '../../config/constants';
import { HomeSection, ContentItem, CategoryContent } from './types';

const HOME_TABS: Record<string, string> = {
  '4516404531735022304': 'Trending',
  '5692654647815587592': 'Trending in Cinema',
  '414907768299210008': 'Bollywood',
  '3859721901924910512': 'South Indian',
  '8019599703232971616': 'Hollywood',
  '4741626294545400336': 'Top Series This Week',
  '8434602210994128512': 'Anime',
  '1255898847918934600': 'Reality TV',
  '4903182713986896328': 'Indian Drama',
  '7878715743607948784': 'Korean Drama',
  '8788126208987989488': 'Chinese Drama',
  '3910636007619709856': 'Western TV',
  '5177200225164885656': 'Turkish Drama',
};

export async function fetchHomepage(): Promise<HomeSection[]> {
  const sections: HomeSection[] = [];

  for (const [tabId, title] of Object.entries(HOME_TABS).slice(0, 6)) {
    try {
      const url = `${API_BASE_URL}${ENDPOINTS.rankingList}?tabId=0&categoryType=${tabId}&page=1&perPage=15`;
      const headers = buildSignedHeaders({ url, profile: 'home' });

      const response = await request(url, { headers });
      if (response.status !== 200) continue;

      const json = await response.json();
      const items = parseTabResponse(json, tabId);

      if (items.length > 0) {
        sections.push({ id: tabId, title, type: 'row', items });
      }
    } catch {
      continue;
    }
  }

  return sections;
}

export async function fetchCategoryTabs(): Promise<{ id: string; title: string }[]> {
  return Object.entries(HOME_TABS).map(([id, title]) => ({ id, title }));
}

export async function fetchCategoryContent(
  tabId: string,
  page: number = 1
): Promise<CategoryContent> {
  const url = `${API_BASE_URL}${ENDPOINTS.rankingList}?tabId=0&categoryType=${tabId}&page=${page}&perPage=20`;
  const headers = buildSignedHeaders({ url, profile: 'home' });

  const response = await request(url, { headers });
  if (response.status !== 200) {
    throw new Error(`Category fetch failed: ${response.status}`);
  }

  const json = await response.json();
  const rawItems = json?.data?.items || json?.data?.subjects || [];
  const items = rawItems.map(mapToContentItem).filter(Boolean) as ContentItem[];

  return {
    items,
    total: json?.data?.pager?.totalCount || items.length,
    page,
    hasMore: items.length >= 20,
  };
}

function parseTabResponse(json: any, _tabId: string): ContentItem[] {
  const raw = json?.data?.items || json?.data?.subjects || [];
  return raw.map(mapToContentItem).filter(Boolean) as ContentItem[];
}

function mapToContentItem(item: any): ContentItem | null {
  if (!item) return null;
  const subject = item.subject || item;
  const subjectId = subject.subjectId || item.subjectId;
  if (!subjectId) return null;

  return {
    subjectId: String(subjectId),
    title: subject.title || item.title || 'Unknown',
    posterUrl: subject.cover?.url || item.cover?.url || '',
    type: (subject.subjectType === 2 || item.subjectType === 2) ? 'series' : 'movie',
    rating: subject.imdbRatingValue || item.imdbRatingValue || undefined,
    year: subject.releaseDate ? subject.releaseDate.substring(0, 4) : undefined,
    badge: subject.corner || item.corner || undefined,
  };
}
