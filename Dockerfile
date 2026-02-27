# ====== BASE IMAGE ======
FROM node:20-alpine

# ====== WORKDIR ======
WORKDIR /app

# ====== COPY DEPENDENCIES ======
COPY package*.json ./

# ====== INSTALL ======
RUN npm install

# ====== COPY PROJECT ======a
COPY . .

# ====== CREATE UPLOADS FOLDER ======
RUN mkdir -p /app/uploads

# ====== EXPOSE PORT ======
EXPOSE 5000

# ====== START ======
CMD ["node", "server.js"]
