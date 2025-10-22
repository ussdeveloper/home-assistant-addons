# Changelog

# Changelog

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
