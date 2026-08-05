import { Request, Response, NextFunction } from 'express';
import { profileForLanguage, profileByCode, runWithGeo, currentProfile, GeoProfile } from '../config/geo';

/**
 * Détermine le profil géographique de la requête et l'installe pour toute sa
 * durée (voir config/geo.ts).
 *
 * Ordre de résolution, du plus explicite au plus implicite :
 *  1. `?lang=` — l'app envoie la langue de l'appareil, c'est la source la plus fiable ;
 *  2. `Accept-Language` — navigateurs et PWA l'envoient sans rien coder ;
 *  3. profil par défaut (francophone) — la VF reste la vocation du produit.
 *
 * ⚠️ Un `?region=` explicite reste possible pour le diagnostic, mais la langue
 * prime : c'est elle qui décrit ce que l'utilisateur veut regarder.
 */
export function geoContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Choix EXPLICITE de l'utilisateur (réglage « Région du catalogue ») : il
  // prime sur tout le reste, y compris s'il mène à un catalogue sans doublage.
  const explicit = (req.query.region as string) || (req.headers['x-dex-region'] as string) || '';
  const lang = (req.query.lang as string) || req.headers['accept-language'] || '';

  const profile: GeoProfile =
    profileByCode(explicit) || profileForLanguage(explicit || String(lang));

  // Utile au diagnostic côté client et dans les journaux d'accès.
  res.setHeader('X-Dex-Geo', profile.code);

  runWithGeo(profile, () => next());
}

/** Suffixe de clé de cache. */
export function geoCacheSuffix(): string {
  return currentProfile().code;
}
