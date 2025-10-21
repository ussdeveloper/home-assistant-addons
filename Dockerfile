FROM alpine:latest

# Install Go and cron
RUN apk add --no-cache go dcron

# Set working directory
WORKDIR /app

# Copy Go modules
COPY tauron-stats/go.mod tauron-stats/go.sum ./
RUN go mod download

# Copy source code
COPY tauron-stats/ ./

# Build the application
RUN go build -o tauron-reader .

# Copy run script
COPY run.sh /run.sh
RUN chmod +x /run.sh