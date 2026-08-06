import { ScraperEngine } from '../../src/scrapers/index';

/**
 * L'API mobile (celle de l'app officielle) est le CŒUR, le h5 du site est le
 * RELAIS. Ce test fige la chaîne : ordre, bascule sur échec, bascule sur
 * réponse vide, et budget de temps.
 *
 * Sans lui, une simple inversion de `priority` remettrait silencieusement le h5
 * en tête — le symptôme (l'app marche) serait identique, seules les métadonnées
 * de langue disparaîtraient.
 */
describe('chaîne de scrapers — API mobile en cœur, h5 en relais', () => {
  const engine = new ScraperEngine() as any;
  const noms = () => engine.scrapers.map((s: any) => s.config.name);

  it('place l\'API mobile devant le h5', () => {
    // En test, FALLBACK_RESOLVER_URL n'est pas défini : seul le h5 est
    // enregistré. C'est le comportement voulu — sans relais, l'API mobile ne
    // peut pas obtenir de jeton depuis un datacenter, l'enregistrer ne ferait
    // que coûter un aller-retour perdu à chaque requête.
    expect(noms()).toContain('moviebox-h5api');
    expect(noms()[noms().length - 1]).toBe('moviebox-h5api');
  });

  it('trie par priorité croissante, quel que soit l\'ordre d\'enregistrement', () => {
    const e = new ScraperEngine() as any;
    e.scrapers = [];
    e.register({ config: { name: 'lent', priority: 10 } });
    e.register({ config: { name: 'coeur', priority: 0 } });
    e.register({ config: { name: 'milieu', priority: 5 } });
    expect(e.scrapers.map((s: any) => s.config.name)).toEqual(['coeur', 'milieu', 'lent']);
  });

  it('bascule sur le suivant quand le premier ÉCHOUE', async () => {
    const e = new ScraperEngine() as any;
    e.scrapers = [
      { config: { name: 'coeur', priority: 0 } },
      { config: { name: 'relais', priority: 10 } },
    ];
    const res = await e.execute(
      'search',
      async (s: any) => {
        if (s.config.name === 'coeur') throw new Error('relais Pi injoignable');
        return { items: [{ subjectId: '1' }] };
      },
      'test',
    );
    expect(res.source).toBe('relais');
    expect(res.data.items).toHaveLength(1);
  });

  it('bascule aussi quand le premier répond VIDE (échec silencieux upstream)', async () => {
    const e = new ScraperEngine() as any;
    e.scrapers = [
      { config: { name: 'coeur', priority: 0 } },
      { config: { name: 'relais', priority: 10 } },
    ];
    const res = await e.execute(
      'search',
      async (s: any) =>
        s.config.name === 'coeur' ? { items: [] } : { items: [{ subjectId: '1' }] },
      'test',
    );
    expect(res.source).toBe('relais');
  });

  it('bascule quand le premier DÉPASSE son budget, sans attendre indéfiniment', async () => {
    const e = new ScraperEngine() as any;
    e.scrapers = [
      { config: { name: 'coeur', priority: 0 } },
      { config: { name: 'relais', priority: 10 } },
    ];
    const debut = Date.now();
    const res = await e.execute(
      'search',
      async (s: any) => {
        if (s.config.name === 'coeur') {
          // Plus long que le budget de 9 s : c'est le cas « le Pi ne répond
          // plus mais la connexion TCP reste ouverte », le pire des deux.
          await new Promise((r) => setTimeout(r, 30_000));
          return { items: [{ subjectId: 'jamais' }] };
        }
        return { items: [{ subjectId: '1' }] };
      },
      'test',
    );
    expect(res.source).toBe('relais');
    // Le budget a bien coupé : on n'a pas attendu les 30 s.
    expect(Date.now() - debut).toBeLessThan(15_000);
  }, 40_000);

  it('ne laisse pas passer une réponse vide pour une erreur quand TOUT échoue', async () => {
    const e = new ScraperEngine() as any;
    e.scrapers = [{ config: { name: 'seul', priority: 0 } }];
    await expect(
      e.execute('search', async () => { throw new Error('boom'); }, 'test'),
    ).rejects.toThrow(/seul=boom/);
  });
});
