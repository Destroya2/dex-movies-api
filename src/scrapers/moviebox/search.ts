import { ENDPOINTS } from '../../config/constants';
import { mobilePost } from './http';
import { SearchResult } from './types';

export async function search(
  keyword: string,
  page: number = 1
): Promise<{ items: SearchResult[]; total: number; page: number }> {
  const body = { keyword, page, perPage: 20 };

  const json = await mobilePost(ENDPOINTS.search, body, 'search');
  const rawItems = json?.data?.results || json?.data?.items || [];
  const items: SearchResult[] = rawItems.map((item: any) => {
    const sub = item.subject || item;
    return {
      subjectId: String(sub.subjectId || ''),
      title: sub.title || 'Unknown',
      posterUrl: sub.cover?.url || '',
      type: sub.subjectType === 2 ? 'series' : 'movie',
      year: sub.releaseDate?.substring(0, 4),
      rating: sub.imdbRatingValue || undefined,
    };
  }).filter((r: SearchResult) => r.subjectId);

  const total = json?.data?.pager?.totalCount || json?.data?.total || items.length;

  return { items, total, page };
}

export async function suggest(keyword: string): Promise<{ title: string; subjectId: string }[]> {
  if (!keyword || keyword.length < 2) return [];

  try {
    const body = { keyword, page: 1, perPage: 5 };
    const json = await mobilePost(ENDPOINTS.search, body, 'search');
    const rawItems = json?.data?.results || json?.data?.items || [];

    return rawItems.map((item: any) => {
      const sub = item.subject || item;
      return {
        title: sub.title || '',
        subjectId: String(sub.subjectId || ''),
      };
    }).filter((s: { title: string }) => s.title);
  } catch {
    return [];
  }
}
