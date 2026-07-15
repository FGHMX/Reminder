FROM node:18-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
# Expose the port the app runs on
EXPOSE 3000
CMD ["npm", "start"]
