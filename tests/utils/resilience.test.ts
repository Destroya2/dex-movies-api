import {
  runResilient,
  canAttempt,
  recordFailure,
  recordSuccess,
  resetBreakers,
  breakerSnapshot,
  CircuitOpenError,
  hostKey,
} from '../../src/utils/resilience';

describe('resilience — disjoncteur et retry', () => {
  beforeEach(() => resetBreakers());

  it('renvoie le résultat au premier succès sans retry', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(runResilient('t1', fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retente puis réussit', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValue('ok');
    await expect(runResilient('t2', fn, { attempts: 2, backoffMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("n'ouvre pas le circuit sur un échec attendu (ex: 404)", async () => {
    const notFound = new Error('404');
    const fn = jest.fn().mockRejectedValue(notFound);
    for (let i = 0; i < 5; i++) {
      await expect(
        runResilient('t3', fn, { attempts: 3, isExpectedFailure: (e) => (e as Error).message === '404' })
      ).rejects.toBe(notFound);
    }
    // Un 404 est une réponse, pas une panne d'hôte : une seule tentative, circuit fermé.
    expect(fn).toHaveBeenCalledTimes(5);
    expect(canAttempt('t3')).toBe(true);
  });

  it('ouvre le circuit après le seuil et échoue ensuite immédiatement', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('mort'));
    for (let i = 0; i < 3; i++) {
      await expect(runResilient('t4', fn, { attempts: 1, backoffMs: 1 })).rejects.toThrow('mort');
    }
    expect(canAttempt('t4')).toBe(false);

    const callsBefore = fn.mock.calls.length;
    await expect(runResilient('t4', fn, { attempts: 1 })).rejects.toBeInstanceOf(CircuitOpenError);
    // Le circuit ouvert coupe AVANT l'appel réseau : c'est tout l'intérêt.
    expect(fn).toHaveBeenCalledTimes(callsBefore);
  });

  it('passe en half-open après le délai puis se referme sur un succès', async () => {
    recordFailure('t5', { failureThreshold: 1, openMs: 5 });
    expect(canAttempt('t5', { openMs: 5 })).toBe(false);

    await new Promise((r) => setTimeout(r, 10));
    expect(canAttempt('t5', { openMs: 5 })).toBe(true); // half-open

    recordSuccess('t5');
    expect(canAttempt('t5')).toBe(true);
    expect(breakerSnapshot()['t5']).toBeUndefined(); // refermé et propre
  });

  it('ne remonte dans le snapshot que ce qui est anormal', () => {
    recordSuccess('sain');
    recordFailure('malade', { failureThreshold: 1, openMs: 1000 });
    const snap = breakerSnapshot();
    expect(snap['sain']).toBeUndefined();
    expect(snap['malade'].state).toBe('open');
  });

  it('dérive une clé de disjoncteur depuis une URL', () => {
    expect(hostKey('https://api4.aoneroom.com/wefeed-mobile-bff/x?y=1')).toBe('api4.aoneroom.com');
    expect(hostKey('pas-une-url')).toBe('pas-une-url');
  });
});
