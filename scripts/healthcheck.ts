/* eslint-disable no-console */
/**
 * Surveillance du contrat de l'API — à faire tourner sur planificateur.
 *
 * Ce n'est PAS un « ping ». Toutes les pannes réellement vécues sur ce projet
 * ont un point commun : **l'amont répondait 200 avec `code: 0, message: "ok"`,
 * et des données fausses**. Un contrôle de disponibilité ne les aurait vues
 * dans aucun cas :
 *
 *  - 05/08 : `api3.aoneroom.com` passe en 404 sur toutes les routes, du jour au
 *            lendemain, sans prévenir.
 *  - 06/08 : `search/v2` renvoie des BLOCS et non des titres → 0 résultat, avec
 *            `code: 0, ok`.
 *  - 07/08 : `categoryType` cesse d'être pris en compte → six rails d'accueil
 *            rigoureusement identiques, 12 titres pour 72 places.
 *  - 08/08 : le scraper mobile n'implémente pas `downloads()` → un titre
 *            regardable mais pas téléchargeable, sans erreur nulle part.
 *
 * D'où des assertions SÉMANTIQUES : on vérifie que la réponse a du SENS, pas
 * qu'elle arrive. Chaque contrôle ci-dessous correspond à un incident réel.
 *
 * Sortie : code 0 si tout va bien, 1 si au moins un contrôle critique échoue.
 * Les avertissements (dégradations tolérables) ne font pas échouer le job.
 */

const BASE = process.env.API_BASE || 'https://dexmovies-api.vercel.app';
const PWA = process.env.PWA_BASE || 'https://pwa.iafr-ahd.com';
const PI = process.env.PI_BASE || 'https://resolver.iafr-ahd.com';

/** Fiches de référence, choisies pour couvrir les cas qui ont cassé. */
const SERIE_VF = '1087731141295178920'; // Opérations spéciales : Lioness [VF]
const SERIE_DOUBLEE = '1377981790605953880'; // même série, fiche à doublages esla/ptbr

type Gravite = 'critique' | 'avertissement';
interface Souci { gravite: Gravite; ou: string; quoi: string; }

const soucis: Souci[] = [];
const ok: string[] = [];

function verifier(gravite: Gravite, ou: string, condition: boolean, quoi: string): void {
  if (condition) ok.push(`${ou} — ${quoi}`);
  else soucis.push({ gravite, ou, quoi });
}

