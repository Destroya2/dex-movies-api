import { HomeSection } from '../../src/scrapers/moviebox/types';

/**
 * Régression du 07/08/2026 : l'accueil servi par l'API mobile affichait SIX
 * rails rigoureusement identiques et aucune bannière.
 *
 * Cause : `tab/ranking-list` était appelé six fois avec `tabId=0` codé en dur
 * et un `categoryType` différent — paramètre que l'amont IGNORE. 12 titres
 * uniques étalés sur 72 emplacements.
 *
 * Le test ci-dessous porte sur la mise en forme, pas sur le réseau : il rejoue
 * la structure réelle de `tab-operating` relevée ce jour-là.
 */

// Extrait fidèle de la réponse amont (champs réduits à ce qui est mappé).
const TAB_OPERATING = {
  data: {
    items: [
      {
        type: 'BANNER',
        title: 'Banner_Africa French',
        opId: 'ban1',
        banner: {
          banners: [
            {
              subjectId: 0,
              image: { url: 'https://pbcdn/large.png' },
              subject: {
                subjectId: '6917397508763568088',
                title: 'Ireon Yeot Gateun Sarang [Version française]',
                subjectType: 2,
                corner: 'En français',
                cover: { url: 'https://pbcdn/poster.jpg' },
                detailUrl: 'https://moviebox.ph/fr/detail/our-sticky-love-version-francaise-6pTvaiKKZe8',
              },
            },
            // Doublon volontaire : la bannière répète un titre sous deux visuels.
            {
              subjectId: 0,
              image: { url: 'https://pbcdn/large2.png' },
              subject: { subjectId: '6917397508763568088', title: 'Ireon', subjectType: 2 },
            },
          ],
        },
      },
      {
        type: 'SUBJECTS_MOVIE',
        title: 'Films Tendance',
        opId: 'r1',
        subjects: [
          {
            subjectId: '111',
            title: 'Un film',
            subjectType: 1,
            corner: 'VOSTFR',
            cover: { url: 'https://pbcdn/f.jpg' },
            detailUrl: 'https://moviebox.ph/fr/detail/un-film-AbCd123',
          },
        ],
      },
      {
        // Même piège que sur le h5 : le contenu est dans customData.items.
        type: 'CUSTOM',
        title: 'Zone de combat',
        opId: 'c1',
        customData: {
          items: [
            { subjectId: 0, subject: { subjectId: '222', title: 'Un court', subjectType: 1 } },
          ],
        },
      },
      // Sections sans contenu : ne doivent produire aucun rail vide.
      { type: 'FILTER', title: 'Catégories' },
      { type: 'SPORT_LIVE', title: 'Coupe du Monde' },
    ],
  },
};

jest.mock('../../src/scrapers/moviebox/http', () => ({
  mobileGet: jest.fn(async () => TAB_OPERATING),
}));

import { fetchHomepage } from '../../src/scrapers/moviebox/home';

describe('accueil API mobile — mise en forme de tab-operating', () => {
  let sections: HomeSection[];
  beforeAll(async () => { sections = await fetchHomepage(); });

  it('produit une bannière, et une seule', () => {
    expect(sections.filter((s) => s.type === 'banner')).toHaveLength(1);
    expect(sections[0].type).toBe('banner');
  });

  it('ne produit PAS de rails identiques', () => {
    const signatures = sections.map((s) => s.items.map((i) => i.subjectId).join(','));
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('lit le contenu des sections CUSTOM dans customData.items', () => {
    const custom = sections.find((s) => s.title === 'Zone de combat');
    expect(custom?.items.map((i) => i.subjectId)).toEqual(['222']);
  });

  it('ignore les sections sans contenu au lieu d\'afficher un rail vide', () => {
    expect(sections.map((s) => s.title)).not.toContain('Catégories');
    expect(sections.map((s) => s.title)).not.toContain('Coupe du Monde');
    expect(sections.every((s) => s.items.length > 0)).toBe(true);
  });

  it('reconstruit le slug depuis detailUrl — /stream en a besoin', () => {
    const film = sections.find((s) => s.title === 'Films Tendance')!.items[0];
    expect(film.detailPath).toBe('un-film-AbCd123');
    expect(sections[0].items[0].detailPath).toBe('our-sticky-love-version-francaise-6pTvaiKKZe8');
  });

  it('déduit la langue de `corner`, pas du titre', () => {
    expect(sections[0].items[0].isFrench).toBe(true);
    expect(sections[0].items[0].language).toBe('VF');
    const film = sections.find((s) => s.title === 'Films Tendance')!.items[0];
    expect(film.language).toBe('VOSTFR');
  });

  it('dédoublonne à l\'intérieur d\'une section', () => {
    // Les clés de liste Compose cassent sur des doublons.
    expect(sections[0].items).toHaveLength(1);
  });

  it('lit le sujet IMBRIQUÉ, pas l\'enveloppe (subjectId: 0)', () => {
    const tous = sections.flatMap((s) => s.items);
    expect(tous.every((i) => i.subjectId && i.subjectId !== '0')).toBe(true);
    expect(tous.every((i) => Boolean(i.title))).toBe(true);
  });
});
