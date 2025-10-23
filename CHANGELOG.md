# Changelog

## [3.9.6] - 2025-10-23
### Changed
- **Updated tauron-reader binary**: New version of the Go binary with latest improvements

## [3.9.5] - 2025-10-23
### Changed
- **New binary release**: Updated tauron-reader binary with latest improvements

## [3.9.2] - 2025-10-22
### Fixed
- **True transparency on charts**: Background fills now use RGBA converted from hex colors (previously hex colors stayed opaque)
- **Consistent control colors**: Added colored legend dots next to "Produkcja" and "Zużycie" that match chart palette

### Technical Details
- Implemented `hexToRgba()` helper and applied per-point alpha (0.3–0.6) for fills
- Updated UI controls (and tab switcher) to render `.legend-dot` elements and update their colors dynamically

## [3.9.3] - 2025-10-22
### Fixed
- **Manual trigger button**: Restored missing `runNow()` on the client; the "Refresh Tauron" button now invokes `/run-now`
- **HA ingress aware**: Uses detected `basePath` so it works reliably inside Home Assistant ingress

## [3.9.4] - 2025-10-22
### Changed
- **Startup behavior**: Removed Tauron service connection test at startup to prevent rate limiting. Service is only contacted on schedule or manual trigger.

## [3.9.1] - 2025-10-22
### Fixed
- **Chart transparency issue**: Reduced base opacity to 0.3–0.6, but background remained opaque due to hex colors (superseded by 3.9.2)

## [3.9.0] - 2025-10-22
### Changed
- **Accurate date labels**: Changed "DZISIAJ" to "WCZORAJ" and "WCZORAJ" to "PRZEDWCZORAJ" to correctly reflect data age
- **Chart opacity set to 0.8**: Fixed chart transparency to exactly 0.8 opacity as requested

### Technical Details
- **Label accuracy**: Status labels now accurately represent the age of displayed data
- **Chart opacity**: Set baseOpacity to 0.8 for consistent transparency across all charts

## [3.8.0] - 2025-10-22
### Changed
- **Date labels shifted back by one day**: "DZISIAJ" now shows yesterday's data, "WCZORAJ" shows day before yesterday's data (based on real_ts)
- **Chart transparency adjusted**: Increased opacity from 40%-70% to 50%-80% for lightly transparent charts (not glass-like)

### Technical Details
- **Date calculation**: Modified getEnergyStats() to shift date queries back by one day
- **UI labels**: DZISIAJ = yesterday's data, WCZORAJ = day before yesterday's data
- **Chart opacity**: Adjusted baseOpacity from 0.4 to 0.5 for better visibility while maintaining transparency

## [3.7.0] - 2025-10-22
### Added
- **Total Production Summary**: New section showing total production (kWh) for each year
- **SUMA PRODUKCJI section**: Displays yearly totals in descending order (newest first)
- **Enhanced transparency**: Charts now use lighter transparency (40%-70% opacity) for better visual layering

### Technical Details
- **New API endpoint `/api/total-production`**: Returns total production aggregated by year
- **Dynamic summary display**: Automatically updates with available data
- **Improved chart transparency**: Reduced opacity range for better multi-year visualization
- **UI integration**: Summary section added to status panel with yearly breakdown

## [3.6.0] - 2025-10-22
### Added
- **New API endpoint `/api/chart-data`**: Restored missing 24-hour hourly data endpoint for real-time energy charts
- **Year-specific color palettes**: Implemented 8 distinct color schemes (blue, green, orange, red, purple, brown, pink, gray) for different years instead of opacity gradients
- **Enhanced chart visualization**: Each year now has unique colors for better distinction in multi-year comparisons

### Technical Details
- **Color cycling**: 8 predefined color palettes that cycle for years beyond 8
- **Improved chart readability**: Different hues for each year instead of same colors with varying opacity
- **24-hour endpoint restored**: `/api/chart-data` returns hourly aggregated data for last 24 hours
- **Chart.js compatibility**: Maintained existing chart structure while enhancing visual differentiation

## [3.5.0] - 2025-10-22
### Added
- **New API endpoint `/api/available-years`**: Dynamically queries database for available years with data
- **Database-driven year selection**: Year checkboxes now populated from actual data in database instead of hardcoded values
- **Automatic year detection**: System automatically discovers which years have energy data available

### Technical Details
- **Query optimization**: `SELECT DISTINCT YEAR(ts_real) as year FROM ${table} WHERE ts_real IS NOT NULL ORDER BY year DESC`
- **API response format**: Returns `{success: true, years: [2023, 2024, 2025], count: 3}`
- **UI integration**: Year checkboxes automatically populated and sorted (newest first)

