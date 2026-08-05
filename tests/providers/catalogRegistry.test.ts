import { searchCatalog, CatalogProvider } from '../../src/providers/catalogRegistry';
import { resetBreakers, recordFailure } from '../../src/utils/resilience';

const items = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ subjectId: `${prefix}${i}`, title: `${prefix}${i}` }));

function provider(
  name: string,
  priority: number,
  impl: Partial<Pick<CatalogProvider, 'supports' | 'search'>> = {}
): CatalogProvider {
  return {
    name,
    priority,
    supports: impl.supports ?? (() => true),
    search: impl.search ?? (async () => items(name, 2)),
  };
}

describe('providers/catalogRegistry — sources de catalogue complémentaires', () => {
  beforeEach(() => resetBreakers());

  it('fusionne les sources en respectant la priorité', async () => {
    const res = await searchCatalog('x', 1, [
      provider('b', 20),
      provider('a', 10),
    ]);
    expect(res.items.map((i) => i.subjectId)).toEqual(['a0', 'a1', 'b0', 'b1']);
  });

  it('déduplique par subjectId — la source prioritaire gagne', async () => {
    const res = await searchCatalog('x', 1, [
      provider('tmdb', 20, { search: async () => [{ subjectId: 'shared', title: 'version TMDB' }] }),
      provider('moviebox', 10, { search: async () => [{ subjectId: 'shared', title: 'version MovieBox' }] }),
    ]);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].title).toBe('version MovieBox');
  });

  it('interroge les sources EN PARALLÈLE', async () => {
    const slow = (ms: number) => async () => {
      await new Promise((r) => setTimeout(r, ms));
      return items('s', 1);
    };
    const started = Date.now();
    await searchCatalog('x', 1, [
      provider('a', 10, { search: slow(120) }),
      provider('b', 20, { search: slow(120) }),
    ]);
    // En séquentiel il faudrait ~240 ms ; en parallèle ~120 ms.
    expect(Date.now() - started).toBeLessThan(220);
  });

  it("dégrade au lieu d'échouer quand une source tombe", async () => {
    const res = await searchCatalog('x', 1, [
      provider('casse', 10, { search: async () => { throw new Error('upstream down'); } }),
      provider('ok', 20),
    ]);
    expect(res.items).toHaveLength(2);
    expect(res.degraded).toContain('casse');
    expect(res.contributions['ok']).toBe(2);
  });

  it("n'interroge pas une source non applicable à cette page", async () => {
    const jamais = jest.fn(async () => items('t', 5));
    const res = await searchCatalog('x', 2, [
      provider('moviebox', 10),
      provider('tmdb', 20, { supports: (_q, p) => p === 1, search: jamais }),
    ]);
    expect(jamais).not.toHaveBeenCalled();
    expect(res.items.every((i) => i.subjectId.startsWith('moviebox'))).toBe(true);
  });

  it('écarte une source dont le disjoncteur est ouvert et le signale', async () => {
    recordFailure('catalog:mort', { failureThreshold: 1, openMs: 60_000 });
    const mort = jest.fn(async () => items('m', 3));
    const res = await searchCatalog('x', 1, [
      provider('mort', 10, { search: mort }),
      provider('vivant', 20),
    ]);
    expect(mort).not.toHaveBeenCalled();
    expect(res.degraded).toContain('mort');
    expect(res.items).toHaveLength(2);
  });

  it('abandonne une source qui dépasse le budget sans bloquer les autres', async () => {
    const res = await searchCatalog(
      'x',
      1,
      [
        provider('lente', 10, { search: () => new Promise(() => {}) }), // ne résout jamais
        provider('rapide', 20),
      ],
      80
    );
    expect(res.degraded).toContain('lente');
    expect(res.items).toHaveLength(2);
  });
});
