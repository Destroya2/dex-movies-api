import { Scraper, HomeResult, SearchResult, SuggestResult, DetailResult, StreamResult, RecommendResult, DownloadResult } from './base';
import { MovieBoxMobileScraper } from './moviebox/index';
import { MovieBoxH5Scraper } from './fallback/h5api';
import {
  tmdbDetail, tmdbSearch, isTmdbEnabled, TmdbMediaType,
  tmdbSeasonEpisodes, tmdbFindTvId, TmdbEpisodeInfo,
} from '../utils/tmdbCatalog';
import { enrichWithTmdb } from '../utils/tmdb';
import { bestMatch } from '../utils/titleMatch';
import { fallbackStream } from '../utils/streamFallback';
import { StreamRequest } from '../providers/types';
import { resolveStream, defaultDeadline } from '../providers/registry';
import { searchCatalog, CatalogProvider } from '../providers/catalogRegistry';
import { createMovieBoxProvider, piResolverProvider, vidcoreProvider } from '../providers/streamProviders';
import { logger } from '../middleware/logger';
import { recordBridgeResult } from '../middleware/metrics';

type ScraperMethod = 'home' | 'search' | 'suggest' | 'detail' | 'stream' | 'category';

/** Un id de catalogue TMDB, ex: "tmdb:movie:12345". */
interface ResolvedTmdb {
  subjectId: string;      // subjectId MovieBox réel
  detailPath?: string;    // slug MovieBox
  // Métadonnées TMDB déjà récupérées pendant la résolution : on les réutilise
  // pour écraser titre/poster/cover côté détail (voir detail() plus bas), afin
  // que l'écran de détail affiche TOUJOURS le même titre/visuel que la fiche
  // catalogue sur laquelle l'utilisateur a cliqué, même quand le matching de
  // titre a trouvé une édition MovieBox différente (doublon, autre film proche).
  tmdbMeta: {
    title: string; posterUrl: string; coverUrl?: string; plot?: string;
    genres?: string[]; rating?: string; year?: string; duration?: string; country?: string; cast?: string[];
    trailerKey?: string;
  };
}

// Un scraper peut répondre 200 avec des données vides (échec silencieux upstream).
// Dans ce cas on tente le scraper suivant au lieu de retourner du vide.
function isEmptyResult(method: ScraperMethod, data: any): boolean {
  switch (method) {
    case 'home': return !data?.sections?.length;
    case 'search': return !data?.items?.length;
    case 'suggest': return !Array.isArray(data) || data.length === 0;
    case 'detail': return !data?.title;
    case 'stream': return !data?.sources?.length;
    case 'category': return !data?.items?.length;
  }
}

export class ScraperEngine {
  private scrapers: Scraper[] = [];

  constructor() {
    // H5 = scraper primaire (tout le catalogue VF).
    this.register(new MovieBoxH5Scraper());
    // Mobile HMAC (scraper MovieBox original, un des 3 hacks vitaux du projet —
    // voir REGLES.md) est BLOQUÉ sur Vercel (Cloudflare / IP) : en prod il
    // n'apporte rien et ajoute de la latence pour un appel qui échoue. On ne
    // l'enregistre qu'en local via un flag, mais on NE LE SUPPRIME PAS.
    if (process.env.ENABLE_BLOCKED_SCRAPERS === '1') {
      this.register(new MovieBoxMobileScraper());
    }
  }

  register(scraper: Scraper): void {
    this.scrapers.push(scraper);
    this.scrapers.sort((a, b) => a.config.priority - b.config.priority);
  }

