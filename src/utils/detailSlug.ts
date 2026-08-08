/**
 * Slug MovieBox (`detailPath`) à partir de l'URL de fiche renvoyée par l'amont.
 *
 * `https://moviebox.ph/fr/detail/our-sticky-love-version-francaise-6pTvaiKKZe8`
 * → `our-sticky-love-version-francaise-6pTvaiKKZe8`
 *
 * ⚠️ L'API mobile ne renvoie **jamais** de champ `detailPath` : elle expose
 * `detailUrl`, et le slug est son dernier segment. C'est pour ça que chercher
 * `sub.detailPath` dans les réponses mobiles rend toujours vide — vérifié en
 * prod : `/home` (servi par moviebox-hmac) a un slug sur 315 items sur 324,
 * tous dérivés de `detailUrl`, alors que la recherche et la fiche n'en avaient
 * aucun faute de lire le bon champ.
 *
 * Extrait de `scrapers/moviebox/home.ts`, où la fonction vivait en privé alors
 * que trois endpoints en ont besoin.
 */
export function slugDepuisUrl(detailUrl?: string | null): string | undefined {
  if (!detailUrl) return undefined;
  const propre = String(detailUrl).split('?')[0].replace(/\/$/, '');
  const slug = propre.substring(propre.lastIndexOf('/') + 1);
  return slug || undefined;
}

/**
 * Slug d'un objet `subject` mobile, quelle que soit la forme rencontrée :
 * `detailUrl` en priorité (la seule que l'amont remplit vraiment), `detailPath`
 * accepté au cas où une réponse le porterait déjà.
 */
export function slugDeSujet(...sources: any[]): string | undefined {
  for (const src of sources) {
    if (!src) continue;
    const direct = src.detailPath;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    const depuisUrl = slugDepuisUrl(src.detailUrl);
    if (depuisUrl) return depuisUrl;
  }
  return undefined;
}
