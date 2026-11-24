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
# The Story wording (GET /api/story) is read from video/captions.md at run time; the rest of video/ stays out of the image.
COPY video/captions.md ./video/captions.md
COPY --from=build /app/dist ./dist
USER node
EXPOSE 7812
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:7812/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
