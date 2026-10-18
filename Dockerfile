# Dev server (with the embedded multiplayer relay) in a container, so it keeps serving independently.
FROM node:24-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# pnpm 11 blocks dependency build scripts by default; run them explicitly for the ones that need it (esbuild, sharp).
RUN pnpm install || pnpm rebuild esbuild sharp
COPY . .
EXPOSE 5173
CMD ["pnpm", "exec", "vite", "--host", "0.0.0.0", "--port", "5173"]
