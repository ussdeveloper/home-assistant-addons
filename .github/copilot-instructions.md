# Tauron Reader Home Assistant Addon - AI Agent Instructions

## Architecture Overview

**Hybrid Go + Node.js architecture** for Home Assistant addon that fetches energy data from Tauron eLicznik API:

- **`tauron-reader`** (Go binary): Pre-compiled executable handling authentication, CSV parsing, MySQL upserts, and 1-hour throttling
- **`server.js`** (Node.js): Web UI, cron scheduling, subprocess management, and Home Assistant ingress proxy
- **`start.sh`**: Converts HA config format (`/data/options.json`) to Go binary format (`tauron-db-config.json`)

```
User → HA Ingress (port 8099) → Node.js server → spawns → tauron-reader binary → MySQL
                                ↓                            ↓
                          Web UI (Chart.js)          Tauron API (CSV)
```

## Critical Development Patterns

### 1. Version Management & Release Process
**ALWAYS increment version using semantic versioning (major.minor.patch) and update 3 files simultaneously:**

```javascript
// Version increment rules:
MAJOR (X.y.z): Breaking changes, API changes, major rewrites
MINOR (x.Y.z): New features, significant improvements
PATCH (x.y.Z): Bug fixes, small improvements, compatibility fixes

// Must update together for HA update mechanism
config.yaml: version: "3.3.8"
CHANGELOG.md: ## [3.3.8] - 2025-10-22
server.js: console.log('🎯 === Tauron Reader Addon v3.3.8 ==='); // if exists
```

**Release workflow:**
```bash
# 1. Update version in all 3 files
# 2. Commit changes
git add -A
git commit -m "v3.3.8 - Description of changes"

# 3. Push to main branch
git push origin main

# 4. Create and push tag
git tag v3.3.8 -m "Version 3.3.8 - Description"
git push origin v3.3.8

# 5. Home Assistant will detect update automatically
```

**Version increment examples:**
- Bug fix (syntax error): `3.3.7` → `3.3.8` (patch)
- New chart type: `3.3.8` → `3.4.0` (minor)
- Major rewrite: `3.4.0` → `4.0.0` (major)

### 2. Browser Compatibility (Home Assistant iframe)
**Home Assistant's iframe has strict JavaScript limitations:**
```javascript
// ❌ NEVER use
async/await, const/let in browser code, arrow functions in <script>, optional chaining (?.)

// ✅ ALWAYS use
var declarations, function() syntax, .then() chains, explicit checks (el ? el.value : default)

// Example pattern:
fetch(apiUrl)
  .then(function(response) { return response.json(); })
  .then(function(data) { /* process */ })
  .catch(function(err) { console.error(err); });
```

### 3. Tauron API Rate Limiting
**Critical: Tauron blocks multiple logins within minutes**
```javascript
// ❌ NEVER test service connection at startup
// ❌ NEVER auto-fetch immediately after restart

// ✅ Current pattern (v3.3.5+):
// - Only test database connection at startup
- NO initial data fetch
- Fetch only via scheduled cron OR manual button click
- testTauronService() disabled to prevent rate limits
```

### 4. Release Management & Repository Structure
**Home Assistant addon releases are managed via Git tags. Always create releases after code changes:**

**Repository structure for releases:**
```
home-assistant-addons/
├── .github/copilot-instructions.md  # AI agent instructions
├── config.yaml                      # HA addon manifest (version, ingress, etc.)
├── server.js                        # Main Node.js application
├── tauron-reader                    # Go binary executable
├── Dockerfile                       # Container build instructions
├── start.sh                         # Startup script
├── CHANGELOG.md                     # Version history
└── README.md                        # User documentation
```

**Home Assistant addon configuration:**
- Addon is published from repository root (current setup)
- To use specific directory: modify `config.yaml` url to point to subdirectory
- Current setup: `url: "https://github.com/ussdeveloper/home-assistant-addons"`
- For subdirectory: `url: "https://github.com/ussdeveloper/home-assistant-addons/tree/main/addon-directory"`

**Post-release checklist:**
- ✅ Version updated in config.yaml, CHANGELOG.md, server.js
- ✅ Code committed and pushed to main branch
- ✅ Git tag created and pushed
- ✅ Home Assistant addon store detects update
- ✅ Test addon installation/update in HA

