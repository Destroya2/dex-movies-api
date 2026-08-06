import { ENDPOINTS } from '../../config/constants';
import { mobilePost } from './http';
import { SearchResult } from './types';

/**
 * Extrait les titres d'une réponse `search/v2`.
 *
 * ⚠️ `data.results[]` n'est PAS la liste des titres : c'est une liste de
 * BLOCS (`topicType`, `title`, `showMore`…), chacun portant ses titres dans
 * `subjects[]`. Relevé le 06/08/2026 : 4 blocs pour « naruto ». Lire
 * `results[]` comme des titres donnait donc systématiquement zéro résultat,
 * sans la moindre erreur — l'amont répondait `code: 0, message: "ok"`.
 */
function extraireSujets(json: any): any[] {
  const data = json?.data || {};
  const blocs: any[] = Array.isArray(data.results) ? data.results : [];
  const plats = blocs.flatMap((b: any) => (Array.isArray(b?.subjects) ? b.subjects : []));
  if (plats.length > 0) return plats;
  // Formes historiques, conservées au cas où l'amont change de nouveau.
  if (Array.isArray(data.items)) return data.items;
  return blocs;
}

export async function search(
  keyword: string,
  page: number = 1
): Promise<{ items: SearchResult[]; total: number; page: number }> {
  const body = { keyword, page, perPage: 20 };

  const json = await mobilePost(ENDPOINTS.search, body, 'search');
  const items: SearchResult[] = extraireSujets(json).map((item: any) => {
    const sub = item.subject || item;
    return {
      subjectId: String(sub.subjectId || ''),
      title: sub.title || 'Unknown',
      posterUrl: sub.cover?.url || '',
      type: (sub.subjectType === 2 ? 'series' : 'movie') as 'series' | 'movie',
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

    return extraireSujets(json).map((item: any) => {
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
