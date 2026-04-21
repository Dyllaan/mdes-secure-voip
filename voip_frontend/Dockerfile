FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . ./
RUN npm run build:web

FROM nginxinc/nginx-unprivileged:alpine
ARG NGINX_CONF=nginx.conf
COPY ${NGINX_CONF} /etc/nginx/nginx.conf
COPY 40-env-js.sh /docker-entrypoint.d/40-env-js.sh
COPY --from=build /app/dist /usr/share/nginx/html
USER root
RUN mkdir -p /usr/share/nginx/html/config && \
    chown -R nginx:nginx /usr/share/nginx/html/config && \
    chmod +x /docker-entrypoint.d/40-env-js.sh
USER nginx
EXPOSE 8080