  private async execute<T>(
    method: ScraperMethod,
    fn: (scraper: Scraper) => Promise<T>,
    context: string
  ): Promise<{ data: T; source: string }> {
    const errors: { name: string; error: any }[] = [];
    let emptyResult: { data: T; source: string } | null = null;

    for (const scraper of this.scrapers) {
      try {
        const data = await fn(scraper);
        if (isEmptyResult(method, data)) {
          if (!emptyResult) emptyResult = { data, source: scraper.config.name };
          continue;
        }
        return { data, source: scraper.config.name };
      } catch (error: any) {
        errors.push({ name: scraper.config.name, error });
      }
    }

    // Tous vides mais aucun n'a levé d'erreur : résultat légitimement vide
    // (ex: recherche sans résultat, épisode sans stream)
    if (emptyResult) return emptyResult;

    throw new Error(
      `All scrapers failed for ${context}: ${errors.map(e => `${e.name}=${e.error?.message || String(e.error)}`).join(', ')}`
    );
  }

  // ─── Pont catalogue TMDB → sujet MovieBox ──────────────────────────────────
  // Cache des résolutions (tmdb:type:id → subjectId MovieBox) pour éviter de
  // re-chercher à chaque appel (stream/detail/download du même titre).
  private tmdbBridgeCache = new Map<string, ResolvedTmdb | null>();

  private isTmdbId(subjectId: string): boolean {
    return subjectId.startsWith('tmdb:');
  }

  /**
   * Résout un id catalogue `tmdb:type:id` vers un vrai sujet MovieBox :
   * TMDB detail (titre+année) → recherche MovieBox → matching de titre.
   * Retourne null si aucun sujet MovieBox ne correspond (→ contenu non VF/dispo).
   */
  private async resolveTmdb(subjectId: string): Promise<ResolvedTmdb | null> {
    if (this.tmdbBridgeCache.has(subjectId)) return this.tmdbBridgeCache.get(subjectId)!;

    const [, type, idStr] = subjectId.split(':');
    const id = parseInt(idStr);
    let resolved: ResolvedTmdb | null = null;
    try {
      const detail = await tmdbDetail((type as TmdbMediaType) || 'movie', id);
      if (detail?.title) {
        // Cherche MovieBox avec le titre FR ET le titre original (anglais souvent) :
        // MovieBox indexe selon l'un ou l'autre. On agrège les candidats et on
        // matche contre les deux titres pour maximiser la couverture.
        const queries = [detail.title];
        if (detail.originalTitle && detail.originalTitle !== detail.title) {
          queries.push(detail.originalTitle);
        }
        const candidates: any[] = [];
        const seen = new Set<string>();
        for (const q of queries) {
          try {
            const { data } = await this.search(q, 1);
            for (const it of data.items || []) {
              // ⚠️ CRUCIAL : depuis la fusion MovieBox+TMDB dans search(), les
              // résultats contiennent aussi des items `tmdb:type:id`. Le pont
              // cherche un sujet MOVIEBOX réel (pour la lecture) — il ne doit
              // JAMAIS retenir un id tmdb:, sinon on le repasse au scraper
              // MovieBox qui échoue (→ 500 sur /detail, aucune source sur
              // /stream). Le piège est sournois : on cherche par le titre TMDB
              // exact, donc le candidat TMDB est un match PARFAIT (score 1.08)
              // et bat systématiquement le vrai sujet MovieBox dont le titre
              // diffère un peu ("Supergirl" vs "Supergirl: Woman of Tomorrow").
              if (this.isTmdbId(it.subjectId)) continue;
              if (!seen.has(it.subjectId)) { seen.add(it.subjectId); candidates.push(it); }
            }
          } catch {}
        }
        // Meilleur match sur le titre FR, puis sur le titre original
        const match = bestMatch(detail.title, detail.year, candidates)
          || (detail.originalTitle ? bestMatch(detail.originalTitle, detail.year, candidates) : null);
        if (match) {
          resolved = {
            subjectId: match.item.subjectId,
            detailPath: match.item.detailPath,
            tmdbMeta: {
              title: detail.title, posterUrl: detail.posterUrl, coverUrl: detail.coverUrl,
              plot: detail.plot, genres: detail.genres, rating: detail.rating, year: detail.year,
              duration: detail.duration, country: detail.country, cast: detail.cast,
              trailerKey: detail.trailerKey,
            },
          };
          logger.info(`Bridge TMDB ${subjectId} ("${detail.title}") → MovieBox ${match.item.subjectId} (score ${match.score.toFixed(2)})`);
          recordBridgeResult(true);
        } else {
          logger.warn(`Bridge TMDB ${subjectId} ("${detail.title}"/"${detail.originalTitle || ''}") : aucun match MovieBox (${candidates.length} candidats)`);
          recordBridgeResult(false);
        }
      }
    } catch (e: any) {
      logger.warn(`Bridge TMDB ${subjectId} échec: ${e?.message || e}`);
    }
    this.tmdbBridgeCache.set(subjectId, resolved);
    if (this.tmdbBridgeCache.size > 500) this.tmdbBridgeCache.clear();
    return resolved;
  }

