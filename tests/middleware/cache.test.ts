import express from 'express';
import request from 'supertest';
import { cacheMiddleware } from '../../src/middleware/cache';
import { geoContextMiddleware } from '../../src/middleware/geoContext';

/**
 * Ces tests portent sur le comportement qui protège l'app quand un upstream
 * tombe — le scénario réellement vécu (Raspberry Pi injoignable 2 jours en
 * août 2026 : l'onglet VF se vidait purement et simplement).
 */
function buildApp(handler: express.RequestHandler) {
  const app = express();
  app.use(geoContextMiddleware);
  app.get('/api/test', cacheMiddleware('home'), handler);
  return app;
}

describe('middleware/cache — cache deux niveaux et filet de secours', () => {
  it('sert la 2ᵉ requête depuis le cache sans rappeler le handler', async () => {
    const handler = jest.fn((_req, res) => {
      res.json({ success: true, data: { items: [{ subjectId: 'a' }] } });
    });
    const app = buildApp(handler as express.RequestHandler);

    const first = await request(app).get('/api/test?q=1');
    expect(first.body.meta?.cached).toBeFalsy();

    const second = await request(app).get('/api/test?q=1');
    expect(second.body.meta.cached).toBe(true);
    expect(second.body.meta.cacheLayer).toBe('L1');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ne met JAMAIS en cache une réponse vide (échec upstream silencieux)', async () => {
    const handler = jest.fn((_req, res) => {
      res.json({ success: true, data: { items: [] } });
    });
    const app = buildApp(handler as express.RequestHandler);

    await request(app).get('/api/test?q=vide');
    await request(app).get('/api/test?q=vide');
    // Sans cette règle, un écran vide resterait figé pendant tout le TTL.
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('sert la copie de secours quand l\'upstream se met à répondre vide', async () => {
    let enPanne = false;
    const handler = jest.fn((_req, res) => {
      res.json({
        success: true,
        data: enPanne ? { items: [] } : { items: [{ subjectId: 'a' }, { subjectId: 'b' }] },
      });
    });
    const app = buildApp(handler as express.RequestHandler);

    // 1) Une réponse saine alimente le filet.
    const ok = await request(app).get('/api/test?q=panne');
    expect(ok.body.data.items).toHaveLength(2);

    // 2) L'upstream tombe. `nocache` contourne le cache frais pour reproduire
    //    le cas réel : entrée expirée + source injoignable.
    enPanne = true;
    const degraded = await request(app).get('/api/test?q=panne&nocache=1');

    expect(degraded.body.data.items).toHaveLength(2);
    expect(degraded.body.meta.stale).toBe(true);
    expect(degraded.body.meta.source).toBe('cache-stale');
  });

  it('isole les profils géographiques — un anglophone ne doit pas empoisonner le cache francophone', async () => {
    const handler = jest.fn((req, res) => {
      const lang = (req.query.lang as string) || 'fr';
      res.json({ success: true, data: { items: [{ subjectId: lang }] } });
    });
    const app = buildApp(handler as express.RequestHandler);

    await request(app).get('/api/test?lang=en');
    const fr = await request(app).get('/api/test?lang=fr');

    // Sans la clé par profil, le francophone recevrait le catalogue anglophone
    // (donc zéro VF) servi depuis le cache.
    expect(fr.body.data.items[0].subjectId).toBe('fr');
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