async function get(chemin: string): Promise<any> {
  const url = `${BASE}${chemin}${chemin.includes('?') ? '&' : '?'}x=${Date.now()}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return { __http: r.status };
    return await r.json();
  } catch (e: any) {
    return { __erreur: e?.message || String(e) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Ajoute un paramètre unique : on veut l'état RÉEL du serveur, pas une copie
 * gardée par un intermédiaire. Sans ça, la surveillance peut confirmer un
 * déploiement qui n'a jamais eu lieu.
 */
function sansCache(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
}

/** Récupère une ressource en TEXTE — le PWA sert du HTML, pas du JSON. */
async function getTexte(url: string): Promise<{ status: number; corps: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(sansCache(url), { signal: ctrl.signal });
    return { status: r.status, corps: r.ok ? await r.text() : '' };
  } catch {
    return { status: 0, corps: '' };
  } finally {
    clearTimeout(t);
  }
}

async function statut(url: string): Promise<number> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    return (await fetch(sansCache(url), { signal: ctrl.signal })).status;
  } catch {
    return 0;
  } finally {
    clearTimeout(t);
  }
}

async function controlerSante(): Promise<void> {
  const h = await get('/health');
  verifier('critique', '/health', h?.status === 'ok', 'le service répond');
  // Sans cache L2, chaque instance repart de zéro : l'amont prend toute la
  // charge et les temps de réponse s'effondrent aux heures de pointe.
  verifier('avertissement', '/health', h?.dependencies?.cacheL2?.reachable === true,
    'le cache partagé Redis est joignable');
  const ouverts = Object.keys(h?.dependencies?.openCircuits || {});
  verifier('avertissement', '/health', ouverts.length === 0,
    `aucun disjoncteur ouvert (ouverts : ${ouverts.join(', ') || 'aucun'})`);
}

async function controlerAccueil(): Promise<void> {
  const d = await get('/api/dex/home?lang=fr');
  const sections: any[] = d?.data?.sections || [];
  const source = d?.meta?.source;

  verifier('critique', '/home', sections.length >= 8,
    `au moins 8 rails (reçu ${sections.length})`);
  verifier('critique', '/home', sections.some((s) => s.type === 'banner'),
    'une bannière est présente');

  // Incident du 07/08 : six rails au contenu identique.
  const signatures = sections.map((s) => (s.items || []).map((i: any) => i.subjectId).join(','));
  verifier('critique', '/home', new Set(signatures).size === signatures.length,
    'aucun rail dupliqué');

  verifier('critique', '/home', sections.every((s) => (s.items || []).length > 0),
    'aucun rail vide');

  const items = sections.flatMap((s) => s.items || []);
  const avecSlug = items.filter((i: any) => i.detailPath).length;
  // Le slug évite un aller-retour par titre au moment du clic.
  verifier('avertissement', '/home', items.length > 0 && avecSlug / items.length >= 0.8,
    `au moins 80 % des titres ont leur slug (${avecSlug}/${items.length})`);

  const uniques = new Set(items.map((i: any) => i.subjectId)).size;
  verifier('critique', '/home', items.length === 0 || uniques / items.length >= 0.5,
    `au moins la moitié des titres sont distincts (${uniques}/${items.length})`);

  // Perdre l'API mobile fait retomber sur le h5 : ça marche encore, mais sans
  // les langues déclarées ni les rendus 1080p. À savoir AVANT que ça se voie.
  verifier('avertissement', '/home', source === 'moviebox-hmac',
    `servi par l'API mobile (reçu : ${source})`);
}

async function controlerRecherche(): Promise<void> {
  const d = await get('/api/dex/search?q=naruto&lang=fr');
  const items: any[] = d?.data?.items || [];
  // Incident du 06/08 : 0 résultat avec `code: 0, ok` côté amont.
  verifier('critique', '/search', items.length >= 5,
    `au moins 5 résultats pour « naruto » (reçu ${items.length})`);
  verifier('critique', '/search', items.every((i) => i.subjectId && i.title),
    'chaque résultat a un identifiant et un titre');
}

async function controlerFiche(): Promise<void> {
  const d = await get(`/api/dex/detail/${SERIE_DOUBLEE}?lang=fr`);
  const f = d?.data || {};
  verifier('critique', '/detail', Boolean(f.title), 'la fiche a un titre');
  verifier('avertissement', '/detail', (f.cast || []).length > 0, 'le casting est renseigné');
  verifier('avertissement', '/detail', Boolean(f.coverUrl || f.posterUrl), 'une image est fournie');
}

async function controlerLecture(): Promise<void> {
  for (const [nom, id] of [['VF', SERIE_VF], ['à doublages', SERIE_DOUBLEE]] as const) {
    const d = await get(`/api/dex/stream/${id}?season=1&episode=1&lang=fr`);
    const sources: any[] = d?.data?.sources || [];
    verifier('critique', `/stream (${nom})`, sources.length > 0,
      `au moins une source lisible (reçu ${sources.length})`);

    // Incident du 05/08 : la première source servie était un doublage espagnol
    // non déclaré, choisi parce qu'il était mieux défini que l'original.
    if (sources.length > 0) {
      verifier('critique', `/stream (${nom})`, sources[0].audioTrack !== 'translated',
        `la première source n'est pas un doublage (${sources[0].audioTrack})`);
    }
  }
}

