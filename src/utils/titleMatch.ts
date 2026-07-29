/**
 * Matching de titre pour relier un titre TMDB à un sujet MovieBox.
 * Porté de repos/NuvioStreamsAddon/providers/moviebox.js, adapté au français :
 * on retire les accents et les marqueurs VF/VOSTFR avant comparaison.
 */

export function normalizeTitle(title: string): string {
  if (!title) return '';
  return title
    .toLowerCase()
    // retire accents (crucial FR : "légende" == "legende")
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    // retire les marqueurs de langue et ce qui est entre crochets/parenthèses
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(version\s*francaise|vostfr|vf|vo|multi)\b/g, ' ')
    // ponctuation → espace
    .replace(/[.,!?;:()\[\]{}"'’\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // articles de tête (fr + en)
    .replace(/^(the|a|an|le|la|les|un|une|des|l)\s+/, '')
    .replace(/\s+(movie|film|show|series|serie|saison|season|part|chapitre|chapter)\s*\d*$/i, '')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[m];
}

function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function wordSimilarity(a: string, b: string): number {
  const w1 = a.split(/\s+/).filter((w) => w.length > 1);
  const w2 = b.split(/\s+/).filter((w) => w.length > 1);
  if (w1.length === 0 || w2.length === 0) return 0;
  let matches = 0;
  for (const x of w1) {
    if (w2.includes(x)) { matches += 1; continue; }
    for (const y of w2) {
      if (x.includes(y) || y.includes(x)) { matches += 0.8; break; }
    }
  }
  return matches / Math.max(w1.length, w2.length);
}

/** Score de similarité 0..1 entre deux titres (mix mots + Levenshtein). */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return Math.max(wordSimilarity(na, nb), levenshteinRatio(na, nb));
}

export interface MatchCandidate {
  title: string;
  year?: string;
  [k: string]: any;
}

/**
 * Choisit le meilleur candidat MovieBox pour un titre TMDB.
 * Bonus si l'année correspond (± 1 an). Retourne null sous le seuil.
 */
export function bestMatch<T extends MatchCandidate>(
  targetTitle: string,
  targetYear: string | undefined,
  candidates: T[],
  threshold = 0.6,
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const c of candidates) {
    let score = titleSimilarity(targetTitle, c.title);
    if (targetYear && c.year) {
      const diff = Math.abs(parseInt(targetYear) - parseInt(c.year));
      if (!isNaN(diff)) {
        if (diff === 0) score += 0.08;
        else if (diff === 1) score += 0.03;
        else if (diff > 3) score -= 0.05;
      }
    }
    if (!best || score > best.score) best = { item: c, score };
  }
  return best && best.score >= threshold ? best : null;
}
