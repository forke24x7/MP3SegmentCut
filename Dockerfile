FROM node:24-alpine AS encoder
WORKDIR /build
RUN npm pack lamejs@1.2.1 --ignore-scripts --quiet \
    && echo 'd8d099ef788808c15bc9b4a407dd23ae935feb1152e6bb0efdcd24e3e91c2a2d  lamejs-1.2.1.tgz' | sha256sum -c - \
    && tar -xzf lamejs-1.2.1.tgz

FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/
COPY --from=encoder /build/package/lame.min.js /build/package/LICENSE /usr/share/nginx/html/vendor/
