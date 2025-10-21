#!/bin/sh

echo "Starting Tauron Reader addon..."
echo "Debug: Checking config file..."
if [ -f /data/options.json ]; then
    echo "Config file exists:"
    cat /data/options.json
else
    echo "WARNING: /data/options.json not found!"
fi

# Test the binary
echo "Testing tauron-reader binary..."
/app/tauron-reader --test-db
if [ $? -ne 0 ]; then
    echo "ERROR: Database test failed"
    exit 1
fi

# Read config and create cron jobs
if [ -f /data/options.json ]; then
    SCHEDULE=$(jq -r '.schedule.times[]' /data/options.json | tr '\n' ' ')
    echo "Schedule times: $SCHEDULE"
else
    SCHEDULE="02:00 10:00"
    echo "Using default schedule: $SCHEDULE"
fi

echo "# Tauron Reader cron jobs" > /etc/crontabs/root
for time in $SCHEDULE; do
    hour=$(echo $time | cut -d: -f1)
    minute=$(echo $time | cut -d: -f2)
    echo "$minute $hour * * * /app/tauron-reader --force >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root
    echo "Added cron job: $time"
done

# Start cron daemon in background
crond -l 8 &
echo "Cron daemon started"

echo "Starting HTTP server on port 8765..."
# Start the HTTP server (this keeps container running)
/app/tauron-reader --serve-only --http-port 8765