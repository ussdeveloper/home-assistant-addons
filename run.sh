#!/bin/sh

echo "=== Starting Tauron Reader addon v1.1.2 ==="
echo "Debug: Checking config file..."
if [ -f /data/options.json ]; then
    echo "Config file exists:"
    cat /data/options.json
    echo "=== End of config file ==="
else
    echo "WARNING: /data/options.json not found!"
fi

echo "\n=== Testing tauron-reader binary ==="
echo "Testing database connection..."
/app/tauron-reader --test-db 2>&1
DB_RESULT=$?
echo "Database test result: $DB_RESULT"

if [ $DB_RESULT -ne 0 ]; then
    echo "ERROR: Database test failed with code $DB_RESULT"
    echo "Continuing anyway..."
fi

echo "\n=== Testing Tauron service connection ==="
/app/tauron-reader --test-service 2>&1
SERVICE_RESULT=$?
echo "Service test result: $SERVICE_RESULT"

if [ $SERVICE_RESULT -ne 0 ]; then
    echo "ERROR: Service test failed with code $SERVICE_RESULT"
    echo "Continuing anyway..."
fi

# Read config and create cron jobs
echo "\n=== Setting up scheduled tasks ==="
if [ -f /data/options.json ]; then
    SCHEDULE=$(jq -r '.schedule.times[]' /data/options.json | tr '\n' ' ')
    echo "Schedule times from config: $SCHEDULE"
else
    SCHEDULE="02:00 10:00"
    echo "Using default schedule: $SCHEDULE"
fi

echo "Creating cron jobs..."
echo "# Tauron Reader cron jobs" > /etc/crontabs/root
for time in $SCHEDULE; do
    hour=$(echo $time | cut -d: -f1)
    minute=$(echo $time | cut -d: -f2)
    echo "$minute $hour * * * /app/tauron-reader --force --verbose >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root
    echo "Added cron job: $minute $hour * * * (at $time)"
done

echo "\n=== Current crontab ==="
cat /etc/crontabs/root
echo "=== End crontab ==="

# Start cron daemon in background
echo "\n=== Starting cron daemon ==="
crond -l 8 &
CRON_PID=$!
echo "Cron daemon started with PID: $CRON_PID"

echo "\n=== Starting HTTP server ==="
echo "Starting HTTP server on port 8765..."
echo "HTTP server will handle manual runs and show status"
# Start the HTTP server (this keeps container running)
exec /app/tauron-reader --serve-only --http-port 8765 --verbose