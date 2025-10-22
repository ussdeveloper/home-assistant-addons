# Tauron Reader Home Assistant Add-on

Addon do Home Assistant, który pobiera dane z Tauron eLicznik i zapisuje je do MySQL (poprzez binarkę Go `tauron-reader`) oraz udostępnia nowoczesny panel z wykresami (Chart.js) przez ingress.

## 🎨 Interfejs i funkcje

- 📊 Wykresy 12 miesięcy z możliwością wyboru wielu lat (max 5)
  - Produkcja i Zużycie z przeźroczystymi wypełnieniami (RGBA) i spójnymi kolorami legendy
  - Zawsze 12 miesięcy; dane agregowane miesięcznie dla wybranych lat
- ℹ️ Status i podsumowanie
  - SUMA PRODUKCJI per rok (kWh)
  - Ostatnia aktualizacja (z bazy)
  - WCZORAJ i PRZEDWCZORAJ (etykiety skorygowane o opóźnienie danych)
- 📝 Logi uruchomień (JSONL) w `/data/buffer/runs.log.jsonl`
- 🔄 Ręczny przycisk „Refresh Tauron” (bez auto-fetcha przy starcie)
- 🧭 Pełna zgodność z ingress Home Assistanta (ścieżki bazują na nagłówku `x-ingress-path`)

## Architektura

- `tauron-reader` (Go): logowanie, pobieranie CSV, upsert do MySQL, throttling 1h
- `server.js` (Node.js): UI, API do wykresów, harmonogram (cron), uruchamianie binarki
- `start.sh`: ładowanie konfiguracji z `/data/options.json`, test DB, start serwera

Schemat:

```
User → HA Ingress (8099) → Node.js server → tauron-reader → MySQL
```

## Konfiguracja (skrót)

Konfiguracja jest w formacie zgodnym z `tauron-db-config.json` (tworzona z `/data/options.json`):

```
{
  "database": { "host": "...", "port": 3306, "user": "...", "password": "...", "name": "...", "table": "tauron" },
  "tauron": { "username": "...", "password": "..." },
  "schedule": { "times": ["02:00", "10:00"] },
  "http": { "port": 8765 }
}
```

Polityka anty–rate-limit:
- Brak testu połączenia z Tauron przy starcie
- Brak auto-pobrania przy starcie
- Pobieranie tylko wg harmonogramu lub po kliknięciu „Refresh Tauron”

## CLI (tauron-reader)

- `-test-db` — test bazy danych
- `-test-service` — test usługi Tauron (używać ręcznie; nie na starcie addonu)
- `-verbose`, `-force`, `-status`, `-start-date`, `-end-date`

## Schemat bazy danych

Domyślna tabela (nazwy kolumn zgodne z binarką):

```sql
CREATE TABLE `tauron` (
  `ts_real` DATETIME NOT NULL UNIQUE,
  `ec` INT NULL COMMENT 'consumption Wh',
  `oze` INT NULL COMMENT 'production Wh'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

W UI wartości są prezentowane w kWh (dzielone przez 1000).

## Instalacja (HA)

1) Dodaj repo add-onów i zainstaluj „Tauron Reader”
2) Skonfiguruj dane DB i Tauron w UI
3) Uruchom dodatek (panel pojawi się w sidebarze dzięki ingress)

### Standalone (dev)

```
cp tauron-db-config.example.json tauron-db-config.json
# Edytuj dane
wsl ./tauron-reader -test-db
npm install
npm start
```

UI: http://localhost:8765 (poza HA); w HA używany jest port ingress 8099.

### Windows (opcjonalnie)

```
tauron-reader.exe -win-service-register
```

## Dodatkowe dokumenty

- DEVELOPMENT.md — instrukcje dla deweloperów
- TROUBLESHOOTING.md — rozwiązywanie problemów
- CHANGELOG.md — historia zmian

Licencja: MIT