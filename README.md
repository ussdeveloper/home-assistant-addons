# Tauron Reader Home Assistant Addon

This Home Assistant addon fetches energy consumption and production data from Tauron eLicznik service and inserts it into a MySQL database using the standalone `tauron-reader` binary.

## Architecture

The addon consists of two main components:

1. **tauron-reader** - A Go binary that handles all the heavy lifting:
   - Authenticates with Tauron eLicznik service
   - Fetches energy data (consumption and production)
   - Parses CSV responses
   - Inserts data into MySQL database with upsert functionality
   - Implements 1-hour throttle to avoid unnecessary fetches

2. **Node.js Web Server** - Provides a user interface and scheduling:
   - Web interface to view statistics and trigger manual updates
   - Scheduled tasks based on configuration
   - Status monitoring and logging
   - Ingress support for Home Assistant integration

## Configuration

The addon has the following configuration options, similar to `tauron-db-config.json`:

## Features

- **Automated Data Fetching**: Fetches hourly energy data for the last 3 days automatically
- **Smart Throttling**: 1-hour throttle prevents unnecessary API calls
- **Force Mode**: Manual trigger option with throttle bypass
- **Data Integrity**: Upsert functionality prevents duplicate records
- **Connection Testing**: Built-in database and Tauron service testing
- **Web Interface**: Clean UI to monitor statistics and control the addon
- **Home Assistant Integration**: Full ingress support with sidebar panel
- **Comprehensive Logging**: Track all fetch operations and results

## tauron-reader CLI Options

The underlying `tauron-reader` binary supports various command-line options:

- `-test-db` - Test database connection
- `-test-service` - Test Tauron service connection
- `-status` - Show status and scheduled tasks
- `-verbose` - Enable detailed logging
- `-force` - Bypass throttle and force data fetch
- `-start-date YYYY-MM-DD` - Fetch data from specific date
- `-end-date YYYY-MM-DD` - Fetch data until specific date (max 90 days range)
- `-serve-only` - Run HTTP status server without fetching
- `-http-port N` - Set HTTP server port (default: 8765)

The addon automatically uses these options when appropriate (e.g., `-verbose` for all fetches, `-force` for manual triggers).icznik password
- **Schedule Times**: List of times to run the fetch (e.g., ["02:00", "10:00"])
- **HTTP Port**: Port for the status web server (default: 8765)

## Installation

### Home Assistant Addon

1. Add this repository to your Home Assistant addon store
2. Install the "Tauron Reader" addon
3. Configure the addon with your database and Tauron credentials
4. Start the addon
5. Access the web interface through the Home Assistant sidebar

### Standalone Usage

You can also run `tauron-reader` as a standalone application:

1. Copy `tauron-db-config.example.json` to `tauron-db-config.json`
2. Edit the configuration with your credentials
3. Run the binary:
   ```bash
   # Test connections
   ./tauron-reader -test-db
   ./tauron-reader -test-service
   
   # Fetch data
   ./tauron-reader -verbose
   
   # Force fetch (bypass throttle)
   ./tauron-reader -force
   
   # Fetch specific date range
   ./tauron-reader -start-date 2025-01-01 -end-date 2025-01-15
   ```

### Windows Scheduled Tasks

On Windows, you can register scheduled tasks:

```cmd
tauron-reader.exe -win-service-register
```

This will create tasks that run at 02:00 and 10:00 daily.

## Features

- Fetches hourly energy data for the last 3 days
- Parses CSV data from Tauron
- Inserts data into MySQL with upsert functionality
- 1-hour throttle to avoid unnecessary fetches
- Optional HTTP status server
- Runs as a service in Home Assistant

## Database Schema

The addon expects a MySQL table with the following structure:

```sql
CREATE TABLE `tauron` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ts_real` datetime NOT NULL,
  `consumption` int DEFAULT NULL COMMENT 'Wh',
  `production` int DEFAULT NULL COMMENT 'Wh',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ts_real` (`ts_real`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Key columns:
- `ts_real` (datetime, UNIQUE) - Timestamp of the measurement
- `consumption` (int) - Energy consumption in Wh
- `production` (int) - Energy production in Wh

The upsert mechanism uses `ts_real` as the unique key to prevent duplicates.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed development and testing instructions.

## License

MIT

## Credits

Created for Home Assistant integration with Tauron eLicznik service.