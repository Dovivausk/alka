# Web d'ALKA: pagines estatiques + endpoint dels formularis.
# Sense dependencies, nomes moduls natius de Node.
FROM node:22-alpine

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# no cal executar com a root
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
