FROM node:20-alpine

WORKDIR /app

ENV VITE_API_URL=https://tradeaid-production.up.railway.app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "start"]
