FROM jrottenberg/ffmpeg:4.0-scratch
FROM node:13

# Copy ffmpeg bins
COPY --from=0 / /

WORKDIR /usr/app

COPY package.json .

RUN yarn install

COPY . .

RUN yarn run build

ENV DATA_DIR /data

CMD ["yarn", "start"]
