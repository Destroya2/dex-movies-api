/**
 * Choix de la piste audio parmi les sources d'une même fiche.
 *
 * MovieBox accroche parfois, sur une fiche, des fichiers dont l'audio a été
 * REMPLACÉ par un doublage — servis sous `/tran-audio/`. L'amont ne déclare
 * nulle part la langue de ce doublage.
 *
 * Relevé sur `Opérations spéciales : Lioness S1-S3` (05/08/2026) :
 *
 *   360p  …/bt/3e08…mp4                    ← anglais, la piste de la fiche
 *   480p  …/tran-audio/20250526/new-…mp4   ← espagnol, non déclaré
 *
 * Un client qui prend « la meilleure définition disponible » tombe donc sur
 * l'espagnol. C'est ce qui a été constaté à la lecture.
 *
 * ⚠️ Ceci ne concerne PAS la VF. Les fiches `[Version française]` sont des
 * sujets distincts et servent leur piste française sous `/bt/` — vérifié sur
 * `Opérations spéciales : Lioness [Version française]`, dont les deux fichiers
 * (360p et 480p) sont sous `/bt/`. Le classement ci-dessous ne les touche pas.
 */

export type AudioTrack = 'original' | 'translated';

/** Déduit la nature de la piste audio depuis l'URL du fichier. */
export function audioTrackOf(url: string): AudioTrack {
  return String(url || '').includes('/tran-audio/') ? 'translated' : 'original';
}

/**
 * Classe les sources : pistes d'origine d'abord, doublages ensuite ; à piste
 * égale, la meilleure définition d'abord.
 *
 * Les doublages ne sont pas supprimés — ils restent lisibles si l'utilisateur
 * choisit explicitement cette qualité — seulement déclassés, pour qu'aucune
 * sélection automatique ne les prenne par défaut.
 */
export function orderByAudioTrack<T extends { url?: string; quality?: number; audioTrack?: AudioTrack }>(
  sources: T[],
): T[] {
  return [...sources].sort((a, b) => {
    const at = (a.audioTrack ?? audioTrackOf(a.url || '')) === 'translated' ? 1 : 0;
    const bt = (b.audioTrack ?? audioTrackOf(b.url || '')) === 'translated' ? 1 : 0;
    if (at !== bt) return at - bt;
    return (b.quality || 0) - (a.quality || 0);
  });
}
