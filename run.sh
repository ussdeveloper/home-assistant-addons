#!/bin/sh

# Read config
if [ -f /data/options.json ]; then
    SCHEDULE=$(jq -r '.schedule.times[]' /data/options.json | tr '\n' ' ')
else
    SCHEDULE="02:00 10:00"
fi

# Create cron jobs
echo "# Tauron Reader cron jobs" > /etc/crontabs/root
for time in $SCHEDULE; do
    echo "$time * * * /app/tauron-reader" >> /etc/crontabs/root
done

# Start cron daemon
crond -f