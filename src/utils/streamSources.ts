/**
 * Choix de la piste audio parmi les sources d'une même fiche.
 *
 * MovieBox accroche parfois, sur une fiche, des fichiers dont l'audio a été
 * REMPLACÉ par un doublage — servis sous `/tran-audio/`. Payload brut relevé le
 * 05/08/2026 sur `Lioness S3` (subjectId 1377981790605953880, catalogue
 * anglophone), champ par champ :
 *
 *   streams  360   /bt/3e08….mp4                    120 Mo
 *   streams  480   /tran-audio/20250526/new-….mp4   198 Mo
 *   streams  1080  /tran-audio/…mp4                 742 Mo
 *   hls      480   (repackage adaptatif)            125 Mo
 *
 * Aucun champ de langue nulle part : ni `lan`, ni `language`, ni `audioLan`.
 * Le seul indice est le segment `/tran-audio/` dans l'URL. Sur cette fiche, la
 * SEULE piste d'origine est donc le 360p — tout ce qui est au-dessus est doublé
 * (constaté à l'oreille : espagnol).
 *
 * Conséquence pour le flux adaptatif : il est construit sur la même échelle de
 * rendus. Sur une fiche qui contient des doublages, on ne peut pas affirmer
 * qu'il porte la piste d'origine — c'est précisément lui qui jouait l'espagnol.
 * D'où trois états et non deux.
 *
 * ⚠️ Ceci ne concerne PAS la VF, et ne doit jamais la concerner. Les fiches
 * `[Version française]` sont des sujets distincts qui servent leur piste
 * française en fichier direct : vérifié sur `Opérations spéciales : Lioness
 * [Version française]`, dont les deux fichiers sont sous `/bt/` et qui ne
 * contient aucun `/tran-audio/`. Sur une fiche sans doublage, la règle
 * ci-dessous ne change strictement rien.
 */

export type AudioTrack = 'original' | 'unknown' | 'translated';

/** Un fichier direct sous `/tran-audio/` est un doublage. */
export function isTranslatedUrl(url: string): boolean {
  return String(url || '').includes('/tran-audio/');
}

/**
 * Un flux adaptatif ne pointe pas sur un fichier : c'est un manifeste
 * (`playstream.m3u8` / `.mpd`) qui masque le rendu réellement servi.
 */
export function isAdaptiveUrl(url: string): boolean {
  const u = String(url || '');
  return u.includes('.m3u8') || u.includes('.mpd') || u.includes('playstream');
}

/**
 * Qualifie chaque source d'une MÊME fiche. À faire d'un bloc : le statut du
 * flux adaptatif dépend de la présence, ou non, de doublages autour de lui.
 */
export function classifyAudioTracks<T extends { url?: string; format?: string; audioTrack?: AudioTrack }>(
  sources: T[],
): (T & { audioTrack: AudioTrack })[] {
  const ficheDoublee = sources.some((s) => isTranslatedUrl(s.url || ''));

  return sources.map((s) => {
    // Déjà qualifié par l'appelant (API mobile : la fiche « dub » d'origine).
    if (s.audioTrack) return s as T & { audioTrack: AudioTrack };
    const url = s.url || '';
    let audioTrack: AudioTrack;
    if (isTranslatedUrl(url)) {
      audioTrack = 'translated';
    } else if (isAdaptiveUrl(url) || s.format === 'HLS' || s.format === 'DASH') {
      // Sur une fiche sans aucun doublage — le cas courant, et celui de toutes
      // les fiches VF — l'adaptatif est la piste normale : rien ne change.
      audioTrack = ficheDoublee ? 'unknown' : 'original';
    } else {
      audioTrack = 'original';
    }
    return { ...s, audioTrack };
  });
}

const RANG: Record<AudioTrack, number> = { original: 0, unknown: 1, translated: 2 };

/**
 * Classe les sources : piste d'origine d'abord, puis langue incertaine, puis
 * doublage ; à statut égal, la meilleure définition d'abord.
 *
 * Rien n'est supprimé — un doublage reste lisible si l'utilisateur choisit
 * explicitement cette qualité — seulement déclassé, pour qu'aucune sélection
 * automatique ne le prenne par défaut.
 */
export function orderByAudioTrack<T extends { url?: string; quality?: number; audioTrack?: AudioTrack }>(
  sources: T[],
): T[] {
  return [...sources].sort((a, b) => {
    const ra = RANG[a.audioTrack ?? 'original'];
    const rb = RANG[b.audioTrack ?? 'original'];
    if (ra !== rb) return ra - rb;
    return (b.quality || 0) - (a.quality || 0);
  });
}