  async home(): Promise<{ data: HomeResult; source: string }> {
    return this.execute('home', (s) => s.home(), 'home');
  }

  /**
   * Recherche multi-source. Les sources sont COMPLÉMENTAIRES (on veut tout ce
   * que chacune sait), pas alternatives — elles sont donc interrogées **en
   * parallèle** par `catalogRegistry`. Avant, MovieBox puis TMDB en séquentiel :
   * leurs latences s'additionnaient sur la route déjà la plus lente du service.
   * Une source en panne dégrade désormais le résultat au lieu de le faire échouer.
   */
  async search(query: string, page: number = 1): Promise<{ data: SearchResult; source: string }> {
    const movieboxProvider: CatalogProvider = {
      name: 'moviebox',
      priority: 10, // en tête : badges VF fiables, seuls items réellement lisibles
      supports: () => true,
      search: async (q, p) => {
        const r = await this.execute('search', (s) => s.search(q, p), `search(${q})`);
        return (r.data.items || []).map((i: any) => ({ ...i, source: 'moviebox' }));
      },
    };

    const tmdbProvider: CatalogProvider = {
      name: 'tmdb',
      priority: 20,
      // ⚠️ Page 1 UNIQUEMENT : c'est une SECTION complémentaire (« Aussi
      // disponibles »), pas la suite de la liste MovieBox. `tmdbSearch` étant
      // toujours appelée avec la page 1, l'inclure au-delà réafficherait
      // exactement les 20 mêmes titres (doublons vérifiés en prod page1/page2).
      supports: (_q, p) => isTmdbEnabled() && p === 1,
      search: async (q) => {
        const t = await tmdbSearch(q, 1);
        return t.items.map((i: any) => ({ ...i, source: 'tmdb' })).slice(0, 20);
      },
    };

    const { items, degraded } = await searchCatalog(query, page, [movieboxProvider, tmdbProvider]);
    return {
      data: { items, total: items.length, page },
      // Une recherche servie sans MovieBox n'a pas la même valeur : on le dit.
      source: degraded.includes('moviebox') ? 'degraded' : 'moviebox-h5api',
    };
  }

  async suggest(query: string): Promise<{ data: SuggestResult[]; source: string }> {
    return this.execute('suggest', (s) => s.suggest(query), `suggest(${query})`);
  }

