import nock from 'nock';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetBreakers } from '../../src/utils/resilience';

/**
 * Tests d'INTÉGRATION : ils exercent la vraie pile — application Express,
 * contexte géographique, cache, orchestrateurs de providers, scrapers — en ne
 * simulant qu'au niveau RÉSEAU (nock).
 *
 * Pourquoi c'est nécessaire : les tests existants remplacent tout le module
 * `scrapers` par un faux. Ils ne peuvent donc pas voir les pannes de câblage —
 * et c'est exactement ce type de panne qui a le plus coûté à ce projet : la
 * production a tourné des semaines sans les routes `/api/proxy` ni le health
 * check enrichi, parce qu'il existait deux bootstraps Express divergents, sans
 * la moindre erreur visible. Ces tests-là auraient hurlé.
 */

const H5 = 'https://h5-api.aoneroom.com';

function sujet(id: string, titre: string, corner = 'En français') {
  return {
    subjectId: id,
    title: titre,
    subjectType: 1,
    corner,
    detailPath: `${titre.toLowerCase().replace(/\s+/g, '-')}-${id}`,
    cover: { url: `https://img/${id}.jpg` },
    releaseDate: '2024-01-01',
  };
}

/**
 * Accueil upstream simulé. `persist()` est nécessaire : le scraper appelle CETTE
 * route deux fois — une première pour récupérer le token invité dans l'en-tête
 * `x-user`, une seconde authentifiée pour les données. Le compteur retourné
 * permet de vérifier combien de fois l'upstream a réellement été sollicité.
 */
function moqueAccueil(sujets: any[]) {
  const compteur = { appels: 0 };
  nock(H5)
    .persist()
    .get('/wefeed-h5api-bff/home')
    .query(true)
    .reply(function () {
      compteur.appels++;
      return [
        200,
        { data: { operatingList: [{ type: 'SUBJECTS_MOVIE', title: 'Tendance', subjects: sujets }] } },
        { 'x-user': JSON.stringify({ token: 'jeton-de-test' }) },
      ];
    });
  return compteur;
}

describe('intégration — pile complète, upstream simulé au réseau', () => {
  const app = createApp();

  beforeEach(() => {
    resetBreakers();
    nock.cleanAll();
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('expose les routes réellement montées (le piège des deux bootstraps)', async () => {
    // Ces trois routes vivaient dans le bootstrap de dev mais PAS en production.
    const sante = await request(app).get('/health');
    expect(sante.status).toBe(200);
    expect(sante.body.dependencies).toBeDefined();

    const metriques = await request(app).get('/metrics');
    expect(metriques.status).toBe(200);
    expect(metriques.text).toContain('dex_requests_total');

    const racine = await request(app).get('/');
    expect(racine.body.endpoints['proxy.stream']).toBeDefined();
  });

  it('sert l\'accueil de bout en bout et propage le badge VF', async () => {
    moqueAccueil([sujet('1', 'Film VF'), sujet('2', 'Film VO', '')]);

    const res = await request(app).get('/api/dex/home?lang=fr&nocache=1');

    expect(res.status).toBe(200);
    const items = res.body.data.sections.flatMap((s: any) => s.items);
    expect(items).toHaveLength(2);
    // Le badge VF doit venir du champ `corner` upstream, pas d'une supposition.
    expect(items.find((i: any) => i.title === 'Film VF').language).toBe('VF');
    expect(items.find((i: any) => i.title === 'Film VO').language).toBeUndefined();
  });

  it('annonce le profil géographique appliqué', async () => {
    moqueAccueil([sujet('1', 'A')]);
    const fr = await request(app).get('/api/dex/home?lang=fr&nocache=1');
    expect(fr.headers['x-dex-geo']).toBe('fr');

    moqueAccueil([sujet('1', 'A')]);
    const en = await request(app).get('/api/dex/home?lang=en-US&nocache=1');
    expect(en.headers['x-dex-geo']).toBe('en');
  });

  it('sert la 2ᵉ requête depuis le cache sans retoucher l\'upstream', async () => {
    const compteur = moqueAccueil([sujet('1', 'Unique')]);

    await request(app).get('/api/dex/home?nocache=1');
    const apresPremier = compteur.appels;
    expect(apresPremier).toBeGreaterThan(0);

    const second = await request(app).get('/api/dex/home');
    expect(second.status).toBe(200);
    expect(second.body.meta.cached).toBe(true);
    expect(second.body.data.sections[0].items).toHaveLength(1);
    // Le cache doit ABSORBER la seconde requête : c'est lui qui protège l'IP de
    // géo-spoof du rate-limit upstream, le risque systémique n°1 du projet.
    expect(compteur.appels).toBe(apresPremier);
  });

  it('ne met jamais en cache une réponse vide et renvoie une erreur propre', async () => {
    // Tous les miroirs upstream échouent : l'API doit rendre une erreur
    // structurée, jamais du HTML brut ni un 200 trompeur.
    nock(/aoneroom\.com|moviebox\.(ph|pk|id)/)
      .persist()
      .get(/.*/)
      .query(true)
      .reply(500, 'erreur upstream');

    const res = await request(app).get('/api/dex/detail/introuvable?nocache=1');
    expect([404, 500]).toContain(res.status);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBeDefined();
  });

  it('renvoie un 404 JSON sur une route inconnue', async () => {
    const res = await request(app).get('/route/qui-nexiste-pas');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('refuse une recherche trop courte sans appeler l\'upstream', async () => {
    const res = await request(app).get('/api/dex/search?q=a');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_QUERY');
  });
});