## [3.4.4] - 2025-10-22
### Fixed
- **Home Assistant ingress API routing**: Corrected basePath logic for ingress mode to use full ingress path instead of relative paths
- **API calls in iframe**: Fixed 404 errors when accessing API endpoints through Home Assistant sidebar

### Technical Details
- **Ingress path handling**: In ingress mode, basePath now correctly uses the full ingress path for API calls
- **URL construction**: API calls now properly route to addon endpoints in iframe environment

## [3.4.3] - 2025-10-22
### Fixed
- **Home Assistant ingress API calls**: Fixed API endpoint URLs for ingress mode by using relative paths instead of full ingress paths
- **Year selection visibility**: Year checkboxes now load correctly in Home Assistant sidebar iframe

### Technical Details
- **Ingress path detection**: Added logic to detect Home Assistant ingress mode and use appropriate API URL construction
- **API call routing**: In ingress mode, API calls now use relative URLs (`/api/...`) instead of full ingress paths

## [3.4.2] - 2025-10-22
### Fixed
- **Dynamic Tauron connection status**: Status now shows "🔴 Nieaktywne" if last connection failed, only "🟢 Aktywne" when connection succeeds
- **Button label updated**: Changed "▶️ Uruchom" to "🔄 Refresh Tauron" for clarity
- **Confirmation message**: Updated to "Rozpocząć odświeżanie danych Tauron?" for the refresh action

### Enhanced
- **Connection status logic**: Tauron status is now determined by the last log entry status
- **UI feedback**: More accurate representation of connection state based on actual connection attempts

## [3.4.1] - 2025-10-22 🏆 **MILESTONE RELEASE**
### Fixed
- **Missing index.html in Docker container**: Added COPY index.html ./ to Dockerfile to fix "ENOENT: no such file or directory" error when loading the web interface

### 🎯 **Milestone Achievement**
- **Multi-year chart selection** fully functional with checkbox interface
- **12-month scale guarantee** implemented and working
- **Production/consumption toggles** restored and operational
- **Home Assistant addon** ready for production use
- **Web interface** loads correctly in HA sidebar
- **Final fixes** to be added in upcoming patch releases

## [3.4.0] - 2025-10-22
### Added
- **Multi-Year Chart Selection**: Replaced single year dropdown with checkboxes allowing selection of multiple years (up to 5 for UI clarity)
- **Consumption Checkbox Restored**: Added back 🔴 Zużycie (Consumption) checkbox alongside 🟢 Produkcja (Production)
- **12-Month Scale Guarantee**: Chart always displays exactly 12 months regardless of year selection
- **Visual Year Distinction**: Implemented opacity gradients where older years have lower opacity (0.1) and newer years have higher opacity (0.8)
- **Smart Data Loading**: Uses Promise.all() to fetch data for all selected years simultaneously for better performance

### Enhanced
- **Chart Interface**: Updated updateChart() function to handle multiple year selection with proper data aggregation
- **UI Controls**: Year checkboxes with hover effects, production/consumption toggles, proper event handling
- **API Optimization**: Removed duplicate /api/chart-data-yearly endpoint for cleaner codebase
- **Chart.js Integration**: Enhanced legend display with year-specific labels and improved visual hierarchy
### Added
- Automatic database table creation if table doesn't exist
- Uses table name from HA config for table creation
- Full table schema with all required columns and indexes

## [3.3.12] - 2025-10-22
### Refactored
- Extracted HTML template from server.js into separate index.html file for better code organization
- Improved server.js readability by separating presentation logic from business logic
- Maintained all existing functionality while improving maintainability

## [3.3.11] - 2025-10-22
### Fixed
- Fixed Chart.js loading issues with proper error handling and availability checks
- Fixed chart container dimensions to match UI.drawio specification (200px height)
- Fixed event handling in switchChartType function for better browser compatibility
- Added try-catch around Chart.js instantiation for better error reporting

## [3.3.10] - 2025-10-22
### Fixed
- Fixed remaining UTF-8 encoding issue in initial HTML template causing JavaScript syntax error

## [3.3.9] - 2025-10-22
### Fixed
- Fixed corrupted UTF-8 character in HTML template causing "Unexpected token 'var'" JavaScript error
- Updated version number in server.js to v3.3.8

## [3.3.8] - 2025-10-22
### Fixed
- Corrected repository URL in config.yaml (was pointing to wrong repo)
- Fixed addon not updating from GitHub due to incorrect URL