  async detail(subjectId: string): Promise<{ data: DetailResult; source: string }> {
    // Les fiches TMDB sont déjà servies par /catalog/detail ; ici on ne traite
    // que les subjectId MovieBox natifs. Un id tmdb: est résolu par sécurité.
    if (this.isTmdbId(subjectId)) {
      const r = await this.resolveTmdb(subjectId);
      // Pas de correspondance MovieBox (pas de lecture possible) : on renvoie quand
      // même les vraies métadonnées TMDB (titre/poster/synopsis/cast) plutôt qu'une
      // fiche vide, pour ne pas écraser côté app le fallback déjà affiché (infos de
      // la liste cliquée) par des champs blancs. Jamais de 500.
      if (!r) {
        const [, type, idStr] = subjectId.split(':');
        const tmdbType = (type as TmdbMediaType) || 'movie';
        const id = parseInt(idStr);
        let meta: Partial<DetailResult> = {};
        try {
          const detail = await tmdbDetail(tmdbType, id);
          if (detail?.title) {
            meta = {
              title: detail.title, posterUrl: detail.posterUrl, coverUrl: detail.coverUrl,
              plot: detail.plot, genres: detail.genres, rating: detail.rating, year: detail.year,
              duration: detail.duration, country: detail.country, cast: detail.cast,
              trailerKey: detail.trailerKey,
            };
          }
        } catch (e: any) {
          logger.warn(`Détail TMDB de secours "${subjectId}" échoué: ${e?.message || e}`);
        }
        return {
          data: {
            subjectId, detailPath: undefined, title: '', posterUrl: '',
            type: type === 'tv' ? 'series' : 'movie', dubs: [], freeEpisodes: 0,
            ...meta,
          } as DetailResult,
          source: meta.title ? 'tmdb' : 'none',
        };
      }
      const result = await this.execute('detail', (s) => s.detail(r.subjectId), `detail(${r.subjectId})`);
      // Le matching de titre peut trouver une édition MovieBox proche mais pas
      // identique (doublon, remake, "Director's Cut"...) : on garde ses données
      // de streaming (dubs, seasons, freeEpisodes) mais on force l'affichage
      // (titre/poster/synopsis...) sur les métadonnées TMDB exactes, celles déjà
      // vues par l'utilisateur sur la fiche catalogue cliquée. Merge champ par
      // champ (pas un simple spread) pour ne pas écraser une valeur MovieBox
      // valide par un undefined TMDB (ex: pas de backdrop sur ce titre).
      const meta = r.tmdbMeta;
      return {
        data: {
          ...result.data,
          title: meta.title ?? result.data.title,
          posterUrl: meta.posterUrl || result.data.posterUrl,
          coverUrl: meta.coverUrl ?? result.data.coverUrl,
          plot: meta.plot ?? result.data.plot,
          genres: meta.genres ?? result.data.genres,
          rating: meta.rating ?? result.data.rating,
          year: meta.year ?? result.data.year,
          duration: meta.duration ?? result.data.duration,
          country: meta.country ?? result.data.country,
          cast: meta.cast ?? result.data.cast,
          trailerKey: meta.trailerKey ?? result.data.trailerKey,
        },
        source: result.source,
      };
    }
    const result = await this.execute('detail', (s) => s.detail(subjectId), `detail(${subjectId})`);
    // Synopsis/casting MovieBox natif souvent absents ou pauvres (staffList/description
    // vides côté upstream) : on comble uniquement les trous via TMDB (recherche par
    // titre+année), sans jamais écraser une valeur MovieBox déjà présente. La bande-
    // annonce (trailerKey) n'existe JAMAIS côté upstream h5 → on enrichit aussi quand
    // elle manque, pour que la fiche puisse afficher le player de bande-annonce.
    // Best-effort : en cas d'échec (pas de match TMDB, API indisponible), on garde le
    // détail MovieBox tel quel plutôt que de faire échouer toute la fiche.
    if (!result.data.plot || !result.data.cast?.length || !result.data.trailerKey) {
      try {
        const enriched = await enrichWithTmdb(
          result.data.title,
          result.data.type === 'series' ? 'series' : 'movie',
          result.data.year
        );
        if (enriched) {
          result.data.plot = result.data.plot || enriched.overview || result.data.plot;
          result.data.cast = result.data.cast?.length ? result.data.cast : enriched.cast;
          result.data.genres = result.data.genres?.length ? result.data.genres : enriched.genres;
          result.data.rating = result.data.rating || (enriched.voteAverage ? String(enriched.voteAverage) : result.data.rating);
          result.data.trailerKey = result.data.trailerKey || enriched.trailerKey;
        }
      } catch (e: any) {
        logger.warn(`Enrichissement TMDB détail natif "${result.data.title}" échoué: ${e?.message || e}`);
      }
    }
    return result;
  }

