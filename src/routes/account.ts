import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '../middleware/errorHandler';
import {
  createAccount,
  accountFromToken,
  createPairingCode,
  claimPairingCode,
  getData,
  setData,
  isSyncKind,
  Account,
} from '../utils/accounts';

const router = Router();

/**
 * Comptes anonymes et synchronisation multi-appareils.
 * Voir `utils/accounts.ts` pour le choix « anonyme + code d'appairage ».
 */

/**
 * Limite spécifique à la création de comptes et à l'appairage.
 *
 * Ces routes ÉCRIVENT dans la base : sans plafond dédié, n'importe qui pourrait
 * créer des comptes en boucle (saturation du stockage) ou balayer les codes à
 * 6 chiffres. La limite globale de l'API (100/min) est bien trop permissive
 * pour ça — un balayage à 100 essais/min couvre 1 000 000 de codes en 7 jours,
 * or un code ne vit que 10 minutes : ce plafond-ci rend l'attaque sans objet.
 */
const sensitiveLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  // Neutralisé pendant les tests : la suite crée volontairement des dizaines de
  // comptes et se ferait bloquer par son propre garde-fou. Le plafond réel est
  // vérifié en production (12 créations d'affilée → 429 attendu).
  skip: () => process.env.TEST_MODE === 'true',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: { code: 429, message: 'Trop de tentatives. Réessayez dans une minute.' },
    });
  },
});

function wrapAsync(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

interface AuthedRequest extends Request {
  account?: Account;
}

/** Exige un jeton de compte valide (`Authorization: Bearer <jeton>`). */
async function requireAccount(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const account = await accountFromToken(token);
  if (!account) {
    next(new AppError(401, 'UNAUTHORIZED', 'Jeton de compte absent ou invalide'));
    return;
  }
  req.account = account;
  next();
}

/**
 * @openapi
 * /api/dex/account:
 *   post:
 *     tags: [Account]
 *     summary: Crée un compte anonyme (aucune donnée personnelle demandée)
 */
router.post('/', sensitiveLimiter, wrapAsync(async (_req, res) => {
  const { id, token } = await createAccount();
  // Le jeton n'est montré qu'ICI : le serveur n'en garde que l'empreinte.
  res.json({ success: true, data: { accountId: id, token }, meta: { timestamp: Date.now() } });
}));

/**
 * @openapi
 * /api/dex/account/me:
 *   get:
 *     tags: [Account]
 *     summary: Vérifie la validité du jeton
 */
router.get('/me', requireAccount, wrapAsync(async (req: AuthedRequest, res) => {
  res.json({ success: true, data: req.account, meta: { timestamp: Date.now() } });
}));

/**
 * @openapi
 * /api/dex/account/pair:
 *   post:
 *     tags: [Account]
 *     summary: Génère un code d'appairage à 6 chiffres (valable 10 minutes)
 */
router.post('/pair', sensitiveLimiter, requireAccount, wrapAsync(async (req: AuthedRequest, res) => {
  const { code, expiresIn } = await createPairingCode(req.account!.id);
  res.json({ success: true, data: { code, expiresIn }, meta: { timestamp: Date.now() } });
}));

/**
 * @openapi
 * /api/dex/account/claim:
 *   post:
 *     tags: [Account]
 *     summary: Rattache l'appareil courant à un compte via un code d'appairage
 */
router.post('/claim', sensitiveLimiter, wrapAsync(async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) {
    throw new AppError(400, 'INVALID_CODE', 'Code invalide (6 chiffres attendus)');
  }
  const result = await claimPairingCode(code);
  if (!result) {
    // Message volontairement identique pour un code faux ou expiré : distinguer
    // les deux renseignerait un attaquant sur la validité des codes essayés.
    throw new AppError(404, 'CODE_UNKNOWN', 'Code inconnu ou expiré');
  }
  res.json({
    success: true,
    data: { accountId: result.id, token: result.token },
    meta: { timestamp: Date.now() },
  });
}));

/**
 * @openapi
 * /api/dex/account/sync/{kind}:
 *   get:
 *     tags: [Account]
 *     summary: Récupère les données synchronisées (history, favorites, settings)
 *   put:
 *     tags: [Account]
 *     summary: Enregistre les données synchronisées
 */
router.get('/sync/:kind', requireAccount, wrapAsync(async (req: AuthedRequest, res) => {
  const kind = String(req.params.kind);
  if (!isSyncKind(kind)) throw new AppError(400, 'INVALID_KIND', 'Type de données inconnu');
  const data = await getData(req.account!.id, kind);
  res.json({ success: true, data: data ?? null, meta: { timestamp: Date.now() } });
}));

router.put('/sync/:kind', requireAccount, wrapAsync(async (req: AuthedRequest, res) => {
  const kind = String(req.params.kind);
  if (!isSyncKind(kind)) throw new AppError(400, 'INVALID_KIND', 'Type de données inconnu');

  const payload = req.body?.data;
  if (payload === undefined) throw new AppError(400, 'MISSING_DATA', 'Champ `data` requis');

  // Plafond de taille : l'historique d'un utilisateur normal pèse quelques Ko.
  // Sans cette borne, un client bogué (ou malveillant) pourrait remplir la base.
  const taille = JSON.stringify(payload).length;
  if (taille > 256 * 1024) {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Données trop volumineuses (256 Ko maximum)');
  }

  await setData(req.account!.id, kind, payload);
  res.json({ success: true, data: { kind, bytes: taille }, meta: { timestamp: Date.now() } });
}));

export default router;
