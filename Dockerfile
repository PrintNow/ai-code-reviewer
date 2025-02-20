# 使用 Node.js 18 Alpine 作为基础镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 yarn.lock
COPY package.json yarn.lock ./

# 安装依赖
RUN yarn config set strict-ssl false && \
    yarn install --frozen-lockfile

# 复制源代码
COPY . .

# 构建 TypeScript 代码
RUN yarn build

# 确保 bin 目录下的文件有执行权限
RUN chmod +x ./bin/index.js

# 设置环境变量
ENV PATH /app/bin:$PATH

# 设置入口点
ENTRYPOINT ["ai-code-reviewer"]
