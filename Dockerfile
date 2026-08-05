# syntax=docker/dockerfile:1
#
# Image de l'API Dex Movies.
#
# POURQUOI : la production tourne sur Vercel (fonctions serverless), ce qui
# impose une limite dure de 30 s par requête — déjà atteinte par la résolution
# de flux — et fait dépendre tout le service d'un seul hébergeur. Cette image
# est la porte de sortie : la même application, à l'identique, sur n'importe
# quel hôte Docker et sans limite de durée. Elle sert aussi au développement
# local avec un vrai cache L2 (voir docker-compose.yml).

# ── Build : dépendances complètes + compilation TypeScript ───────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# ── Exécution : uniquement le nécessaire ─────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 dex && adduser --system --uid 1001 dex

COPY --from=builder /app/package*.json ./
# `--omit=dev` retire jest, ts-jest, tsx, nock… : l'image finale n'embarque
# aucun outillage de test — autant de surface d'attaque en moins.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/ dist/

# Jamais root : une faille dans une dépendance ne doit pas livrer la machine.
USER dex
EXPOSE 3000
ENV NODE_ENV=production

# Interroge la VRAIE route de santé — celle qui teste ses dépendances (Redis,
# disjoncteurs) — et non un simple « le port répond ».
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
