#!/bin/sh
set -e

echo "🚀 Starting Tauron Reader Addon..."
echo "📁 Working directory: $(pwd)"

# Load Home Assistant options and convert to tauron-reader format
if [ -f /data/options.json ]; then
    echo "✅ Loading configuration from /data/options.json"
    # Copy for tauron-reader binary
    cp /data/options.json /app/tauron-db-config.json
    echo "✅ Configuration saved to /app/tauron-db-config.json"
else
    echo "⚠️ /data/options.json not found"
    if [ -f /app/tauron-db-config.json ]; then
        echo "✅ Using existing /app/tauron-db-config.json"
    elif [ -f ./tauron-db-config.json ]; then
        echo "✅ Using ./tauron-db-config.json"
    else
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
    echo "💡 Check your database host, credentials, and network connectivity"
    exit 1
fi

# Test Tauron service connection (non-critical)
echo "🔍 Testing Tauron service connection..."
if ./tauron-reader -test-service; then
    echo "✅ Tauron service connection OK"
else
    echo "⚠️ Tauron service connection failed (will retry during scheduled runs)"
fi

# Start the Node.js server
echo "🌐 Starting web server on port 8765..."
exec node server.js
