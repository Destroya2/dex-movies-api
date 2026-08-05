import { audioTrackOf, orderByAudioTrack } from '../../src/utils/streamSources';

/**
 * Régression signalée le 05/08/2026 : « la série Lioness que tu as lancée parle
 * espagnol, pas français ».
 *
 * Les URL ci-dessous sont celles réellement renvoyées par
 * /api/dex/stream/1377981790605953880 ce jour-là.
 */
describe('utils/streamSources — pistes d\'origine avant doublages', () => {
  it('reconnaît un doublage à son chemin /tran-audio/', () => {
    expect(audioTrackOf('https://bcdnxw.hakunaymatata.com/tran-audio/20250526/new-0801.mp4')).toBe('translated');
    expect(audioTrackOf('https://bcdnxw.hakunaymatata.com/bt/3e08.mp4')).toBe('original');
    expect(audioTrackOf('https://bcdnxw.hakunaymatata.com/resource/9a58.mp4')).toBe('original');
    expect(audioTrackOf('')).toBe('original');
  });

  it('ne laisse pas un doublage 480p passer devant l\'original 360p', () => {
    const sources = [
      { url: 'https://bcdnxw.hakunaymatata.com/bt/3e08.mp4', quality: 360 },
      { url: 'https://bcdnxw.hakunaymatata.com/tran-audio/20250526/new-0801.mp4', quality: 480 },
    ];
    const triees = orderByAudioTrack(sources);

    // C'est précisément l'inversion qui faisait jouer l'espagnol.
    expect(triees[0].url).toContain('/bt/');
    expect(triees[0].quality).toBe(360);
    // Le doublage n'est pas supprimé, seulement déclassé : il reste lisible si
    // l'utilisateur choisit explicitement cette qualité.
    expect(triees).toHaveLength(2);
    expect(triees[1].url).toContain('/tran-audio/');
  });

  it('ne dégrade PAS la VF : elle est la piste normale de sa propre fiche', () => {
    // Fiche « Opérations spéciales : Lioness [Version française] » — ses deux
    // fichiers sont sous /bt/, aucun n'est marqué comme doublage.
    const vf = [
      { url: 'https://bcdnxw.hakunaymatata.com/bt/2d33.mp4', quality: 360 },
      { url: 'https://bcdnxw.hakunaymatata.com/bt/7f31.mp4', quality: 480 },
    ];
    const triees = orderByAudioTrack(vf);
    expect(triees.every((s) => audioTrackOf(s.url) === 'original')).toBe(true);
    // À piste égale, la meilleure définition reste en tête.
    expect(triees[0].quality).toBe(480);
  });

  it('respecte un audioTrack déjà posé par l\'appelant', () => {
    // Le scraper mobile connaît la langue par la fiche « dub » d'où vient la
    // source, même quand l'URL ne dit rien.
    const sources = [
      { url: 'https://x/a.mp4', quality: 1080, audioTrack: 'translated' as const },
      { url: 'https://x/b.mp4', quality: 480, audioTrack: 'original' as const },
    ];
    expect(orderByAudioTrack(sources)[0].quality).toBe(480);
  });
});
