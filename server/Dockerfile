ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
# shared/game.js is an ES module in both the browser and the API.
COPY --chown=node:node package.json ./
COPY --chown=node:node shared ./shared
COPY --chown=node:node server/package.json server/schema.sql ./server/
COPY --chown=node:node server/src ./server/src
COPY --from=dependencies --chown=node:node /app/server/node_modules ./server/node_modules
USER node
EXPOSE 3000
CMD ["node", "server/src/index.js"]
