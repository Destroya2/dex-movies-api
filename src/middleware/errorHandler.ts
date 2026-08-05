import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
      meta: { timestamp: Date.now() },
    });
    return;
  }

  // Erreurs du parseur de corps (body-parser) : ce sont des fautes du CLIENT,
  // pas des pannes du serveur. Les laisser tomber dans le 500 générique était
  // trompeur — l'appelant croyait à une panne alors qu'il devait corriger sa
  // requête, et ça polluait les métriques d'erreur serveur.
  const type = (err as any)?.type;
  if (type === 'entity.too.large') {
    res.status(413).json({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Corps de requête trop volumineux' },
      meta: { timestamp: Date.now() },
    });
    return;
  }
  if (type === 'entity.parse.failed') {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Corps de requête JSON invalide' },
      meta: { timestamp: Date.now() },
    });
    return;
  }

  logger.error('Unhandled error', { error: err.message, stack: err.stack });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
    meta: { timestamp: Date.now() },
  });
}
