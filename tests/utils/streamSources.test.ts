import {
  isTranslatedUrl,
  isAdaptiveUrl,
  classifyAudioTracks,
  orderByAudioTrack,
} from '../../src/utils/streamSources';

/**
 * Régression signalée le 05/08/2026 : « la série Lioness que tu as lancée parle
 * espagnol ». Les données ci-dessous sont le payload BRUT de
 * /wefeed-h5api-bff/subject/play pour subjectId=1377981790605953880, relevé le
 * même jour — pas des valeurs inventées pour le test.
 */
const LIONESS_S3 = [
  { url: 'https://bcdnxw.hakunaymatata.com/bt/3e08.mp4', format: 'MP4', quality: 360 },
  { url: 'https://bcdnxw.hakunaymatata.com/tran-audio/20250526/new-0801.mp4', format: 'MP4', quality: 480 },
  { url: 'https://bcdnxw.hakunaymatata.com/tran-audio/8415.mp4', format: 'MP4', quality: 1080 },
  { url: 'https://h5-api.aoneroom.com/playstream.m3u8?q=xxx', format: 'HLS', quality: 480 },
];

/** Fiche « Opérations spéciales : Lioness [Version française] », même relevé. */
const LIONESS_VF = [
  { url: 'https://bcdnxw.hakunaymatata.com/bt/2d33.mp4', format: 'MP4', quality: 360 },
  { url: 'https://bcdnxw.hakunaymatata.com/bt/7f31.mp4', format: 'MP4', quality: 480 },
  { url: 'https://h5-api.aoneroom.com/playstream.mpd?q=yyy', format: 'DASH', quality: 1080 },
];

describe('utils/streamSources — la langue prime sur la définition', () => {
  it('reconnaît un doublage à son chemin, un manifeste à son extension', () => {
    expect(isTranslatedUrl('https://x/tran-audio/a.mp4')).toBe(true);
    expect(isTranslatedUrl('https://x/bt/a.mp4')).toBe(false);
    expect(isTranslatedUrl('')).toBe(false);
    expect(isAdaptiveUrl('https://h5-api.aoneroom.com/playstream.m3u8?q=z')).toBe(true);
    expect(isAdaptiveUrl('https://x/bt/a.mp4')).toBe(false);
  });

  it('sur Lioness S3, ne retient que le 360p : tout le reste est doublé ou incertain', () => {
    const triees = orderByAudioTrack(classifyAudioTracks(LIONESS_S3));

    // Le 1080p et le 480p sont sous /tran-audio/ ; le HLS masque quel rendu il
    // sert et cohabite avec des doublages — c'est LUI qui jouait l'espagnol.
    expect(triees[0].quality).toBe(360);
    expect(triees[0].audioTrack).toBe('original');
    expect(triees[0].url).toContain('/bt/');

    const parUrl = Object.fromEntries(
      classifyAudioTracks(LIONESS_S3).map((s) => [s.url, s.audioTrack]),
    );
    expect(parUrl['https://h5-api.aoneroom.com/playstream.m3u8?q=xxx']).toBe('unknown');
    expect(parUrl['https://bcdnxw.hakunaymatata.com/tran-audio/8415.mp4']).toBe('translated');

    // Rien n'est supprimé : les 4 sources restent choisissables à la main.
    expect(triees).toHaveLength(4);
    expect(triees[triees.length - 1].audioTrack).toBe('translated');
  });

  it('ne change RIEN sur une fiche VF : l\'adaptatif y reste prioritaire', () => {
    // C'est la garantie la plus importante du fichier : la VF est la vocation
    // du produit, elle ne doit jamais être dégradée par cette règle.
    const classees = classifyAudioTracks(LIONESS_VF);
    expect(classees.every((s) => s.audioTrack === 'original')).toBe(true);

    const triees = orderByAudioTrack(classees);
    expect(triees[0].quality).toBe(1080);
    expect(triees[0].format).toBe('DASH');
  });

  it('respecte un audioTrack déjà posé par l\'appelant (fiches « dub » de l\'API mobile)', () => {
    const sources = [
      { url: 'https://x/a.mp4', quality: 1080, audioTrack: 'translated' as const },
      { url: 'https://x/b.mp4', quality: 480, audioTrack: 'original' as const },
    ];
    const triees = orderByAudioTrack(classifyAudioTracks(sources));
    expect(triees[0].quality).toBe(480);
  });
});
