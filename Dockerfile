# Car Combat Arena -- EGY kep, ami a klienst es a jatekszervert is viszi.
#
# A kliens statikus fajljait ugyanaz a Node folyamat szolgalja ki, mint
# a WebSocketet (terv 15.7). Igy egy origin van: nincs mixed-content
# gond (HTTPS-en a ws:// blokkolt), nincs CORS, es a szerver cimet sem
# kell a kliens buildjebe egetni.

# --- 1. Build ---
# A TELJES repo kell: a szerver es a kliens is a @cca/shared munkateret
# hasznalja, ami nyers TypeScriptet exportal.
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci

COPY . .
RUN npm run build --workspace @cca/client \
 && npm run build --workspace @cca/server

# --- 2. Futtatas ---
# Csak a lefordult kimenet es a FUTASIDEJU fuggosegek kerulnek ide.
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# A szerver koteg a "ws" es a Rapier csomagot KIVUL hagyja (a Rapier
# WASM betoltese kotegelve eltorne), ezert azokat telepiteni kell.
# Ellenorizve: a koteg futasidoben CSAK ezt a kettot es node-beepitett
# modulokat importal.
#
# SZANDEKOSAN a teljes munkateret telepitjuk ("npm ci --omit=dev"), nem
# csak a szerver csomagot: a workspace-re szukitett valtozat a linkelt
# @cca/shared miatt tovabbi kapcsolokat igenyelne, es ezt itt nem tudtam
# kiprobalni (nincs Docker a fejlesztoi gepen). Az ara nehany MB (a
# kliens "three" fuggosege), a nyeresege az, hogy nem egy nem tesztelt
# npm-kapcsolo dontse el, elindul-e a szerver.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev

COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist

ENV CLIENT_DIR=/app/packages/client/dist
ENV PORT=8080
EXPOSE 8080

# Nem rootkent futunk: a node kepben van egy `node` felhasznalo.
USER node

CMD ["node", "packages/server/dist/server.js"]
