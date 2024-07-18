FROM node:18-bullseye-slim AS base

# openssl will be a required package if base is updated to 18.16+ due to node:*-slim base distro change
# https://github.com/prisma/prisma/issues/19729#issuecomment-1591270599
# Install ffmpeg
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
    ffmpeg \
    tini \
    openssl \
    ca-certificates \
    && apt-get autoclean \
    && apt-get autoremove \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
FROM base AS dependencies

WORKDIR /usr/app

COPY package.json .
COPY yarn.lock .

RUN yarn install --prod
RUN cp -R node_modules /usr/app/prod_node_modules

RUN yarn install

FROM dependencies AS builder

COPY . .

# Run tsc build
RUN yarn prisma generate
RUN yarn build

# Only keep what's necessary to run
FROM base AS runner

WORKDIR /usr/app

COPY --from=builder /usr/app/dist ./dist
COPY --from=dependencies /usr/app/prod_node_modules node_modules
COPY --from=builder /usr/app/node_modules/.prisma/client ./node_modules/.prisma/client

COPY . .

ARG COMMIT_HASH=unknown
ARG BUILD_DATE=unknown

ENV DATA_DIR /data
ENV NODE_ENV production
ENV COMMIT_HASH $COMMIT_HASH
ENV BUILD_DATE $BUILD_DATE

CMD ["tini", "--", "node", "--enable-source-maps", "dist/scripts/migrate-and-start.js"]
