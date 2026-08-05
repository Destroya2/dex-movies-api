import {
  profileForLanguage,
  pickIp,
  GEO_PROFILES,
  DEFAULT_PROFILE,
  runWithGeo,
  currentProfile,
  currentSpoofIp,
  geoSpoofHeaders,
} from '../../src/config/geo';

describe('config/geo — profils géographiques et rotation d\'IP', () => {
  it('associe la langue de l\'appareil au bon profil', () => {
    expect(profileForLanguage('fr-FR').code).toBe('fr');
    expect(profileForLanguage('fr').code).toBe('fr');
    expect(profileForLanguage('en-US').code).toBe('en');
    expect(profileForLanguage('ar-MA').code).toBe('ar');
    expect(profileForLanguage('hi-IN').code).toBe('hi');
  });

  it('retombe sur le francophone — la VF est la vocation du produit', () => {
    expect(profileForLanguage(undefined).code).toBe('fr');
    expect(profileForLanguage('').code).toBe('fr');
    expect(profileForLanguage('xx-YY').code).toBe('fr');
    expect(DEFAULT_PROFILE.code).toBe('fr');
  });

  it('gère un Accept-Language complet du navigateur', () => {
    expect(profileForLanguage('en-GB,en;q=0.9,fr;q=0.8').code).toBe('en');
  });

  it('fait tourner les IP au lieu de toujours utiliser la même', () => {
    const fr = GEO_PROFILES.fr;
    const vus = new Set<string>();
    for (let i = 0; i < fr.ips.length * 2; i++) vus.add(pickIp(fr));
    // Le rate-limit sur une IP unique est le risque systémique n°1 : la
    // rotation doit réellement couvrir tout le pool.
    expect(vus.size).toBe(fr.ips.length);
  });

  it('n\'expose que des IP francophones d\'Afrique de l\'Ouest sur le profil VF', () => {
    // Relevé du 05/08/2026 : une IP France/Belgique/Suisse renvoie 0 % de VF.
    // Ce test fige la conclusion pour qu'on ne « corrige » pas ça par erreur.
    const interdits = ['90.', '82.64', '81.240', '85.0', '24.0', '86.128'];
    for (const ip of GEO_PROFILES.fr.ips) {
      expect(interdits.some((p) => ip.startsWith(p))).toBe(false);
    }
  });

  it('installe le profil pour toute la durée de la requête', () => {
    runWithGeo(GEO_PROFILES.en, () => {
      expect(currentProfile().code).toBe('en');
      expect(GEO_PROFILES.en.ips).toContain(currentSpoofIp());
      const h = geoSpoofHeaders();
      expect(h['X-Forwarded-For']).toBe(currentSpoofIp());
      expect(h['CF-Connecting-IP']).toBe(h['X-Forwarded-For']);
    });
    // Hors contexte : retour au profil par défaut, jamais d'état qui fuit.
    expect(currentProfile().code).toBe('fr');
  });

  it('garde la même IP pendant toute une requête', () => {
    runWithGeo(GEO_PROFILES.fr, () => {
      const premier = currentSpoofIp();
      for (let i = 0; i < 5; i++) expect(currentSpoofIp()).toBe(premier);
    });
  });
});
