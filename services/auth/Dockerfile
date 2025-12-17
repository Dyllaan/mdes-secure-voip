FROM node:18-alpine

WORKDIR /app

# Install build tools for bcrypt
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3003

CMD ["npm", "start"]