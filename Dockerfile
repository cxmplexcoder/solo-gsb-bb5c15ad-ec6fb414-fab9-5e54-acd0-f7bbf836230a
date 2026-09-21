# 语法检查 / 构建阶段
FROM node:20-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 在该镜像内会使用预编译二进制；若需要源码编译，
# 可安装：python3 make g++
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 运行阶段
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# better-sqlite3 运行期原生依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public

RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "dist/server.js"]