  /**
   * Résolution d'un flux. Toutes les sources passent par le MÊME orchestrateur
   * (`providers/registry.ts`) : priorité, disjoncteur par provider, budget de
   * temps et métriques au même endroit. Avant, l'ordre était codé en dur ici et
   * dans `streamFallback.ts`, et rien ne mesurait quelle source servait vraiment.
   *
   * Le contrat de sortie est INCHANGÉ (`{ data: StreamResult, source }`) : les
   * clients Android et PWA ne voient aucune différence.
   */
  async stream(subjectId: string, season?: number, episode?: number, detailPath?: string): Promise<{ data: StreamResult; source: string }> {
    const isTmdb = this.isTmdbId(subjectId);
    const [, tType, tId] = isTmdb ? subjectId.split(':') : [];

    // Titre/année : seulement pour un id TMDB, et seulement parce que le
    // resolver Pi cherche par nom. Un appel de plus qu'on ne fait pas à vide.
    let title: string | undefined, year: string | undefined;
    if (isTmdb) {
      try {
        const det = await tmdbDetail((tType as TmdbMediaType) || 'movie', parseInt(tId));
        title = det?.title; year = det?.year;
      } catch { /* best-effort */ }
    }

    const req: StreamRequest = {
      subjectId,
      tmdbId: isTmdb ? tId : undefined,
      tmdbType: isTmdb ? ((tType as 'movie' | 'tv') || 'movie') : undefined,
      season, episode, detailPath, title, year,
      deadline: defaultDeadline(),
    };

    // MovieBox garde sa logique propre (pont TMDB + slug detailPath obligatoire),
    // exposée à l'orchestrateur comme un provider parmi les autres.
    const movieboxProvider = createMovieBoxProvider(async (r) => {
      let targetId = r.subjectId;
      let targetPath = r.detailPath;
      if (isTmdb) {
        const bridged = await this.resolveTmdb(r.subjectId);
        if (!bridged) return null; // pas de correspondance MovieBox : au suivant
        targetId = bridged.subjectId;
        targetPath = bridged.detailPath;
      }
      const mb = await this.execute('stream', (s) => s.stream(targetId, r.season, r.episode, targetPath), `stream(${targetId})`);
      return mb.data.sources.length > 0 ? (mb.data as any) : null;
    });

    const resolved = await resolveStream(req, [movieboxProvider, piResolverProvider, vidcoreProvider]);
    if (resolved) {
      const o = resolved.outcome;
      return {
        data: {
          sources: o.sources,
          dubs: o.dubs || [],
          subtitles: o.subtitles || [],
          hasResource: o.hasResource ?? true,
          freeEpisodes: o.freeEpisodes ?? 0,
          audioLanguage: o.audioLanguage,
        },
        // `moviebox` reste étiqueté par le scraper qui a répondu pour ne pas
        // casser les tableaux de bord existants ; les autres gardent leur nom.
        source: resolved.provider === 'moviebox' ? 'moviebox-h5api' : resolved.provider,
      };
    }
    return { data: { sources: [], dubs: [], subtitles: [], hasResource: false, freeEpisodes: 0 }, source: 'none' };
  }

  async category(tabId: string, page: number = 1): Promise<{ data: { items: any[]; page: number; hasMore: boolean }; source: string }> {
    return this.execute('category', (s) => s.category(tabId, page), `category(${tabId})`);
  }

