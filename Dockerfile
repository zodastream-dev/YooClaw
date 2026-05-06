FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .

EXPOSE 8081

CMD ["npx", "tsx", "server/index.ts"]
