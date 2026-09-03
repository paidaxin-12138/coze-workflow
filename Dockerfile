FROM node:18-slim

# 安装编译工具（better-sqlite3 需要）
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# 安装依赖（此时已有编译工具）
RUN npm install

COPY . .

EXPOSE 3000

FROM node:18-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# ✅ 强制在构建阶段运行 index.js，暴露错误
RUN node index.js || echo "Error in index.js, continuing..."

EXPOSE 3000

CMD ["node", "index.js"]