  /** Recommandations « Pour vous » — premier scraper qui implémente la méthode. */
  async recommendations(subjectId: string, page: number = 1): Promise<{ data: RecommendResult; source: string }> {
    if (this.isTmdbId(subjectId)) {
      const r = await this.resolveTmdb(subjectId);
      if (!r) return { data: { items: [], page, hasMore: false }, source: 'none' };
      subjectId = r.subjectId;
    }
    for (const scraper of this.scrapers) {
      if (!scraper.recommendations) continue;
      try {
        const data = await scraper.recommendations(subjectId, page);
        if (data.items.length > 0) return { data, source: scraper.config.name };
      } catch {}
    }
    return { data: { items: [], page, hasMore: false }, source: 'none' };
  }

  // Pont INVERSE (sujet MovieBox natif → id TMDB série), pour les fiches qui
  // n'ont pas d'id `tmdb:`. Mémorisé : un même titre est rouvert souvent.
  private tvIdCache = new Map<string, number | null>();

  /**
   * Épisodes d'une saison enrichis par TMDB (titre, synopsis, vignette, durée).
   * L'upstream MovieBox ne donne que le NOMBRE d'épisodes par saison — tout le
   * reste vient de TMDB. Best-effort : liste vide si le titre n'est pas
   * identifiable côté TMDB, l'app retombe alors sur « Épisode N ».
   */
  async episodes(
    subjectId: string,
    season: number
  ): Promise<{ data: { season: number; episodes: TmdbEpisodeInfo[] }; source: string }> {
    const empty = { data: { season, episodes: [] as TmdbEpisodeInfo[] }, source: 'none' };
    if (!isTmdbEnabled()) return empty;

    let tvId: number | null = null;
    if (this.isTmdbId(subjectId)) {
      const [, type, idStr] = subjectId.split(':');
      if (type !== 'tv') return empty;
      tvId = parseInt(idStr) || null;
    } else if (this.tvIdCache.has(subjectId)) {
      tvId = this.tvIdCache.get(subjectId)!;
    } else {
      try {
        const { data } = await this.detail(subjectId);
        if (data.type === 'series' && data.title) {
          // Nombre total d'épisodes annoncé par MovieBox : sert à départager
          // les homonymes TMDB (série d'origine vs remake/live-action).
          const totalEpisodes = (data.seasons || [])
            .reduce((sum: number, s: any) => sum + (Number(s.maxEpisodes) || 0), 0);
          tvId = await tmdbFindTvId(data.title, totalEpisodes || undefined);
        }
      } catch (e: any) {
        logger.warn(`Épisodes: détail ${subjectId} indisponible (${e?.message || e})`);
      }
      this.tvIdCache.set(subjectId, tvId);
      if (this.tvIdCache.size > 500) this.tvIdCache.clear();
    }

    if (!tvId) return empty;
    const episodes = await tmdbSeasonEpisodes(tvId, season);
    return {
      data: { season, episodes },
      source: episodes.length ? 'tmdb' : 'none',
    };
  }

  /** Fichiers téléchargeables — premier scraper qui implémente la méthode. */
  async downloads(subjectId: string, season?: number, episode?: number, detailPath?: string): Promise<{ data: DownloadResult; source: string }> {
    if (this.isTmdbId(subjectId)) {
      const r = await this.resolveTmdb(subjectId);
      if (!r) return { data: { files: [], captions: [], hasResource: false }, source: 'none' };
      subjectId = r.subjectId;
      detailPath = r.detailPath;
    }
    const errors: string[] = [];
    for (const scraper of this.scrapers) {
      if (!scraper.downloads) continue;
      try {
        const data = await scraper.downloads(subjectId, season, episode, detailPath);
        if (data.files.length > 0) return { data, source: scraper.config.name };
      } catch (e: any) {
        errors.push(`${scraper.config.name}=${e?.message || e}`);
      }
    }
    // Aucun fichier : réponse vide légitime (contenu en direct uniquement)
    return { data: { files: [], captions: [], hasResource: false }, source: 'none' };
  }
}