async function controlerTelechargement(): Promise<void> {
  // Incident du 08/08 : le scraper mobile n'implémentait pas downloads(), tout
  // repartait en silence sur le h5.
  //
  // ⚠️ L'assertion porte sur une fiche dont on SAIT qu'elle a des fichiers
  // progressifs. Tous les titres n'en ont pas : certains ne sont servis qu'en
  // DASH, qui ne se télécharge pas d'un bloc — ce n'est pas une panne, c'est le
  // catalogue. Tester un titre au hasard ferait sonner l'alarme pour rien, et
  // une alarme qui sonne pour rien finit par être ignorée.
  const d = await get(`/api/dex/download/${SERIE_VF}?season=1&episode=1&lang=fr`);
  const fichiers: any[] = d?.data?.files || [];
  verifier('critique', '/download', fichiers.length > 0,
    `au moins un fichier téléchargeable sur une fiche qui en a (reçu ${fichiers.length})`);
  verifier('critique', '/download', fichiers.every((f) => f.url && f.quality > 0),
    'chaque fichier a une URL et une définition');

  // Purement informatif : une fiche uniquement DASH est un cas légitime.
  const alt = await get(`/api/dex/download/${SERIE_DOUBLEE}?season=1&episode=1&lang=fr`);
  const nAlt = (alt?.data?.files || []).length;
  console.log(`  INFO fiche à doublages : ${nAlt} fichier(s) — 0 est normal si elle n'existe qu'en DASH`);
}

async function controlerRelaisEtVf(): Promise<void> {
  const s = await get('/api/dex/vf/status');
  // Le Pi est une machine résidentielle : c'est le point de défaillance unique
  // connu du projet. Savoir qu'il est tombé AVANT les utilisateurs, c'est tout
  // l'intérêt de cette surveillance.
  verifier('avertissement', '/vf/status', s?.data?.ok === true,
    `le relais répond (via ${s?.data?.via || 'inconnu'}, hôte ${s?.data?.host || 'inconnu'})`);

  const l = await get('/api/dex/vf/list?page=1');
  const items: any[] = l?.data?.items || [];
  verifier('critique', '/vf/list', items.length > 0,
    `le catalogue VF n'est pas vide (reçu ${items.length})`);
}

/**
 * PWA — elle est servie par le Raspberry Pi, pas par Vercel : ni le déploiement
 * du backend ni la CI ne la surveillent autrement.
 */
