ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine
ARG NGINX_IMAGE=public.ecr.aws/docker/library/nginx:1.28-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client ./
COPY shared /app/shared
RUN npm run build

FROM ${NGINX_IMAGE} AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
