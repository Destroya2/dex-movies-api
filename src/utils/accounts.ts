import crypto from 'crypto';
import { persistentGet, persistentSet, persistentDel } from '../middleware/persistentCache';

/**
 * Comptes utilisateurs — **anonymes par défaut, appairables par code**.
 *
 * Choix de conception, et pourquoi il n'y a ni e-mail ni mot de passe :
 *
 * 1. **Le besoin réel est la continuité, pas l'identité.** Ce que l'utilisateur
 *    veut, c'est retrouver son historique et sa reprise de lecture sur un autre
 *    appareil ou après réinstallation. Un compte anonyme y répond entièrement.
 * 2. **Zéro friction.** Le compte se crée tout seul au premier lancement : pas
 *    d'écran d'inscription, pas de mot de passe oublié, pas d'e-mail à valider —
 *    donc pas de service d'envoi de courriels à opérer.
 * 3. **Zéro donnée personnelle à protéger.** Cette application diffuse des
 *    contenus sans licence (voir AUDIT-PROD §0) : conserver des e-mails et des
 *    mots de passe créerait une responsabilité supplémentaire, et une cible.
 *    On ne stocke que ce qui est nécessaire : un identifiant opaque et ce que
 *    l'utilisateur a regardé.
 *
 * L'appairage se fait par un **code à 6 chiffres, valable 10 minutes**, affiché
 * sur l'appareil déjà connecté et saisi sur le nouveau.
 */

const TOKEN_TTL_SEC = 3 * 365 * 24 * 3600; // 3 ans : l'app doit rester connectée
const PAIRING_TTL_SEC = 600;               // 10 min : un code court doit être bref
const DATA_TTL_SEC = 2 * 365 * 24 * 3600;

export interface Account {
  id: string;
  createdAt: number;
}

function tokenKey(token: string) {
  // On stocke l'EMPREINTE du jeton, jamais le jeton lui-même : une fuite de la
  // base ne permettrait pas de se connecter aux comptes.
  return `account:token:${crypto.createHash('sha256').update(token).digest('hex')}`;
}

const accountKey = (id: string) => `account:${id}`;
const pairKey = (code: string) => `account:pair:${code}`;
const dataKey = (id: string, kind: string) => `account:data:${id}:${kind}`;

/** Crée un compte anonyme et renvoie son jeton (montré UNE seule fois). */
export async function createAccount(): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const account: Account = { id, createdAt: Date.now() };

  await persistentSet(accountKey(id), account, TOKEN_TTL_SEC);
  await persistentSet(tokenKey(token), id, TOKEN_TTL_SEC);
  return { id, token };
}

/** Compte associé à ce jeton, ou null. */
export async function accountFromToken(token?: string | null): Promise<Account | null> {
  if (!token) return null;
  const id = await persistentGet<string>(tokenKey(token));
  if (!id) return null;
  const account = await persistentGet<Account>(accountKey(id));
  return account || null;
}

/**
 * Code d'appairage à 6 chiffres pour ce compte.
 * `crypto.randomInt` et non `Math.random` : un code devinable donnerait accès à
 * l'historique de quelqu'un d'autre.
 */
export async function createPairingCode(accountId: string): Promise<{ code: string; expiresIn: number }> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await persistentSet(pairKey(code), accountId, PAIRING_TTL_SEC);
  return { code, expiresIn: PAIRING_TTL_SEC };
}

/**
 * Consomme un code d'appairage et délivre un jeton au nouvel appareil.
 * Le code est détruit immédiatement : usage unique, pas de rejeu.
 */
export async function claimPairingCode(code: string): Promise<{ id: string; token: string } | null> {
  const accountId = await persistentGet<string>(pairKey(code));
  if (!accountId) return null;
  await persistentDel(pairKey(code));

  const account = await persistentGet<Account>(accountKey(accountId));
  if (!account) return null;

  const token = crypto.randomBytes(32).toString('base64url');
  await persistentSet(tokenKey(token), accountId, TOKEN_TTL_SEC);
  return { id: accountId, token };
}

/**
 * Données synchronisées d'un compte (historique, favoris…).
 *
 * Le serveur ne fait qu'entreposer : c'est le client qui décide de la forme.
 * Volontaire — l'app évolue plus vite que l'API, et un schéma serveur rigide
 * imposerait une migration à chaque changement d'écran.
 */
export async function getData<T>(accountId: string, kind: string): Promise<T | null> {
  return (await persistentGet<T>(dataKey(accountId, kind))) ?? null;
}

export async function setData<T>(accountId: string, kind: string, value: T): Promise<void> {
  await persistentSet(dataKey(accountId, kind), value, DATA_TTL_SEC);
}

/** Types de données synchronisables — liste fermée, pour ne pas devenir un entrepôt libre. */
export const SYNC_KINDS = ['history', 'favorites', 'settings'] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

export function isSyncKind(value: string): value is SyncKind {
  return (SYNC_KINDS as readonly string[]).includes(value);
}
