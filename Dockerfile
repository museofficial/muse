FROM node:16.13.0-alpine AS base

RUN apk add --no-cache ffmpeg
RUN apk add --no-cache --virtual build-dependencies alpine-sdk python3 openssl-dev gcompat

WORKDIR /usr/app

COPY package.json .
COPY yarn.lock .

# Install prod dependencies
RUN yarn install --prod

# Dependencies
FROM base AS dependencies

# Install dev dependencies
RUN apk add --no-cache python3
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
