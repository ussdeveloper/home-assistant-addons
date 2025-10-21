FROM alpine:latest

# Install Go and cron
RUN apk add --no-cache go dcron jq

# Set working directory
WORKDIR /app

# Copy Go modules
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY tauron-stats.go ./

# Build the application
RUN go build -o tauron-reader .

# Copy run script
COPY run.sh /run.sh
RUN chmod +x /run.sh