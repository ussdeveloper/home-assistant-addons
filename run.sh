#!/bin/sh

echo "Starting Tauron Reader addon..."
echo "Starting HTTP server on port 8765..."

# Start the application in serve-only mode
/app/tauron-reader --serve-only --http-port 8765