FROM node:14.15.4-alpine AS base

# Install ffmpeg and build dependencies
RUN apk add --no-cache ffmpeg python make g++

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

RUN yarn build

# Only copy essentials
FROM base AS prod

COPY --from=builder /usr/app/dist dist

ENV DATA_DIR /data

CMD ["yarn", "start"]
