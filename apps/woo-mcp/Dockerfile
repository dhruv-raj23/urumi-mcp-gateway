# Build and test using the committed dependency lockfile.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests

RUN npm test && npm run build

# Production image contains only runtime dependencies and compiled output.
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
