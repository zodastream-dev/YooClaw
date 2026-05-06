FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .

EXPOSE 8081

CMD ["node", "--import", "tsx", "server/index.ts"]
