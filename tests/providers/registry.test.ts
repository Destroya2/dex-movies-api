import { resolveStream, defaultDeadline } from '../../src/providers/registry';
import { StreamProvider, StreamRequest, StreamOutcome } from '../../src/providers/types';
import { resetBreakers, recordFailure } from '../../src/utils/resilience';

const outcome = (n = 1): StreamOutcome => ({
  sources: Array.from({ length: n }, (_, i) => ({ url: `u${i}`, format: 'HLS', quality: 1080 })),
  subtitles: [],
});

function provider(
  name: string,
  priority: number,
  impl: Partial<Pick<StreamProvider, 'supports' | 'resolve'>> = {}
): StreamProvider {
  return {
    name,
    priority,
    supports: impl.supports ?? (() => true),
    resolve: impl.resolve ?? (async () => outcome()),
  };
}

const req = (over: Partial<StreamRequest> = {}): StreamRequest => ({
  subjectId: 's1',
  deadline: defaultDeadline(),
  ...over,
});

describe('providers/registry — orchestration des sources de flux', () => {
  beforeEach(() => resetBreakers());

  it('essaie par priorité et retient le premier résultat utilisable', async () => {
    const first = jest.fn(async () => outcome(2));
    const second = jest.fn(async () => outcome(5));
    const res = await resolveStream(req(), [
      provider('lent', 20, { resolve: second }),
      provider('prioritaire', 10, { resolve: first }),
    ]);
    expect(res?.provider).toBe('prioritaire');
    expect(res?.outcome.sources).toHaveLength(2);
    expect(second).not.toHaveBeenCalled();
  });

  it('passe au suivant quand un provider ne trouve rien', async () => {
    const res = await resolveStream(req(), [
      provider('vide', 10, { resolve: async () => null }),
      provider('sansSource', 15, { resolve: async () => ({ sources: [], subtitles: [] }) }),
      provider('bon', 20),
    ]);
    expect(res?.provider).toBe('bon');
  });

  it('continue après une exception et ne la propage pas', async () => {
    const res = await resolveStream(req(), [
      provider('casse', 10, { resolve: async () => { throw new Error('boom'); } }),
      provider('bon', 20),
    ]);
    expect(res?.provider).toBe('bon');
  });

  it("saute un provider qui ne sait pas traiter la demande, sans l'appeler", async () => {
    const jamais = jest.fn(async () => outcome());
    const res = await resolveStream(req(), [
      provider('inadapte', 10, { supports: () => false, resolve: jamais }),
      provider('bon', 20),
    ]);
    expect(jamais).not.toHaveBeenCalled();
    expect(res?.provider).toBe('bon');
  });

  it('écarte un provider dont le disjoncteur est ouvert', async () => {
    const mort = jest.fn(async () => outcome());
    recordFailure('provider:mort', { failureThreshold: 1, openMs: 60_000 });
    const res = await resolveStream(req(), [
      provider('mort', 10, { resolve: mort }),
      provider('bon', 20),
    ]);
    // Le disjoncteur coupe AVANT l'appel : c'est ce qui évite de repayer le
    // timeout d'un hôte mort à chaque requête utilisateur.
    expect(mort).not.toHaveBeenCalled();
    expect(res?.provider).toBe('bon');
  });

  it('ouvre le disjoncteur après des échecs répétés du même provider', async () => {
    const casse = provider('instable', 10, {
      resolve: async () => { throw new Error('upstream down'); },
    });
    const appels = jest.spyOn(casse, 'resolve');
    for (let i = 0; i < 3; i++) await resolveStream(req(), [casse]);
    const avant = appels.mock.calls.length;
    await resolveStream(req(), [casse]);
    expect(appels).toHaveBeenCalledTimes(avant); // plus appelé : circuit ouvert
  });

  it("s'arrête quand le budget de temps est épuisé", async () => {
    const jamais = jest.fn(async () => outcome());
    const res = await resolveStream(
      req({ deadline: Date.now() + 100 }), // sous le minimum requis
      [provider('trop-tard', 10, { resolve: jamais })]
    );
    expect(jamais).not.toHaveBeenCalled();
    expect(res).toBeNull();
  });

  it('renvoie null quand aucun provider ne trouve le titre', async () => {
    const res = await resolveStream(req(), [provider('a', 10, { resolve: async () => null })]);
    expect(res).toBeNull();
  });
});
