import request from 'supertest';
import { createApp } from '../../src/app';

/**
 * Comptes anonymes et synchronisation multi-appareils.
 *
 * Le scénario central est celui de l'utilisateur : il regarde un film sur son
 * téléphone, installe l'app sur une tablette, saisit un code à 6 chiffres, et
 * retrouve son historique. Ces tests vérifient ce parcours ET les garde-fous qui
 * empêchent quelqu'un d'atteindre l'historique d'un autre.
 */
describe('intégration — comptes et synchronisation', () => {
  const app = createApp();

  async function nouveauCompte() {
    const res = await request(app).post('/api/dex/account');
    expect(res.status).toBe(200);
    return res.body.data as { accountId: string; token: string };
  }

  it('crée un compte anonyme sans demander la moindre donnée personnelle', async () => {
    const compte = await nouveauCompte();
    expect(compte.accountId).toMatch(/^[0-9a-f-]{36}$/);
    expect(compte.token.length).toBeGreaterThan(20);
  });

  it('refuse tout accès sans jeton valide', async () => {
    const sans = await request(app).get('/api/dex/account/me');
    expect(sans.status).toBe(401);

    const faux = await request(app)
      .get('/api/dex/account/me')
      .set('Authorization', 'Bearer jeton-inventé');
    expect(faux.status).toBe(401);
  });

  it('enregistre et restitue l\'historique du compte', async () => {
    const { token } = await nouveauCompte();
    const historique = [{ subjectId: '42', title: 'Dune', positionMs: 125000 }];

    const ecriture = await request(app)
      .put('/api/dex/account/sync/history')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: historique });
    expect(ecriture.status).toBe(200);

    const lecture = await request(app)
      .get('/api/dex/account/sync/history')
      .set('Authorization', `Bearer ${token}`);
    expect(lecture.body.data).toEqual(historique);
  });

  it('parcours complet : un 2ᵉ appareil retrouve l\'historique via un code', async () => {
    // Appareil 1 : compte + historique
    const appareil1 = await nouveauCompte();
    await request(app)
      .put('/api/dex/account/sync/history')
      .set('Authorization', `Bearer ${appareil1.token}`)
      .send({ data: [{ subjectId: '7', title: 'Interstellar' }] });

    // Appareil 1 : génère le code affiché à l'écran
    const pair = await request(app)
      .post('/api/dex/account/pair')
      .set('Authorization', `Bearer ${appareil1.token}`);
    expect(pair.body.data.code).toMatch(/^\d{6}$/);

    // Appareil 2 : saisit le code, obtient SON PROPRE jeton sur le même compte
    const claim = await request(app)
      .post('/api/dex/account/claim')
      .send({ code: pair.body.data.code });
    expect(claim.status).toBe(200);
    expect(claim.body.data.accountId).toBe(appareil1.accountId);
    expect(claim.body.data.token).not.toBe(appareil1.token);

    // Appareil 2 : l'historique est bien là
    const sync = await request(app)
      .get('/api/dex/account/sync/history')
      .set('Authorization', `Bearer ${claim.body.data.token}`);
    expect(sync.body.data[0].title).toBe('Interstellar');
  });

  it('un code d\'appairage ne sert qu\'une fois', async () => {
    const { token } = await nouveauCompte();
    const pair = await request(app)
      .post('/api/dex/account/pair')
      .set('Authorization', `Bearer ${token}`);
    const code = pair.body.data.code;

    expect((await request(app).post('/api/dex/account/claim').send({ code })).status).toBe(200);
    // Rejouer un code déjà consommé donnerait accès au compte à quiconque
    // l'aurait vu par-dessus l'épaule.
    expect((await request(app).post('/api/dex/account/claim').send({ code })).status).toBe(404);
  });

  it('ne distingue pas un code faux d\'un code expiré', async () => {
    const res = await request(app).post('/api/dex/account/claim').send({ code: '000000' });
    expect(res.status).toBe(404);
    // Un message différent renseignerait un attaquant sur les codes valides.
    expect(res.body.error.code).toBe('CODE_UNKNOWN');
  });

  it('rejette un code mal formé sans interroger la base', async () => {
    const res = await request(app).post('/api/dex/account/claim').send({ code: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CODE');
  });

  it('cloisonne les comptes entre eux', async () => {
    const a = await nouveauCompte();
    const b = await nouveauCompte();

    await request(app)
      .put('/api/dex/account/sync/favorites')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ data: ['film-de-a'] });

    const vueDeB = await request(app)
      .get('/api/dex/account/sync/favorites')
      .set('Authorization', `Bearer ${b.token}`);
    expect(vueDeB.body.data).toBeNull();
  });

  it('refuse un type de données inconnu', async () => {
    const { token } = await nouveauCompte();
    const res = await request(app)
      .get('/api/dex/account/sync/nimporte-quoi')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_KIND');
  });

  it('plafonne la taille des données synchronisées', async () => {
    const { token } = await nouveauCompte();
    const res = await request(app)
      .put('/api/dex/account/sync/history')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: { bourrage: 'x'.repeat(300 * 1024) } });
    expect(res.status).toBe(413);
  });
});
