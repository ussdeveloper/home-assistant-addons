FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy application
COPY server.js ./

# Expose port
EXPOSE 8765

# Start application
CMD ["npm", "start"]