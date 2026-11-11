FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
COPY data ./data
COPY vite.config.js ./
RUN npm run build

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY data ./data
COPY --from=build /app/dist ./dist
USER node
EXPOSE 7810
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:7810/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
