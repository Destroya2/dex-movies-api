import { Request, Response, NextFunction } from 'express';
import { profileForLanguage, runWithGeo, currentProfile, GeoProfile } from '../config/geo';

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
  const explicit = (req.query.region as string) || '';
  const lang = (req.query.lang as string) || req.headers['accept-language'] || '';

  const profile: GeoProfile = explicit
    ? profileForLanguage(explicit)
    : profileForLanguage(String(lang));

  // Utile au diagnostic côté client et dans les journaux d'accès.
  res.setHeader('X-Dex-Geo', profile.code);

  runWithGeo(profile, () => next());
}

/** Suffixe de clé de cache. */
export function geoCacheSuffix(): string {
  return currentProfile().code;
}
