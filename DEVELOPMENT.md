# Tauron Reader Addon - Rozwój i Testowanie

## Struktura projektu

```
├── tauron-reader              # Binarny plik Go (główna logika)
├── server.js                  # Node.js web server (UI i harmonogram)
├── start.sh                   # Skrypt startowy (generuje config)
├── Dockerfile                 # Definicja kontenera
├── config.yaml                # Konfiguracja Home Assistant addon
├── options.json               # Przykładowa konfiguracja (użytkownik)
├── tauron-db-config.json      # Config dla tauron-reader (generowany)
└── package.json               # Zależności Node.js
```

## Jak to działa

### Przepływ danych

1. **Start** (`start.sh`):
   - Kopiuje `/data/options.json` → `tauron-db-config.json`
   - Testuje połączenie z bazą danych (`-test-db`)
   - Testuje połączenie z Tauron (`-test-service`)
   - Uruchamia `server.js`

2. **Server Node.js** (`server.js`):
   - Wystawia interfejs webowy na porcie 8765
   - Zarządza harmonogramem (cron)
   - Wywołuje `tauron-reader` z odpowiednimi flagami

3. **Tauron Reader** (binarny Go):
   - Loguje się do Tauron eLicznik
   - Pobiera dane CSV
   - Parsuje i wstawia do MySQL
   - Implementuje throttling (1h)

### Wywołania tauron-reader

```javascript
// Test połączeń
./tauron-reader -test-db
./tauron-reader -test-service

// Normalny fetch
./tauron-reader -verbose

// Wymuszone (bez throttle)
./tauron-reader -verbose -force

// Zakres dat
./tauron-reader -start-date 2025-01-01 -end-date 2025-01-15

// Status
./tauron-reader -status
```

## Testowanie lokalne

### Przygotowanie

1. Skopiuj przykładowy config:
   ```bash
   cp tauron-db-config.example.json tauron-db-config.json
   ```

2. Wypełnij danymi:
   ```json
   {
     "database": {
       "host": "10.1.0.100",
       "port": 3306,
       "user": "db_user",
       "password": "db_pass",
       "name": "database_name",
       "table": "table_name"
     },
     "tauron": {
       "username": "email@example.com",
       "password": "tauron_password"
     },
     "schedule": {
       "times": ["02:00", "10:00", "14:30"]
     },
     "http": {
       "port": 8765
     }
   }
   ```

### Testy

```bash
# 1. Test połączenia z bazą
wsl ./tauron-reader -test-db

# 2. Test połączenia z Tauron
wsl ./tauron-reader -test-service

# 3. Jeden fetch (verbose)
wsl ./tauron-reader -verbose

# 4. Wymuś fetch (ignore throttle)
wsl ./tauron-reader -force -verbose

# 5. Sprawdź status
wsl ./tauron-reader -status
```

### Uruchomienie serwera webowego

```bash
npm install
npm start
```

Otwórz: http://localhost:8765

## Budowanie

### Docker

```bash
docker build -t tauron-reader .
docker run -d \\
  -v /path/to/data:/data \\
  -p 8765:8765 \\
  tauron-reader
```

### Home Assistant

1. Dodaj folder jako addon
2. Zainstaluj przez UI
3. Konfiguruj
4. Start

## Debugowanie

### Logi

```bash
# Home Assistant
docker logs addon_xxxxx_tauron_reader

# Standalone
node server.js
```

### Problemy

**Problem**: `tauron-reader` nie działa
- Sprawdź czy plik ma uprawnienia execute: `chmod +x tauron-reader`
- Sprawdź architekturę: `file tauron-reader`

**Problem**: Nie łączy się z bazą
- Sprawdź config w `tauron-db-config.json`
- Test: `./tauron-reader -test-db`

**Problem**: Nie pobiera danych
- Sprawdź logowanie Tauron: `./tauron-reader -test-service`
- Sprawdź czy nie ma throttle (czekaj 1h lub użyj `-force`)

## Architektura decyzji

### Dlaczego Go + Node.js?

- **Go (tauron-reader)**:
  - Szybki, kompilowany
  - Łatwy do dystrybucji (pojedynczy binarny)
  - Dobry do HTTP client / parsing
  
- **Node.js (server.js)**:
  - Łatwy cron
  - Prosty web server
  - Dobra integracja z Home Assistant

### Dlaczego start.sh?

- Konwersja formatu config (HA → Go)
- Pre-flight testy
- Elastyczność

### Dlaczego osobne wywołania?

- Oddzielenie logiki od UI
- Łatwiejsze testowanie
- Możliwość standalone użycia `tauron-reader`
