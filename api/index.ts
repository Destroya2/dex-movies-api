import { createApp } from '../src/app';

/**
 * Point d'entrée VERCEL (production). Toute la construction de l'application
 * vit dans `src/app.ts` : ce fichier ne fait qu'activer `trust proxy`, seule
 * différence réelle avec l'exécution locale.
 *
 * ⚠️ Ne PAS redéclarer de middleware ou de route ici : c'est exactement ce qui
 * avait fait diverger la prod du dev (routes /api/proxy et health enrichi
 * absents en ligne pendant des semaines, sans erreur visible).
 */
export default createApp({ trustProxy: true });
