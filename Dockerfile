FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY server.js ./
COPY tauron-reader ./
COPY start.sh ./

# Make scripts executable
RUN chmod +x tauron-reader start.sh

# Create data directory for persistent storage
RUN mkdir -p /data/buffer

# Expose port
EXPOSE 8765

# Start application using start script
CMD ["/bin/sh", "start.sh"]