async function controlerPwa(): Promise<void> {
  const page = await getTexte(`${PWA}/`);
  verifier('critique', 'PWA', page.status === 200, `la page répond (HTTP ${page.status})`);
  if (page.status !== 200) return;

  // ⚠️ LE contrôle qui compte. Le 08/08, un `scp` a déposé le build À CÔTÉ du
  // dossier servi : le site a continué d'afficher la version précédente, sans
  // la moindre erreur — ni au scp, ni au redémarrage, ni dans les journaux.
  // Un simple « la page répond » est donc aveugle. On vérifie que les fichiers
  // référencés par le HTML servi EXISTENT réellement.
  const refs = [...page.corps.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  verifier('critique', 'PWA', refs.length >= 2,
    `le HTML référence ses fichiers compilés (${refs.length} trouvés)`);
  for (const ref of refs) {
    const code = await statut(`${PWA}${ref}`);
    verifier('critique', 'PWA', code === 200, `${ref} est bien servi (HTTP ${code})`);
  }

  // Sans manifeste en `standalone`, « Installer » donne un raccourci de
  // navigateur : plus de barre d'onglets ni de plein écran, l'illusion tombe.
  const man = await getTexte(`${PWA}/manifest.webmanifest`);
  verifier('critique', 'PWA', man.status === 200, 'le manifeste est servi');
  if (man.status === 200) {
    let m: any = {};
    try { m = JSON.parse(man.corps); } catch { /* manifeste illisible */ }
    verifier('critique', 'PWA', m.display === 'standalone',
      `installable en plein écran (display = ${m.display})`);
    verifier('avertissement', 'PWA', (m.icons || []).length >= 2, "les icônes d'installation sont déclarées");
  }

  // Les polices sont l'identité visuelle : sans elles le rendu retombe en
  // police système et ne ressemble plus à l'app.
  const police = await statut(`${PWA}/fonts/jakarta_bold.ttf`);
  verifier('avertissement', 'PWA', police === 200, `les polices de l'app sont servies (HTTP ${police})`);

  const sw = await statut(`${PWA}/sw.js`);
  verifier('avertissement', 'PWA', sw === 200, `le service worker est servi (HTTP ${sw})`);
}

/** Raspberry Pi — machine résidentielle, point de défaillance unique connu. */
async function controlerPi(): Promise<void> {
  const code = await statut(`${PI}/health`);
  verifier('avertissement', 'Pi', code === 200, `le resolver répond (HTTP ${code})`);
}

/**
 * Contrat consommé par l'app ANDROID.
 *
 * C'est le contrôle le plus important pour les APK DÉJÀ INSTALLÉES : elles ne
 * se mettent pas à jour toutes seules. Gson associe le JSON aux champs par
 * NOM ; un champ non-nullable de `Models.kt` absent de la réponse devient
 * `null`, et Kotlin lève au premier accès — écran blanc ou fermeture, chez des
 * utilisateurs dont on ne peut plus rien corriger à distance.
 *
 * Renommer un champ côté serveur casse donc toutes les versions en circulation.
 * Aucun test backend ne le voit : la réponse reste un JSON parfaitement valide.
 */
async function controlerContratAndroid(): Promise<void> {
  const manque = (o: any, champs: string[]) =>
    champs.filter((c) => o?.[c] === undefined || o?.[c] === null);

  const home = await get('/api/dex/home?lang=fr');
  const item = (home?.data?.sections || []).flatMap((s: any) => s.items || [])[0];
  verifier('critique', 'contrat Android', Boolean(item), "l'accueil renvoie au moins un titre");
  if (item) {
    // ContentItem : champs déclarés NON-NULL côté Kotlin.
    const absents = manque(item, ['subjectId', 'title', 'posterUrl', 'type']);
    verifier('critique', 'contrat Android', absents.length === 0,
      `ContentItem complet (manquants : ${absents.join(', ') || 'aucun'})`);
  }

  const detail = await get(`/api/dex/detail/${SERIE_DOUBLEE}?lang=fr`);
  const d = detail?.data;
  if (d) {
    const absents = manque(d, ['subjectId', 'title', 'posterUrl', 'type', 'dubs', 'freeEpisodes']);
    verifier('critique', 'contrat Android', absents.length === 0,
      `ContentDetail complet (manquants : ${absents.join(', ') || 'aucun'})`);
  }

  const flux = await get(`/api/dex/stream/${SERIE_VF}?season=1&episode=1&lang=fr`);
  const f = flux?.data;
  if (f) {
    const absents = manque(f, ['sources', 'dubs', 'subtitles', 'hasResource', 'freeEpisodes']);
    verifier('critique', 'contrat Android', absents.length === 0,
      `StreamData complet (manquants : ${absents.join(', ') || 'aucun'})`);
    const s0 = (f.sources || [])[0];
    if (s0) {
      const absentsSrc = manque(s0, ['url', 'format', 'quality']);
      verifier('critique', 'contrat Android', absentsSrc.length === 0,
        `StreamSource complet (manquants : ${absentsSrc.join(', ') || 'aucun'})`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`Surveillance — API ${BASE}
              PWA ${PWA}
              Pi  ${PI}`);
  console.log(`${new Date().toISOString()}\n`);

  await controlerSante();
  await controlerAccueil();
  await controlerRecherche();
  await controlerFiche();
  await controlerLecture();
  await controlerTelechargement();
  await controlerRelaisEtVf();
  await controlerContratAndroid();
  await controlerPwa();
  await controlerPi();

  for (const l of ok) console.log(`  OK   ${l}`);

  const critiques = soucis.filter((s) => s.gravite === 'critique');
  const avertissements = soucis.filter((s) => s.gravite === 'avertissement');

  if (avertissements.length > 0) {
    console.log('');
    for (const a of avertissements) console.log(`  ATTENTION  ${a.ou} — ${a.quoi}`);
  }
  if (critiques.length > 0) {
    console.log('');
    for (const c of critiques) console.log(`  ECHEC      ${c.ou} — ${c.quoi}`);
  }

  console.log(`\n${ok.length} contrôles passés, ${avertissements.length} avertissement(s), ${critiques.length} échec(s).`);

  if (critiques.length > 0) {
    // Résumé exploitable directement dans la notification.
    console.log(`\nRESUME=${critiques.map((c) => `${c.ou}: ${c.quoi}`).join(' | ')}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('La surveillance a échoué :', e);
  process.exit(1);
});
