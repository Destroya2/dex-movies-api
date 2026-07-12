import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Dex Movies API',
      version: '1.0.0',
      description: 'Backend API pour Dex Movies — agrégation et proxy de contenu streaming via MovieBox (HMAC-MD5 + H5 fallback)',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Development' },
    ],
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
