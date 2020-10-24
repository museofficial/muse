FROM node:14-alpine AS base

# Install ffmpeg
RUN apk add  --no-cache ffmpeg

WORKDIR /usr/app

COPY package* ./

# Dependencies
FROM base AS dependencies

RUN npm install

# Build app
FROM dependencies AS builder

COPY . .

RUN npm run build

RUN ls

# Only copy essentials
FROM base AS prod
RUN ls
COPY --from=builder /usr/app/dist dist

RUN npm i --only=prod

ENV DATA_DIR /data

CMD ["npm", "run", "start"]
