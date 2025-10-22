# Changelog

## v3.0.0 - Architecture Refactoring (2025-10-22)

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
