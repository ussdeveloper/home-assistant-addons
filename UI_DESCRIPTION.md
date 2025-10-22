# Tauron Reader - Web Interface Description

## Layout Overview (v3.1.0)

The web interface is divided into **3 main sections** optimized for Home Assistant sidebar webview:

```
┌────────────────────────────────────────────────────────────┐
│  📊 ENERGY CHART SECTION (100% width)                     │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 📊 Energia - ostatnie 24h            [Controls]     │ │
│  │ ☑ 🟢 Produkcja  ☑ 🔴 Zużycie    [▶️ Uruchom]      │ │
│  │                                                       │ │
│  │          [Interactive Line Chart]                    │ │
│  │                                                       │ │
│  └──────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────┤
│  LEFT: 📝 LOGS            │  RIGHT: ℹ️ STATUS & SUMMARY  │
│  ┌──────────────────────┐ │  ┌──────────────────────────┐ │
│  │ 📝 Logi i aktualizacje│ │  │ ℹ️ Status i podsumowanie │ │
│  │ ──────────────────────│ │  │ ──────────────────────── │ │
│  │                       │ │  │                          │ │
│  │ ✅ 2025-10-22 10:00  │ │  │ OSTATNIA AKTUALIZACJA   │ │
│  │ Pobrano 72 rekordy    │ │  │ 2025-10-22 10:15        │ │
│  │                       │ │  │                          │ │
│  │ ✅ 2025-10-22 02:00  │ │  │ DZISIAJ                 │ │
│  │ Pobrano 68 rekordów   │ │  │ ⚡ 15.2 kWh zużycie     │ │
│  │                       │ │  │ ☀️ 8.5 kWh produkcja    │ │
│  │ ❌ 2025-10-21 22:00  │ │  │                          │ │
│  │ Connection timeout    │ │  │ TEN TYDZIEŃ             │ │
│  │                       │ │  │ ⚡ 102 kWh zużycie      │ │
│  │ [Scrollable]          │ │  │ ☀️ 56 kWh produkcja     │ │
│  │ ↓                     │ │  │                          │ │
│  │                       │ │  │ WCZORAJ                 │ │
│  │                       │ │  │ ⚡ 18.3 kWh zużycie     │ │
│  │                       │ │  │ ☀️ 7.2 kWh produkcja    │ │
│  │                       │ │  │                          │ │
│  │                       │ │  │ POŁĄCZENIE TAURON       │ │
│  │                       │ │  │ 🟢 Aktywne              │ │
│  │                       │ │  │                          │ │
│  │                       │ │  │ POŁĄCZENIE BAZA DANYCH  │ │
│  │                       │ │  │ 🟢 Aktywne              │ │
│  │                       │ │  │                          │ │
│  │                       │ │  │ ZAPLANOWANE URUCHOMIENIA│ │
│  │                       │ │  │ ⏰ 02:00  ⏰ 10:00      │ │
│  │                       │ │  │                          │ │
│  └──────────────────────┘ │  └──────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

## Section Details

### 1. Chart Section (Top - 100% width)

**Features:**
- Real-time line chart showing last 24 hours of data
- Interactive checkboxes to toggle:
  - 🟢 **Production** (green line)
  - 🔴 **Consumption** (red line)
- **▶️ Uruchom** button - manually trigger data fetch
- Chart updates every 60 seconds automatically
- Smooth animations with Chart.js library
- Responsive height: 200px

**Data Source:**
- API endpoint: `/api/chart-data`
- Returns hourly aggregated data from MySQL
- Format: `{ labels: ['0h', '1h', ...], consumption: [...], production: [...] }`

### 2. Logs Section (Bottom Left - 50% width)

**Features:**
- Scrollable list of recent operations (last 20 entries)
- Real-time activity feed showing:
  - ✅ Success operations (green left border)
  - ❌ Failed operations (red left border)
  - Timestamp in Polish locale format
  - Descriptive messages
- Auto-scroll to latest entries
- Dark theme with GitHub-style design

**Data Source:**
- Reads from `/data/buffer/runs.log.jsonl`
- JSON Lines format for easy parsing
- Displays count of entries in section header

### 3. Status & Summary Section (Bottom Right - 50% width)

**Features:**
- Comprehensive status dashboard showing:
  - **Last Update**: Timestamp of most recent data
  - **Today**: Current day's consumption + production
  - **This Week**: 7-day rolling summary
  - **Yesterday**: Previous day comparison
  - **Tauron Connection**: Live status indicator
  - **Database Connection**: Live status indicator
  - **Scheduled Runs**: Configured execution times

**Status Indicators:**
- 🟢 **Active** (green) - Connection OK
- 🔴 **Error** (red) - Connection failed
- 🟡 **Warning** (yellow) - Partial issues

**Data Source:**
- API: `/` (main route)
- Calls `getEnergyStats()` function
- Queries MySQL for real-time statistics

## Design System

### Colors (Dark Theme)
- Background: `#0d1117` (GitHub dark)
- Cards: `#161b22` (GitHub card)
- Borders: `#30363d` / `#21262d`
- Text: `#c9d1d9` (primary), `#8b949e` (secondary)
- Accent: `#58a6ff` (blue)
- Success: `#3fb950` (green)
- Error: `#f85149` (red)
- Warning: `#d29922` (yellow)

### Typography
- Font: System font stack (Segoe UI, Roboto, etc.)
- Title: 14px, weight 600
- Body: 12px, weight 400
- Small: 11px, weight 400
- Monospace: 10px for timestamps

### Spacing
- Section padding: 15px
- Card gap: 8px
- Element margin: 6-12px
- Chart height: 200px

## Technical Stack

### Frontend
- **Chart.js 4.4.0** - Interactive charts
- **Vanilla JavaScript** - No framework dependencies
- **CSS Grid/Flexbox** - Responsive layout
- **Fetch API** - Data loading

### Backend
- **Express.js** - Web server
- **MySQL2** - Database queries
- **Chart.js CDN** - External resource

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Main UI with embedded stats |
| `/api/chart-data` | GET | Hourly energy data (24h) |
| `/api/runs` | GET | Recent operation logs |
| `/run-now` | GET | Trigger manual data fetch |
| `/api/status` | GET | System status check |

## Browser Compatibility

- Modern browsers with ES6+ support
- Home Assistant webview (Chromium-based)
- Tested on desktop and mobile viewports
- Responsive design adapts to sidebar width

## Performance

- Initial load: < 1s
- Chart render: < 200ms
- Auto-refresh: 60s intervals
- Lightweight: ~5KB CSS + ~3KB JS (excluding Chart.js)
- No page reload needed (AJAX updates)

## Future Enhancements

Potential improvements:
- [ ] Date range selector for chart
- [ ] Export data to CSV
- [ ] Configurable refresh intervals
- [ ] Push notifications for errors
- [ ] Historical comparison views
- [ ] Daily/weekly/monthly aggregations
- [ ] Cost calculations
- [ ] Dark/light theme toggle
