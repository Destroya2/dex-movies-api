import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { logger } from './logger';

const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);

export const apiRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    logger.warn(`Rate limit exceeded for ${_req.ip}`);
    res.status(429).json({
      success: false,
      error: { code: 429, message: 'Trop de requetes. Reessaye dans une minute.' },
    });
  },
});