## [3.3.7] - 2025-10-22
### Fixed
- Replaced .forEach() with for loop for better compatibility
- Removed all remaining arrow functions from browser code
- Fixed runNow() function not being defined due to syntax errors
- Complete ES5 compatibility in client-side JavaScript

## [3.3.6] - 2025-10-22
### Fixed
- Replaced async/await with Promise .then() for better browser compatibility
- Removed try/catch and used .catch() instead
- Fixed "Unexpected token 'var'" error in older browsers/iframe context

## [3.3.5] - 2025-10-22
### Changed
- Removed automatic initial data fetch at startup
- Data is now fetched only at scheduled times or via manual trigger (▶️ Uruchom button)
- Prevents rate limiting issues with Tauron API at addon startup

## [3.3.4] - 2025-10-22
### Fixed
- Disabled Tauron service test at startup to avoid rate limiting
- Increased initial data fetch delay from 10s to 60s to prevent login blocks
- Tauron API blocks too frequent login attempts (multiple requests in short time)

## [3.3.3] - 2025-10-22
### Fixed
- Replaced const/let with var for better browser compatibility
- Fixed arrow functions to regular functions for older browsers
- Removed optional chaining operator (?.) for compatibility

## [3.3.2] - 2025-10-22
### Fixed
- Syntax error fix deployment (same as 3.3.1, version bump for Home Assistant update)

## [3.3.1] - 2025-10-22
### Fixed
- Fixed syntax error with nested template literals in JavaScript code
- Replaced backticks with single quotes in innerHTML assignments

## [3.3.0] - 2025-10-22

### Added
- **Chart Tabs** - Three chart types with tab navigation:
  - **Miesięczna** (default) - Production for current month across years
  - **Ó24h** - Hourly production and consumption for last 24 hours
  - **Ód roku** - Monthly production totals for current year
- **New API Endpoints**:
  - `/api/chart-data-monthly` - Current month production across all years
  - `/api/chart-data-yearly` - Monthly totals for current year
- **Dynamic UI** - Chart title and checkboxes update based on selected tab
- **Better Defaults** - Shows monthly production comparison on load

### Enhanced
- **Responsive Charts** - Proper canvas recreation and resize handling
- **Tab Styling** - Active tab indication with colors and hover effects
- **Chart Types** - Bar charts for yearly comparison, line for others

## [3.2.1] - 2025-10-22

### Fixed
- **Layout Dimensions** - Corrected to match UI.drawio specification:
  - Chart section: 230px (30px header + 200px chart)
  - Bottom sections: flex-fill (30px header + scrollable content)
- **Chart Error Handling** - Added comprehensive error messages and debug logging
- **Empty Data Handling** - Graceful handling when no data available in 24h period
- **Chart Recreation** - Fixed canvas recreation after error states
- **API Data Flow** - Verified database query returns proper hourly aggregated data

## [3.2.0] - 2025-10-22

### Enhanced
- **Premium UI Design** - Major visual overhaul with modern aesthetics
- **Gradient Backgrounds** - Smooth gradients on top bar and section headers
- **Better Shadows** - Box shadows and depth throughout interface
- **Interactive Elements** - Hover effects on checkboxes, logs, and status cards
- **Improved Buttons** - Gradient buttons with hover animations and transforms
- **Typography** - Better font weights, letter spacing, and text shadows
- **Enhanced Cards** - Log entries and status items with borders and hover states
- **Smooth Animations** - Transitions on all interactive elements
- **Professional Polish** - Overall refinement of spacing, colors, and visual hierarchy

## [3.1.3] - 2025-10-22

### Changed
- **UI Layout Redesign** - Implemented Grafana-style layout matching UI.drawio specification
- **Chart Section** - Increased height to 250px with proper top bar and menu
- **Section Headers** - Added dedicated headers for Logs and Status sections
- **Improved Structure** - Separated section-header and section-content for better organization
- **Visual Polish** - Enhanced spacing, colors, and typography throughout

## [3.1.2] - 2025-10-22

### Fixed
- **Home Assistant Ingress support** - Added proper ingress proxy handling with X-Ingress-Path header
- **Dynamic port configuration** - Port 8099 for ingress mode, configurable for standalone
- **Relative URL paths** - All API calls now use relative paths for ingress compatibility
- **JavaScript base path** - Added automatic base path detection for iframe embedding

## [3.1.1] - 2025-10-22

