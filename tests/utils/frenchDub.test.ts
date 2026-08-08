import { detectFrenchDub } from '../../src/utils/frenchDub';
import { pickTrailerKey } from '../../src/utils/tmdb';

describe('detectFrenchDub', () => {
  it('fait confiance au corner upstream en priorité', () => {
    expect(detectFrenchDub('En français')).toEqual({ isFrench: true, language: 'VF' });
    expect(detectFrenchDub('VOSTFR')).toEqual({ isFrench: true, language: 'VOSTFR' });
    expect(detectFrenchDub('Nouveau')).toEqual({ isFrench: false });
  });

  it('retombe sur le titre et le slug quand le corner manque', () => {
    // Cas réel de la page de recherche servie par le scraper mobile : aucun
    // corner, mais le marqueur VF est dans le titre.
    expect(detectFrenchDub('', 'Naruto [Version française] S1-S4')).toEqual({
      isFrench: true,
      language: 'VF',
    });
    expect(detectFrenchDub('', 'The Last House', 'the-last-house-version-francaise-iv5YjZTvZj8')).toEqual({
      isFrench: true,
      language: 'VF',
    });
  });

  it('ne déclare pas VF sur une simple mention de « French » dans le titre', () => {
    expect(detectFrenchDub('', 'Kiss the French Girl')).toEqual({ isFrench: false });
  });
});

describe('pickTrailerKey', () => {
  const fr = { site: 'YouTube', type: 'Trailer', iso_639_1: 'fr', official: true, key: 'FR_OFF' };
  const frNonOff = { site: 'YouTube', type: 'Trailer', iso_639_1: 'fr', official: false, key: 'FR' };
  const en = { site: 'YouTube', type: 'Trailer', iso_639_1: 'en', official: true, key: 'EN_OFF' };
  const teaser = { site: 'YouTube', type: 'Teaser', iso_639_1: 'en', official: true, key: 'TEASER' };

  it('préfère la bande-annonce française officielle', () => {
    expect(pickTrailerKey([en, frNonOff, fr])).toBe('FR_OFF');
  });

  it('retombe sur l\'anglais quand aucune vidéo française n\'existe', () => {
    expect(pickTrailerKey([teaser, en])).toBe('EN_OFF');
  });

  it('accepte un teaser plutôt que rien', () => {
    expect(pickTrailerKey([teaser])).toBe('TEASER');
  });

  it('ignore les hébergeurs non-YouTube et les listes vides', () => {
    expect(pickTrailerKey([{ site: 'Vimeo', type: 'Trailer', key: 'V' }])).toBeUndefined();
    expect(pickTrailerKey([])).toBeUndefined();
  });
});
