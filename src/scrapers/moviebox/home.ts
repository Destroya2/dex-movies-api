import { ENDPOINTS } from '../../config/constants';
import { mobileGet } from './http';
import { HomeSection, ContentItem, CategoryContent } from './types';
import { slugDepuisUrl } from '../../utils/detailSlug';

/**
 * Accueil de l'API mobile.
 *
 * ⚠️ L'implémentation précédente appelait `tab/ranking-list` SIX fois, avec
 * `tabId=0` codé en dur et un `categoryType` différent à chaque appel, pour
 * fabriquer six rails « Trending », « Bollywood », « Hollywood »… Vérifié le
 * 07/08/2026 : **l'amont ignore purement et simplement `categoryType`**. Les six
 * appels renvoyaient donc la MÊME liste de 12 titres — 12 titres uniques
 * étalés sur 72 emplacements, six rails rigoureusement identiques à l'écran,
 * et aucune bannière. Les autres combinaisons de paramètres (`tabId=<id>`,
 * `tabId=<id>&categoryType=0`) ne répondent pas du tout.
 *
 * Le vrai flux d'accueil est `tab-operating` — celui que l'application
 * officielle appelle, et déjà utilisé ici pour obtenir le jeton invité. Il rend
 * 24 sections **déjà localisées en français** (« Séries Tendance », « Films
 * Tendance », « Animés populaires »), bannière comprise.
 */

/** Types de sections porteuses de contenu. Le reste (FILTER, SPORT_LIVE) est ignoré. */
const SECTION_BANNIERE = 'BANNER';
const SECTION_RAIL = 'SUBJECTS_MOVIE';
const SECTION_CUSTOM = 'CUSTOM';

// slugDepuisUrl vit désormais dans utils/detailSlug.ts : la recherche et la
// fiche en ont besoin exactement pareil, et les deux rendaient un slug vide
// faute de lire `detailUrl` plutôt qu'un `detailPath` que l'amont n'envoie pas.

/**
 * `corner` porte le marqueur de langue (« En français », « VOSTFR »).
 * C'est la seule source fiable : le titre ne suffit pas — « Kiss the French
 * Girl » n'est pas un doublage.
 */
function langueDepuisCorner(corner?: string): { isFrench?: boolean; language?: string } {
  if (!corner) return {};
  const c = String(corner).trim();
  if (/vostfr/i.test(c)) return { isFrench: true, language: 'VOSTFR' };
  if (/fran[cç]ais|\bvf\b/i.test(c)) return { isFrench: true, language: 'VF' };
  return {};
}

/**
 * Mappe une entrée d'accueil, quelle que soit la forme de la section.
 *
 * Les entrées de BANNER et de CUSTOM enveloppent le vrai contenu dans un objet
 * `subject`, en laissant `subjectId: 0` et `title: undefined` au niveau du
 * dessus. Lire le niveau du dessus donne donc des entrées vides — c'est le même
 * piège que celui déjà documenté sur les rails CUSTOM du scraper h5.
 */
function mapperEntree(entree: any, imagePaysage?: boolean): ContentItem | null {
  if (!entree) return null;
  const sujet = entree.subject || entree;
  const subjectId = String(sujet.subjectId || entree.subjectId || '');
  if (!subjectId || subjectId === '0') return null;

  const titre = sujet.title || entree.title;
  if (!titre) return null;

  const langue = langueDepuisCorner(sujet.corner || entree.corner);
  const affiche = sujet.cover?.url || entree.image?.url || '';

  return {
    subjectId,
    title: titre,
    posterUrl: affiche,
    // Sur la bannière, `image` est le visuel large de mise en avant ; ailleurs
    // il n'y a pas de paysage et on laisse le champ vide plutôt que d'y remettre
    // l'affiche verticale, qui s'afficherait étirée.
    coverUrl: imagePaysage ? (entree.image?.url || affiche) : undefined,
    type: (sujet.subjectType === 2 ? 'series' : 'movie') as 'series' | 'movie',
    rating: sujet.imdbRatingValue || sujet.imdbRate || sujet.rate || undefined,
    year: sujet.releaseDate ? String(sujet.releaseDate).substring(0, 4) : undefined,
    genres: sujet.genre ? String(sujet.genre).split(',').map((g: string) => g.trim()) : undefined,
    plot: sujet.description || undefined,
    country: sujet.countryName || undefined,
    detailPath: slugDepuisUrl(sujet.detailUrl || entree.detailUrl),
    badge: sujet.corner || entree.corner || undefined,
    ...langue,
  };
}

/** Extrait les entrées brutes d'une section selon son type. */
function entreesDeSection(section: any): { brutes: any[]; banniere: boolean } {
  switch (section?.type) {
    case SECTION_BANNIERE:
      return { brutes: section.banner?.banners || [], banniere: true };
    case SECTION_RAIL:
      return { brutes: section.subjects || [], banniere: false };
    case SECTION_CUSTOM:
      return { brutes: section.customData?.items || [], banniere: false };
    default:
      // FILTER (chips de catégories), SPORT_LIVE (retransmissions) : pas des
      // rails de contenu, rien à afficher dans la grille.
      return { brutes: [], banniere: false };
  }
}

export async function fetchHomepage(): Promise<HomeSection[]> {
  const json = await mobileGet(`${ENDPOINTS.tabOperating}?page=1&tabId=0&version=`, 'home');
  const brutes: any[] = json?.data?.items || [];

  const sections: HomeSection[] = [];
  for (const [index, section] of brutes.entries()) {
    const { brutes: entrees, banniere } = entreesDeSection(section);
    if (entrees.length === 0) continue;

    const vus = new Set<string>();
    const items: ContentItem[] = [];
    for (const e of entrees) {
      const item = mapperEntree(e, banniere);
      // Dédoublonnage INTRA-section : la bannière répète volontiers le même
      // titre sous deux visuels, et une liste à doublons casse les clés des
      // listes Compose côté app.
      if (item && !vus.has(item.subjectId)) {
        vus.add(item.subjectId);
        items.push(item);
      }
    }
    if (items.length === 0) continue;

    sections.push({
      id: String(section.opId || section.title || index),
      title: section.title || '',
      type: banniere ? 'banner' : 'row',
      items,
    });
  }

  return sections;
}

export async function fetchCategoryTabs(): Promise<{ id: string; title: string }[]> {
  const json = await mobileGet(`${ENDPOINTS.tabOperating}?page=1&tabId=0&version=`, 'home');
  const brutes: any[] = json?.data?.items || [];
  return brutes
    .filter((s) => entreesDeSection(s).brutes.length > 0 && s.title)
    .map((s, i) => ({ id: String(s.opId || i), title: String(s.title) }));
}

export async function fetchCategoryContent(
  tabId: string,
  page: number = 1
): Promise<CategoryContent> {
  const path = `${ENDPOINTS.rankingList}?tabId=0&categoryType=${tabId}&page=${page}&perPage=20`;
  const json = await mobileGet(path, 'home');
  const rawItems = json?.data?.items || json?.data?.subjects || [];
  const items = rawItems.map((e: any) => mapperEntree(e)).filter(Boolean) as ContentItem[];

  return {
    items,
    total: json?.data?.pager?.totalCount || items.length,
    page,
    hasMore: items.length >= 20,
  };
}
