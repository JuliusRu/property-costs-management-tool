# ---- build the React client ----
FROM node:24-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- runtime: Express + node:sqlite serves API and the built client ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY samples ./samples
COPY tsconfig.json ./
COPY --from=client /app/client/dist ./client/dist
# SQLite file and uploads live here — mount a volume in Coolify so they survive redeploys
RUN mkdir -p /app/data /app/uploads
VOLUME ["/app/data", "/app/uploads"]
EXPOSE 3000
ENV API_PORT=3000
CMD ["node", "--import", "tsx", "server/index.ts"]
