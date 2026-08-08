/**
 * Détection du doublage français sur un item de catalogue upstream.
 *
 * Extrait de `scrapers/fallback/h5api.ts`, où la logique vivait en privé : le
 * scraper h5 n'est PAS le seul à mapper des items MovieBox. Le scraper mobile
 * (`moviebox-hmac`, celui qui sert la recherche en prod) rendait des résultats
 * sans `language` ni `isFrench` — d'où l'absence totale de badge VF sur la page
 * de recherche alors que la moitié des titres rendus sont des fiches
 * « [Version française] ». Une seule implémentation, deux appelants.
 */
export interface FrenchDub {
  isFrench: boolean;
  language?: string;
}

export function detectFrenchDub(
  corner: string,
  title?: string,
  detailPath?: string,
  subtitleLangs?: string
): FrenchDub {
  // PRIMAIRE : champ corner upstream (fiable à 100%)
  if (corner) {
    const c = String(corner).trim();
    if (/vostfr/i.test(c)) return { isFrench: true, language: 'VOSTFR' };
    if (/fran[cç]ais|\bvf\b/i.test(c)) return { isFrench: true, language: 'VF' };
    return { isFrench: false };
  }

  // FALLBACK : l'upstream n'a pas fourni de corner → on vérifie le titre et le slug
  // pour des marqueurs explicites de langue. Ex: "Naruto [Version française]",
  // "Godzilla [VF]", detailPath contenant "-version-francaise-".
  // Ne pas utiliser de heuristiques larges (le titre "Kiss the French Girl"
  // n'est pas VF), cibler uniquement les motifs entre crochets/ parenthèses.
  const haystack = [title || '', detailPath || '', subtitleLangs || ''].join(' ');
  if (/vostfr/i.test(haystack)) return { isFrench: true, language: 'VOSTFR' };
  // ⚠️ `fran[cç]ais\]` exigeait « français] » : le motif ne matchait donc JAMAIS
  // « [Version française] », seule forme réellement employée par MovieBox. Le
  // titre seul ne suffisait pas à détecter la VF ; il fallait que le slug
  // (`-version-francaise-`) sauve la mise — or la recherche mobile ne renvoyait
  // pas de slug. D'où des fiches VF évidentes sans le moindre badge.
  if (/\[version\s*fran[cç]aise?\]|\(version\s*fran[cç]aise?\)|-version-francaise-|\bvf\b|\[vf\]|\(vf\)|\[french\]|\(french\)|-vf-|-vf$/i.test(haystack)) {
    return { isFrench: true, language: 'VF' };
  }
  return { isFrench: false };
}
