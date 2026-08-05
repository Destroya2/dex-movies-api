/**
 * Contrat commun à toutes les sources de FLUX vidéo.
 *
 * Avant, la résolution d'un flux était éparpillée : une branche `tmdb:` dans
 * `ScraperEngine.stream`, une chaîne de repli codée en dur dans
 * `streamFallback.ts`, et des `try/catch` imbriqués. Ajouter une source
 * demandait de toucher trois endroits, et rien ne mesurait laquelle servait
 * réellement. Ce contrat rend chaque source autonome et interchangeable.
 */

export interface StreamRequest {
  /** Id natif MovieBox, ou id catalogue `tmdb:<type>:<id>`. */
  subjectId: string;
  /** Renseignés quand la demande vient du catalogue TMDB. */
  tmdbId?: string;
  tmdbType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  /** Slug MovieBox — obligatoire pour lire chez MovieBox (hack vital du projet). */
  detailPath?: string;
  /** Titre/année : utiles aux providers qui cherchent par nom (resolver Pi). */
  title?: string;
  year?: string;
  /**
   * Échéance absolue (epoch ms). Le budget total d'une requête est borné par le
   * `maxDuration` Vercel (30 s) : un provider qui traîne ne doit pas empêcher
   * d'essayer les suivants, ni faire tomber la requête en 504.
   */
  deadline: number;
}

export interface StreamSource {
  url: string;
  format: string;
  quality: number;
  size?: number;
  duration?: number;
  codec?: string;
  signCookie?: string;
  /**
   * Piste audio du fichier.
   *
   * `'translated'` = doublage ajouté par MovieBox sur une fiche dont la langue
   * d'origine est autre (fichiers servis sous `/tran-audio/`). La langue de ce
   * doublage n'est PAS indiquée par l'amont : ce peut être de l'espagnol, du
   * portugais, du hindi. Sans cette distinction, un client qui choisit « la
   * meilleure définition » tombe dessus dès qu'elle dépasse l'originale — c'est
   * ce qui faisait jouer Lioness en espagnol (360p original, 480p doublé).
   *
   * Les fiches marquées `[Version française]` sont des SUJETS distincts : leur
   * piste française est leur piste normale (`/bt/`), donc `'original'`. Ce
   * champ ne les dégrade pas.
   */
  audioTrack?: 'original' | 'translated';
}

export interface StreamSubtitle {
  url: string;
  language: string;
}

export interface StreamOutcome {
  sources: StreamSource[];
  subtitles: StreamSubtitle[];
  dubs?: { subjectId: string; language: string }[];
  hasResource?: boolean;
  freeEpisodes?: number;
  /**
   * Langue audio connue avec CERTITUDE ('fr' / 'vo'), jamais une estimation
   * optimiste : l'app affiche un badge VF à partir de ça.
   */
  audioLanguage?: string;
}

export interface StreamProvider {
  /** Identifiant stable — sert de clé de disjoncteur et d'étiquette de métrique. */
  name: string;
  /** Ordre d'essai : le plus petit d'abord. La VF garantie passe avant la VO. */
  priority: number;
  /**
   * Ce provider peut-il traiter cette demande ? (ex: le resolver Pi exige un id
   * TMDB, MovieBox exige un subjectId natif ou un slug). Évite de brûler du
   * budget sur des appels voués à l'échec.
   */
  supports(req: StreamRequest): boolean;
  /** `null` ou sources vides = « je n'ai pas ce titre », pas une panne. */
  resolve(req: StreamRequest): Promise<StreamOutcome | null>;
}

export function isUsable(outcome: StreamOutcome | null | undefined): outcome is StreamOutcome {
  return Boolean(outcome && Array.isArray(outcome.sources) && outcome.sources.length > 0);
}
