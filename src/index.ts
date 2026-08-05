import { ENV } from './config/env';
import { logger } from './middleware/logger';
import { createApp } from './app';

/**
 * Point d'entrée LOCAL (dev + tests). La production passe par `api/index.ts`
 * (fonction Vercel). Les deux construisent la même application via `createApp()`
 * — ne rien ajouter ici qui doive exister en ligne.
 */
const app = createApp();

if (!process.env.TEST_MODE) {
  app.listen(ENV.PORT, '0.0.0.0', () => {
    logger.info(`Dex Movies API running on http://0.0.0.0:${ENV.PORT}`);
  });
}

export default app;
