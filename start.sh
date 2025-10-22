#!/bin/sh
set -e

echo "🚀 Starting Tauron Reader Addon..."

# Load Home Assistant options
if [ -f /data/options.json ]; then
    echo "✅ Loading configuration from /data/options.json"
    cp /data/options.json /app/tauron-db-config.json
else
    echo "⚠️ /data/options.json not found, using default config"
    if [ ! -f /app/tauron-db-config.json ]; then
        echo "❌ No configuration file found!"
        exit 1
    fi
fi

echo "📋 Configuration loaded"

# Test database connection
echo "🔍 Testing database connection..."
if ./tauron-reader -test-db; then
    echo "✅ Database connection OK"
else
    echo "❌ Database connection failed!"
    exit 1
fi

# Test Tauron service connection
echo "🔍 Testing Tauron service connection..."
if ./tauron-reader -test-service; then
    echo "✅ Tauron service connection OK"
else
    echo "⚠️ Tauron service connection failed (will retry during scheduled runs)"
fi

# Start the Node.js server
echo "🌐 Starting web server..."
exec node server.js
