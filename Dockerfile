FROM node:16.13.0 AS base

# Install ffmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/app

COPY package.json .
COPY yarn.lock .

# Install prod dependencies
RUN yarn install --prod

# Dependencies
FROM base AS dependencies

# Install dev dependencies
RUN yarn install

# Build app
FROM dependencies AS builder

COPY . .

RUN yarn prisma generate && yarn build

# Only copy essentials
FROM base AS prod

COPY --from=builder /usr/app/dist dist
COPY --from=builder /usr/app/schema.prisma .
COPY --from=builder /usr/app/migrations migrations

RUN yarn prisma generate

ENV DATA_DIR /data

CMD ["yarn", "start"]
