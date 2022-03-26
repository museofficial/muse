FROM node:16.13.0 AS base

# Install ffmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Install dependencies
FROM base AS dependencies

WORKDIR /usr/app

COPY package.json .
COPY yarn.lock .

RUN yarn install --prod

# Only keep what's necessary to run
FROM base AS runner

WORKDIR /usr/app

COPY --from=dependencies /usr/app/node_modules node_modules

COPY . .

RUN yarn prisma generate

ARG COMMIT_HASH=unknown

ENV DATA_DIR /data
ENV NODE_ENV production
ENV BUILD_DATE $(date)
ENV COMMIT_HASH $COMMIT_HASH

CMD ["yarn", "start"]
