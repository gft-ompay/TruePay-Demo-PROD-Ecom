# Optional container image — for hosts that prefer Docker (Render also supports
# "Docker" as the runtime). The app has ZERO npm dependencies, so this is tiny.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
# No dependencies to install, but keep the step for parity / future deps.
RUN npm install --omit=dev || true
COPY . .
# Render/most PaaS inject PORT; the app reads it. Expose a default for local runs.
ENV PORT=6012
EXPOSE 6012
CMD ["node", "server.js"]
