import { ENDPOINTS } from '../../config/constants';
import { mobileGet } from './http';
import { ContentDetail, SeasonInfo, DubInfo, CastMember } from './types';

export async function fetchDetail(subjectId: string): Promise<ContentDetail> {
  const path = `${ENDPOINTS.detail}?subjectId=${subjectId}`;
  const json = await mobileGet(path, 'detail');
  const data = json?.data;
  const subject = data?.subject || data;

  if (!subject) {
    throw new Error('No subject data in response');
  }

  const seasons = extractSeasons(subject, data);
  const dubs = extractDubs(data);
  const cast = extractCast(subject);

  return {
    subjectId: String(subject.subjectId || subjectId),
    title: subject.title || 'Unknown',
    description: subject.description || subject.introduction || '',
    posterUrl: subject.cover?.url || '',
    backdropUrl: subject.stills?.url || subject.cover?.url,
    type: subject.subjectType === 2 ? 'series' : 'movie',
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
