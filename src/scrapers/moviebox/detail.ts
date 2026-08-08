import { ENDPOINTS } from '../../config/constants';
import { mobileGet } from './http';
import { ContentDetail, SeasonInfo, DubInfo, CastMember } from './types';
import { slugDeSujet } from '../../utils/detailSlug';

export async function fetchDetail(subjectId: string): Promise<ContentDetail> {
  const path = `${ENDPOINTS.detail}?subjectId=${subjectId}`;
  const json = await mobileGet(path, 'detail');
  const data = json?.data;
  const subject = data?.subject || data;

  if (!subject) {
    throw new Error('No subject data in response');
  }

  const type = subject.subjectType === 2 ? 'series' : 'movie';
  let seasons = extractSeasons(subject, data);
  // ⚠️ `subject-api/get` ne porte les saisons que dans `resource.seasons`, un
  // bloc que l'amont laisse vide sur beaucoup de fiches : la page détail
  // annonçait « 1 saison » dans l'en-tête (compté ailleurs) mais n'affichait
  // AUCUNE liste d'épisodes. L'endpoint `subject-api/season-info` répond
  // précisément à cette question, et `fetchSeasons()` qui l'interroge était
  // écrite depuis le début — simplement jamais appelée. On ne paie l'appel
  // supplémentaire que sur une série dont les saisons manquent.
  if (type === 'series' && seasons.length === 0) {
    seasons = await fetchSeasons(String(subject.subjectId || subjectId));
  }
  const dubs = extractDubs(data);
  const cast = extractCast(subject);

  return {
    subjectId: String(subject.subjectId || subjectId),
    // Slug requis par /stream : il n'existe qu'au bout de `detailUrl`.
    detailPath: slugDeSujet(subject, data),
    title: subject.title || 'Unknown',
    description: subject.description || subject.introduction || '',
    posterUrl: subject.cover?.url || '',
    backdropUrl: subject.stills?.url || subject.cover?.url,
    type,
    year: subject.releaseDate ? subject.releaseDate.substring(0, 4) : '',
    duration: subject.duration || undefined,
    genres: subject.genre ? subject.genre.split(',').map((g: string) => g.trim()) : [],
    country: subject.countryName || '',
    rating: subject.imdbRatingValue || '',
    imdbRating: subject.imdbRatingValue || '',
    seasons,
    dubs,
    cast,
    trailerUrl: subject.trailer?.videoAddress?.url || undefined,
    hasResource: subject.hasResource === true,
    freeEpisodes: data?.accessStrategy?.freeEpisodeCount ?? subject.freeNum ?? 2,
    vipLevel: data?.accessStrategy?.requiredVipLevel ?? 1,
  };
}

export async function fetchSeasons(subjectId: string): Promise<SeasonInfo[]> {
  try {
    const path = `${ENDPOINTS.seasonInfo}?subjectId=${subjectId}`;
    const json = await mobileGet(path, 'detail');
    const seasons = json?.data?.seasons || [];
    return seasons.map((s: any) => ({
      season: s.se || s.season || 1,
      maxEpisodes: s.maxEp || s.episodeCount || 0,
    }));
  } catch {
    return [];
  }
}

function extractSeasons(subject: any, data: any): SeasonInfo[] {
  const resource = data?.resource || subject?.resource;
  if (resource?.seasons) {
    return resource.seasons.map((s: any) => ({
      season: s.se || 1,
      maxEpisodes: s.maxEp || 0,
    }));
  }
  return [];
}

function extractDubs(data: any): DubInfo[] {
  const dubs = data?.dubs || data?.subject?.dubs || [];
  if (!Array.isArray(dubs)) return [];
  return dubs.map((d: any) => ({
    subjectId: String(d.subjectId || ''),
    language: d.lanName || 'Unknown',
    isOriginal: d.original === true,
  }));
}

function extractCast(subject: any): CastMember[] {
  const staff = subject?.staffList || [];
  if (!Array.isArray(staff)) return [];
  return staff.map((s: any) => ({
    name: s.name || '',
    character: s.character || '',
    avatarUrl: s.avatarUrl || undefined,
  }));
}