### Fixed
- **Configuration loading** - Fixed database name reference in chart API endpoint
- **Multi-path config support** - Improved config file detection for Home Assistant and standalone modes
- **Startup logging** - Enhanced start.sh with better error messages and diagnostics

## [3.1.0] - 2025-10-22

### Added
- **New Modern UI** with dark theme matching Home Assistant design
- **Interactive Chart** showing energy production and consumption (last 24 hours)
- **Real-time data visualization** using Chart.js
- **Three-section layout**:
  - Top: Energy chart with toggleable production/consumption
  - Bottom Left: Logs and data updates with auto-scroll
  - Bottom Right: Status summary with connection status and scheduled runs
- **Responsive design** that adapts to webview size
- **Auto-refresh** functionality (chart updates every 60 seconds)
- **API endpoint** `/api/chart-data` for fetching hourly energy data

### Changed
- Updated web interface from simple stats page to professional dashboard
- Improved visual hierarchy with better typography and spacing
- Enhanced user experience with checkboxes to toggle chart data series

## [3.0.1] - 2025-10-22

### 🎯 Główne zmiany

Przeprojektowanie architektury addon: serwis Node.js teraz wykorzystuje binarny `tauron-reader` do wszystkich operacji związanych z pobieraniem i zapisem danych.

### ✨ Nowe funkcje

- **Wykorzystanie tauron-reader**: Wszystkie operacje na danych wykonywane przez natywny binarny plik Go
- **Skrypt startowy**: Nowy `start.sh` zarządza konfiguracją i testami przed uruchomieniem
- **Testy połączeń**: Automatyczne testowanie połączeń z bazą danych i Tauron przy starcie
- **Force mode**: Możliwość wymuszenia pobierania danych z pominięciem throttle
- **Status API**: Nowy endpoint `/api/status` do sprawdzania stanu systemu
- **Ulepszony interfejs**: Dodano przycisk sprawdzania statusu w UI
- **Verbose logging**: Szczegółowe logi z wszystkich operacji

### 🔧 Zmiany techniczne

- **Uproszczenie server.js**: Usunięto duplikację logiki - wszystko delegowane do `tauron-reader`
- **Konwersja konfiguracji**: `start.sh` konwertuje HA `options.json` → `tauron-db-config.json`
- **Parametryzowane wywołania**: `callTauronReader()` przyjmuje argumenty CLI
- **Czystsze logi**: Usunięto redundantne komunikaty, lepsze formatowanie

### 📁 Nowe pliki

- `start.sh` - Skrypt startowy z testami
- `tauron-db-config.example.json` - Przykładowa konfiguracja
- `DEVELOPMENT.md` - Dokumentacja dla deweloperów
- `.gitignore` - Rozszerzona lista ignorowanych plików
- `server.old.js` - Backup poprzedniej wersji

### 🔄 Zmienione pliki

- `server.js` - Przepisany od nowa, używa `tauron-reader` CLI
- `Dockerfile` - Dodano `start.sh`, zmieniono CMD
- `README.md` - Zaktualizowana dokumentacja
- `.gitignore` - Rozszerzony

### 🏗️ Architektura

```
┌─────────────────┐
│ Home Assistant  │
└────────┬────────┘
         │ options.json
         ▼
    ┌────────┐
    │start.sh│ ─── test-db, test-service
    └───┬────┘
        │
        ▼
 ┌──────────────┐        ┌────────────────┐
 │  server.js   │ ─────► │ tauron-reader  │
 │  (Node.js)   │ CLI    │     (Go)       │
 └──────────────┘        └───────┬────────┘
        │                        │
        │                        ▼
        │                 ┌─────────────┐
        └────────────────►│    MySQL    │
         (stats query)    │  Database   │
                          └─────────────┘
```

### 🎁 Korzyści

1. **Separation of Concerns**: Logika biznesowa w Go, UI/scheduling w Node.js
2. **Łatwiejsze testowanie**: `tauron-reader` można używać standalone
3. **Lepsze logowanie**: Wszystkie operacje logowane przez jeden system
4. **Mniejsza duplikacja**: Jedna implementacja logiki pobierania
5. **Elastyczność**: `tauron-reader` można używać z CLI do testów

### ⚙️ Migracja z v1.x

Addon automatycznie używa nowej architektury. Nie ma potrzeby zmian w konfiguracji Home Assistant.

### 🐛 Poprawione problemy

- Usunięto duplikację logiki pobierania danych
- Poprawiono obsługę błędów
- Lepsze logi dla debugowania
- Spójniejsze formatowanie timestampów
