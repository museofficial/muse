FROM node:14-alpine AS base

# Install ffmpeg and build dependencies
RUN apk add --no-cache ffmpeg python make g++

WORKDIR /usr/app

COPY package* ./

# Install prod dependencies
RUN npm i --only=prod

# Dependencies
FROM base AS dependencies

# Install dev dependencies
RUN npm install

# Build app
FROM dependencies AS builder

COPY . .

RUN npm run build

# Only copy essentials
FROM base AS prod

COPY --from=builder /usr/app/dist dist

ENV DATA_DIR /data

CMD ["npm", "run", "start"]
