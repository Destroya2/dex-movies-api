export const ENV = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',

  CACHE_HOME_TTL: parseInt(process.env.CACHE_HOME_TTL || '300', 10),
  CACHE_DETAIL_TTL: parseInt(process.env.CACHE_DETAIL_TTL || '600', 10),
  CACHE_SEARCH_TTL: parseInt(process.env.CACHE_SEARCH_TTL || '120', 10),
  CACHE_STREAM_TTL: parseInt(process.env.CACHE_STREAM_TTL || '1800', 10),
  CACHE_TOKEN_TTL: parseInt(process.env.CACHE_TOKEN_TTL || '1500', 10),

  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),

  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};
