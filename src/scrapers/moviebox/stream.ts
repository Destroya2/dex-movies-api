import { buildSignedHeaders } from '../../utils/headers';
import { request } from '../../utils/http';
import { API_MOBILE_HOSTS, ENDPOINTS } from '../../config/constants';
import { acquireBearerToken, mobileUrl } from './http';
import { StreamSource, SubtitleTrack, DubInfo } from './types';
import { fetchDetail } from './detail';

export interface StreamResult {
  sources: StreamSource[];
  dubs: DubInfo[];
  subtitles: SubtitleTrack[];
  hasResource: boolean;
  freeEpisodes: number;
}

export async function fetchStream(
  subjectId: string,
  season?: number,
  episode?: number
): Promise<StreamResult> {
  const se = season || 1;
  const ep = episode || 1;

  const detail = await fetchDetail(subjectId);
  const dubs = detail.dubs;

  const allSources: StreamSource[] = [];
  const allSubtitles: SubtitleTrack[] = [];

  const subjectIds: { id: string; language: string }[] = [
    { id: subjectId, language: 'Original' },
    ...dubs.map(d => ({ id: d.subjectId, language: d.language })),
  ];

  for (const { id, language } of subjectIds) {
    try {
      const token = await acquireBearerToken(id);
      const result = await fetchPlayInfo(id, se, ep, token, language);
      allSources.push(...result.sources);
      allSubtitles.push(...result.subtitles);
    } catch {
      continue;
    }
  }

  return {
    sources: allSources,
    dubs,
    subtitles: allSubtitles,
    hasResource: allSources.length > 0,
    freeEpisodes: detail.freeEpisodes,
  };
}

async function fetchPlayInfo(
  subjectId: string,
  season: number,
  episode: number,
  token: string,
  language: string,
  retryCount: number = 0
): Promise<{ sources: StreamSource[]; subtitles: SubtitleTrack[] }> {
  const path = `${ENDPOINTS.playInfo}?subjectId=${subjectId}&se=${season}&ep=${episode}`;
  const hosts = [...API_MOBILE_HOSTS];

  for (const host of hosts) {
    try {
      const url = mobileUrl(path, host);
      const headers = buildSignedHeaders({
        url,
        token,
        extraHeaders: {
          'X-Play-Mode': '1',
          'X-Idle-Data': '1',
          'X-Family-Mode': '0',
          'X-Content-Mode': '0',
        },
      });

      const response = await request(url, { headers });
      if (response.status === 401 || response.status === 403) {
        if (retryCount < 1) {
          const freshToken = await acquireBearerToken(subjectId, true);
          return fetchPlayInfo(subjectId, season, episode, freshToken, language, retryCount + 1);
        }
        return { sources: [], subtitles: [] };
      }
      if (response.status !== 200) continue;

      const json = await response.json();
      const playData = json?.data;
      const streams = playData?.streams || [];

      const sources: StreamSource[] = streams.map((s: any) => ({
        url: s.url || '',
        format: detectFormat(s.url || '', s.format || ''),
        quality: parseQuality(s.resolutions || ''),
        size: s.size ? Number(s.size) : undefined,
        duration: s.duration ? Number(s.duration) : undefined,
        codec: s.codecName || 'h264',
        signCookie: s.signCookie || undefined,
      })).filter((s: StreamSource) => s.url);

      const subtitles = await fetchCaptions(subjectId, streams[0]?.id || '', token, language);

      return { sources, subtitles };
    } catch {
      continue;
    }
  }

  return { sources: [], subtitles: [] };
}

async function fetchCaptions(
  subjectId: string,
  streamId: string,
  token: string,
  language: string
): Promise<SubtitleTrack[]> {
  const tracks: SubtitleTrack[] = [];

  const captionEndpoints = [
    `${ENDPOINTS.streamCaptions}?subjectId=${subjectId}&streamId=${streamId}`,
    `${ENDPOINTS.extCaptions}?subjectId=${subjectId}&resourceId=${streamId}&episode=0`,
  ];

  for (const path of captionEndpoints) {
    try {
      const hosts = [...API_MOBILE_HOSTS];
      for (const host of hosts) {
        try {
          const url = mobileUrl(path, host);
          const headers = buildSignedHeaders({ url, token, accept: '', contentType: '' });
          const response = await request(url, { headers });

          if (response.status === 200) {
            const json = await response.json();
            const captions = json?.data?.extCaptions || [];
            for (const cap of captions) {
              tracks.push({
                url: cap.url || '',
                language: `${cap.language || cap.lanName || cap.lan || 'Unknown'} (${language})`,
              });
            }
          }
          break;
        } catch {
          continue;
        }
      }
    } catch {}
  }

  return tracks;
}

function detectFormat(url: string, formatHint: string): 'MP4' | 'HLS' | 'DASH' {
  if (url.includes('.mpd') || formatHint === 'DASH') return 'DASH';
  if (url.endsWith('.m3u8') || formatHint === 'HLS') return 'HLS';
  if (url.includes('.mp4') || url.includes('.mkv')) return 'MP4';
  return 'MP4';
}

function parseQuality(resolutions: string): number {
  const match = resolutions.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}
