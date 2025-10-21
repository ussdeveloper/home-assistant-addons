#!/bin/sh

echo "Starting Tauron Reader addon..."

# Read config
if [ -f /data/options.json ]; then
    SCHEDULE=$(jq -r '.schedule.times[]' /data/options.json | tr '\n' ' ')
    echo "Schedule times: $SCHEDULE"
else
    SCHEDULE="02:00 10:00"
    echo "Using default schedule: $SCHEDULE"
fi

# Create cron jobs
echo "# Tauron Reader cron jobs" > /etc/crontabs/root
for time in $SCHEDULE; do
    echo "$time * * * /app/tauron-reader >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root
    echo "Added cron job: $time"
done

echo "Cron jobs created. Starting cron daemon..."

# Start cron daemon in background
crond -f -l 8 &

# Keep the container running
echo "Addon started. Waiting..."
while true; do
    sleep 60
    echo "Addon alive at $(date)"
done