import { ENDPOINTS } from '../../config/constants';
import { acquireBearerToken } from './http';
import { mobileApiGetAs } from '../../utils/mobileApi';
import { StreamSource, SubtitleTrack, DubInfo } from './types';
import { fetchDetail } from './detail';
import { classifyAudioTracks, isTranslatedUrl, orderByAudioTrack } from '../../utils/streamSources';

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

  // ⚠️ `dubs` CONTIENT la fiche d'origine elle-même, marquée `isOriginal: true`
  // et libellée « Original Audio ». La lister en plus du sujet appelant la
  // faisait interroger deux fois : la même piste apparaissait en double, et la
  // seconde copie était étiquetée « doublage » puisque son libellé n'est pas
  // exactement « Original ». On dédoublonne par subjectId et on se fie au
  // drapeau `isOriginal` fourni par l'amont plutôt qu'au libellé.
  const vus = new Set<string>();
  const subjectIds: { id: string; language: string }[] = [];
  const ajouter = (id: string, language: string) => {
    if (!id || vus.has(id)) return;
    vus.add(id);
    subjectIds.push({ id, language });
  };
  ajouter(subjectId, 'Original');
  for (const d of dubs) {
    ajouter(d.subjectId, d.isOriginal ? 'Original' : d.language);
  }

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
    // Doublages de langue inconnue déclassés — voir utils/streamSources.ts.
    sources: orderByAudioTrack(classifyAudioTracks(allSources)),
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

  // Passe par le transport partagé (pool d'hôtes + bascule sur le relais Pi) :
  // l'appel direct est bloqué depuis Vercel, c'est ce qui rendait ce scraper
  // inutilisable en production.
  {
    try {
      const response = await mobileApiGetAs(path, token, {
        'X-Play-Mode': '1',
        'X-Idle-Data': '1',
        'X-Family-Mode': '0',
        'X-Content-Mode': '0',
      });
      if (!response) return { sources: [], subtitles: [] };
      if (response.status === 401 || response.status === 403 || response.status === 441) {
        if (retryCount < 1) {
          const freshToken = await acquireBearerToken(subjectId, true);
          return fetchPlayInfo(subjectId, season, episode, freshToken, language, retryCount + 1);
        }
        return { sources: [], subtitles: [] };
      }
      if (response.status !== 200) return { sources: [], subtitles: [] };

      const json = JSON.parse(response.body);
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
        // Deux façons d'être un doublage : venir d'un sujet « dub »
        // (la boucle appelante nous passe alors sa langue), ou être un remux
        // audio servi sous /tran-audio/ sur le sujet d'origine.
        // Une source venue d'une fiche « dub » est un doublage par
        // construction, quelle que soit son URL. Sinon on laisse
        // classifyAudioTracks trancher, vue d'ensemble de la fiche en main.
        audioTrack: (language !== 'Original' || isTranslatedUrl(s.url || '')
          ? 'translated'
          : undefined) as 'translated' | undefined,
        // Libellé brut de l'amont : c'est lui qui permet d'écrire « espagnol »
        // dans le sélecteur de qualité plutôt que « autre langue ».
        audioLabel: language !== 'Original' ? language : undefined,
      })).filter((s: StreamSource) => s.url);

      const subtitles = await fetchCaptions(subjectId, streams[0]?.id || '', token, language);

      return { sources, subtitles };
    } catch {
      return { sources: [], subtitles: [] };
    }
  }
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
      {
        try {
          const response = await mobileApiGetAs(path, token);

          if (response && response.status === 200) {
            const json = JSON.parse(response.body);
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