### 5. Configuration Loading
**Multi-path fallback for HA vs standalone:**
```javascript
// Order matters for config detection:
1. /data/options.json        // Home Assistant runtime
2. /app/tauron-db-config.json // Docker build
3. ./tauron-db-config.json    // Local development
4. ./options.json             // Fallback
```

### 6. Ingress Path Handling
**All URLs must support Home Assistant's ingress proxy:**
```javascript
// Client-side base path detection:
var basePath = window.location.pathname.replace(/\/$/, '');
fetch(basePath + '/api/chart-data'); // NOT '/api/chart-data'

// Server-side middleware:
app.use((req, res, next) => {
  const ingressPath = req.headers['x-ingress-path'] || '';
  req.ingressPath = ingressPath;
  next();
});
```

## Key File Responsibilities

- **`server.js` (1073 lines)**: Main app, 3 chart API endpoints (`/api/chart-data*`), HTML template with inline CSS/JS
- **`config.yaml`**: HA addon manifest, `ingress: true` and `ingress_port: 8099` are mandatory
- **`CHANGELOG.md`**: User-facing version history, update on every version bump
- **`start.sh`**: Pre-flight checks (`-test-db`), config conversion, launches `node server.js`
- **`UI.drawio`**: Layout specification (230px chart section, 30px headers)

## Common Operations

### Testing Changes Locally
```bash
# 1. Update config
cp tauron-db-config.example.json tauron-db-config.json
# Edit with real credentials

# 2. Test binary
wsl ./tauron-reader -test-db
wsl ./tauron-reader -verbose

# 3. Run server
npm install
npm start
# Open http://localhost:8765
```

### Deploying New Version
```bash
# 1. Edit 3 files: config.yaml, CHANGELOG.md, server.js (if needed)
# 2. Commit and tag
git add -A
git commit -m "v3.3.X - Description"
git push origin main
git tag v3.3.X -m "Version 3.3.X - Description"
git push origin v3.3.X
# 3. User updates via HA UI
```

### Spawning tauron-reader
```javascript
// Standard pattern for subprocess calls:
const result = await callTauronReader(['-verbose']); // auto-logs stdout/stderr
const result = await callTauronReader(['-force', '-verbose']); // bypass throttle
// Binary handles: auth, CSV parse, MySQL upsert, throttle logic
```

## Database Schema
```sql
-- Table: tauron (config.database.table)
-- Columns: ts_real (datetime UNIQUE), ec (consumption Wh), oze (production Wh)
-- Note: Column names in DB differ from displayed labels (ec=consumption, oze=production)
```

## UI Chart Implementation
**Three chart types with tab navigation:**
1. **Monthly** (default): Current month production across years → `/api/chart-data-monthly`
2. **×24h**: Hourly production + consumption → `/api/chart-data`
3. **Year-to-date**: Monthly totals for current year → `/api/chart-data-yearly`

Chart.js responsive canvas with manual destruction/recreation on data changes.

## Non-Obvious Conventions

- **Polish language**: UI strings, logs, comments in Polish (user base requirement)
- **Emoji logging**: `console.log('🚀 Starting...')` for visual parsing in HA logs
- **Manual trigger**: `▶️ Uruchom` button calls `/run-now` endpoint with force flag
- **JSONL logs**: `/data/buffer/runs.log.jsonl` for persistent run history
- **No server-side version constant**: Version only in `config.yaml` and `CHANGELOG.md`

## Debugging Patterns

```javascript
// API data flow debugging:
console.log('Fetching chart data from:', apiUrl);
console.log('Chart data received:', data);

// Binary execution debugging:
// Check stdout/stderr in callTauronReader() promise resolution
// Exit code 0 = success, code 1 = error (often Tauron rate limit)

// Home Assistant logs:
// docker logs addon_xxxxx_tauron_reader
// Look for emoji prefixes: 🔌 🚀 ✅ ❌ ⚠️
```

## Current State (v3.3.9)

- ✅ Browser compatibility: ES5 syntax, no async/await in client code
- ✅ Rate limiting: No auto-fetch, no service test at startup
- ✅ Charts: Three tab types with working API endpoints
- ✅ Ingress: Full Home Assistant sidebar integration on port 8099
- ✅ Version management: Semantic versioning with 3-file sync
- ✅ Release process: Git tags for Home Assistant addon updates
- ✅ UTF-8 encoding: Fixed corrupted characters in HTML templates
- ⚠️ Known limitation: Tauron API occasionally returns malformed CSV (parse errors unavoidable)
