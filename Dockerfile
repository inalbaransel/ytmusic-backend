FROM node:20-slim

WORKDIR /app

# Prisma'nın çalışması için gerekli sistem paketleri
RUN apt-get update -y && apt-get install -y openssl

COPY package*.json ./
# Önce prisma klasörünü kopyalıyoruz
COPY prisma ./prisma/ 

RUN npm install

COPY . .

# Prisma client'ı oluştur
RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "start"]