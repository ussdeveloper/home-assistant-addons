# Tauron Reader Home Assistant Addon

This Home Assistant addon fetches energy consumption and production data from Tauron eLicznik service and inserts it into a MySQL database. It uses the same mechanism and data parsing as the standalone Tauron Reader application.

## Configuration

The addon has the following configuration options, similar to `tauron-db-config.json`:

- **Database Host**: MySQL server host
- **Database Port**: MySQL server port (default: 3306)
- **Database User**: MySQL username
- **Database Password**: MySQL password
- **Database Name**: MySQL database name
- **Database Table**: Table name for energy data (default: energy_extend)
- **Tauron Username**: Your Tauron eLicznik username
- **Tauron Password**: Your Tauron eLicznik password
- **Schedule Times**: List of times to run the fetch (e.g., ["02:00", "10:00"])
- **HTTP Port**: Port for the status web server (default: 8765)

## Installation

1. Copy the addon files to your Home Assistant addons directory.
2. Restart Home Assistant.
3. Install and configure the addon through the HA UI.

## Features

- Fetches hourly energy data for the last 3 days
- Parses CSV data from Tauron
- Inserts data into MySQL with upsert functionality
- 1-hour throttle to avoid unnecessary fetches
- Optional HTTP status server
- Runs as a service in Home Assistant

## Database Schema

The addon expects a table with at least:
- `ts_real` (datetime, UNIQUE)
- `consumption` (int) // Wh
- `production` (int)  // Wh
- Other columns as in the original schema