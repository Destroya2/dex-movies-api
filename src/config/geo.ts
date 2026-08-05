import { AsyncLocalStorage } from 'async_hooks';

/**
 * Profils géographiques du géo-spoof MovieBox.
 *
 * MovieBox sert un CATALOGUE DIFFÉRENT selon le pays de l'IP appelante. Ce n'est
 * pas une préférence d'affichage : c'est un catalogue distinct, avec d'autres
 * titres et d'autres doublages. Deux conséquences majeures, mesurées le
 * 05/08/2026 (relevé sur `/home`, 17 pays testés) :
 *
 * | Région testée                | Sections | Titres | VF   |
 * |------------------------------|---------:|-------:|-----:|
 * | Burkina Faso, Sénégal, RCI,  |    37-39 |    196 | 81-89 % |
 * | Cameroun                     |          |    216 |      |
 * | **France, Belgique, Suisse** |       40 |    394 | **0 %** |
 * | États-Unis, R-U, Canada, DE  |       40 |    394 |   0 % |
 * | Maroc, Algérie               |       41 |    458 |   9 % |
 * | Inde                         |       28 |    237 |   0 % |
 *
 * ⚠️ **Une IP française ne donne AUCUN contenu VF.** C'est contre-intuitif, mais
 * MovieBox y sert le catalogue anglophone (seuls quelques libellés de section
 * sont traduits). Utiliser une IP FR pour les utilisateurs francophones ferait
 * donc perdre tout le doublage français — l'inverse du but recherché. Le
 * doublage VF n'existe que sur le catalogue **Afrique de l'Ouest francophone**.
 *
 * En revanche, les catalogues anglophone (394 titres) et arabophone (458) sont
 * presque deux fois plus fournis que le francophone : les servir aux
 * utilisateurs dont l'appareil est dans ces langues est un vrai gain.
 *
 * Chaque profil embarque PLUSIEURS IP : elles sont utilisées en rotation, ce qui
 * répartit la charge au lieu de tout faire passer par une IP unique — le risque
 * systémique n°1 du projet (rate-limit → catalogue coupé pour tout le monde).
 */

export interface GeoProfile {
  /** Code du profil, tel qu'exposé aux clients. */
  code: string;
  label: string;
  /** Langues d'appareil qui doivent tomber sur ce profil. */
  languages: string[];
  /** Valeur envoyée dans `X-Request-Lang` à l'upstream. */
  upstreamLang: string;
  /** IP résidentielles réelles, utilisées en rotation. */
  ips: string[];
}

export const GEO_PROFILES: Record<string, GeoProfile> = {
  // Le seul catalogue qui porte réellement le doublage français.
  fr: {
    code: 'fr',
    label: 'Afrique de l\'Ouest francophone (VF)',
    languages: ['fr'],
    upstreamLang: 'fr',
    ips: [
      '196.28.244.1', // Burkina Faso — référence historique du projet
      '41.66.0.1',    // Côte d'Ivoire — 89 % de VF au relevé
      '41.82.0.1',    // Sénégal
      '41.202.192.1', // Cameroun
    ],
  },
  en: {
    code: 'en',
    label: 'Anglophone',
    languages: ['en'],
    upstreamLang: 'en',
    ips: [
      '24.0.0.1',    // États-Unis
      '86.128.0.1',  // Royaume-Uni
      '70.24.0.1',   // Canada
    ],
  },
  ar: {
    code: 'ar',
    label: 'Arabophone (Maghreb)',
    languages: ['ar'],
    upstreamLang: 'ar',
    ips: ['105.128.0.1', '41.96.0.1'], // Maroc, Algérie
  },
  hi: {
    code: 'hi',
    label: 'Inde',
    languages: ['hi', 'ta', 'te'],
    upstreamLang: 'en',
    ips: ['49.36.0.1'],
  },
};

/** Profil par défaut : la VF reste la vocation du produit. */
export const DEFAULT_PROFILE = GEO_PROFILES.fr;

/**
 * `SPOOF_IP` reste prioritaire quand il est défini : c'est la soupape de secours
 * historique si une IP se fait bloquer et qu'il faut en imposer une autre sans
 * redéployer de code.
 */
const OVERRIDE_IP = process.env.SPOOF_IP || '';

/** Résout un profil depuis la langue de l'appareil (ex: "fr-FR", "en-US"). */
export function profileForLanguage(language?: string | null): GeoProfile {
  if (!language) return DEFAULT_PROFILE;
  const base = String(language).toLowerCase().split(/[-_,;]/)[0].trim();
  for (const profile of Object.values(GEO_PROFILES)) {
    if (profile.languages.includes(base)) return profile;
  }
  return DEFAULT_PROFILE;
}

// Rotation round-robin, un compteur par profil.
const cursors: Record<string, number> = {};

export function pickIp(profile: GeoProfile): string {
  if (OVERRIDE_IP) return OVERRIDE_IP;
  const i = (cursors[profile.code] = (cursors[profile.code] ?? -1) + 1);
  return profile.ips[i % profile.ips.length];
}

/**
 * Contexte géographique de la requête en cours.
 *
 * `AsyncLocalStorage` évite de faire passer un paramètre `profile` à travers
 * toute la pile de scraping (des dizaines de signatures, sur le fichier le plus
 * critique du projet). Hors requête HTTP — tâches de fond, tests — on retombe
 * proprement sur le profil par défaut.
 */
const store = new AsyncLocalStorage<{ profile: GeoProfile; ip: string }>();

export function runWithGeo<T>(profile: GeoProfile, fn: () => T): T {
  return store.run({ profile, ip: pickIp(profile) }, fn);
}

export function currentProfile(): GeoProfile {
  return store.getStore()?.profile ?? DEFAULT_PROFILE;
}

/** IP de spoof de la requête en cours — stable pendant toute la requête. */
export function currentSpoofIp(): string {
  const ctx = store.getStore();
  if (ctx) return ctx.ip;
  return OVERRIDE_IP || DEFAULT_PROFILE.ips[0];
}

/** En-têtes de géo-spoof — l'un des 3 hacks vitaux du projet (voir REGLES.md). */
export function geoSpoofHeaders(): Record<string, string> {
  const ip = currentSpoofIp();
  return {
    'X-Forwarded-For': ip,
    'CF-Connecting-IP': ip,
    'X-Real-IP': ip,
  };
}
