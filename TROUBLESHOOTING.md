# Troubleshooting Guide - Tauron Reader Addon

## 🔧 Common Issues

### 502 Bad Gateway in Home Assistant Panel

**Symptoms:**
- Panel boczny pokazuje "502 Bad Gateway"
- Addon jest uruchomiony w Home Assistant
- Port 8765 działa, ale panel nie

**Solution:**
1. **Przebuduj addon** w Home Assistant:
   - Settings → Add-ons → Tauron Reader
   - Kliknij menu (⋮) → Rebuild
   - Lub: Update/Reinstall addon

2. **Sprawdź logi addonu:**
   ```
   Settings → Add-ons → Tauron Reader → Log
   ```
   
   Przykładowy poprawny start:
   ```
   🚀 Starting Tauron Reader Addon...
   ✅ Loading configuration from /data/options.json
   🔍 Testing database connection...
   ✅ Database connection OK
   🌐 HTTP server running on port 8099
   🔗 Ingress mode: Available in Home Assistant sidebar
   ✅ === Addon ready ===
   ```

3. **Restart addon** po rebuild:
   - Stop → Start

4. **Wyczyść cache przeglądarki** (Ctrl+Shift+R)

---

### Database Connection Failed

**Symptoms:**
```
❌ Database connection failed!
💡 Check your database host, credentials, and network connectivity
```

**Solution:**
1. **Sprawdź konfigurację addonu:**
   - Host: Musi być dostępny z Home Assistant
   - Port: Domyślnie 3306
   - User/Password: Poprawne credentials
   - Database name: Musi istnieć

2. **Test połączenia z terminala HA:**
   ```bash
   telnet YOUR_DB_HOST 3306
   ```

3. **Sprawdź firewall** na serwerze MySQL

4. **Upewnij się że MySQL akceptuje zdalne połączenia:**
   ```sql
   GRANT ALL PRIVILEGES ON database_name.* TO 'user'@'%' IDENTIFIED BY 'password';
   FLUSH PRIVILEGES;
   ```

---

### UI Shows Empty Charts

**Symptoms:**
- Panel się ładuje
- Brak danych na wykresie
- Statystyki pokazują 0 kWh

**Solution:**
1. **Sprawdź czy dane są w bazie:**
   ```sql
   SELECT COUNT(*) FROM tauron WHERE ts_real >= DATE_SUB(NOW(), INTERVAL 24 HOUR);
   ```

2. **Uruchom ręczne pobieranie:**
   - Kliknij przycisk "▶️ Uruchom" w UI
   - Sprawdź logi po 30 sekundach

3. **Sprawdź nazwę tabeli:**
   - Domyślnie: `tauron`
   - W konfiguracji: `database.table`

---

### Ingress Not Working (Direct 8765 Works)

**Symptoms:**
- Direct access `http://HA_IP:8765` działa
- Panel boczny nie działa

**Solution:**
1. **Sprawdź czy ingress jest włączony w config.yaml:**
   ```yaml
   ingress: true
   ingress_port: 8099
   ```

2. **Restart Home Assistant Supervisor:**
   ```bash
   ha supervisor restart
   ```

3. **Sprawdź czy addon nasłuchuje na porcie 8099 (w HA):**
   ```
   W logach: "HTTP server running on port 8099"
   ```

---

### Scheduled Tasks Not Running

**Symptoms:**
- Dane nie są pobierane automatycznie
- Tylko ręczne uruchomienie działa

**Solution:**
1. **Sprawdź konfigurację schedule:**
   ```json
   {
     "schedule": {
       "times": ["02:00", "10:00"]
     }
   }
   ```

2. **Sprawdź logi o czasie zaplanowanym:**
   - Logi powinny pokazać wykonanie o określonej godzinie

3. **Restart addonu** żeby przeładować harmonogram

---

## 📊 Diagnostic Commands

### Check Addon Status
```bash
# W terminalu Home Assistant
ha addons info tauron_reader
```

### View Real-time Logs
```bash
ha addons logs tauron_reader -f
```

### Test Database from Container
```bash
# Wejdź do kontenera addonu
docker exec -it addon_tauron_reader sh

# Test połączenia
./tauron-reader -test-db

# (Opcjonalnie) Test Tauron service – ręcznie
./tauron-reader -test-service
```

### Check Configuration
```bash
cat /data/options.json
```

---

## 🔍 Log Interpretation

### Good Startup Log
```
🎯 === Tauron Reader Addon v3.1.2 ===
📅 Startup time: 2025-10-22T10:15:30.123Z
🔧 Node.js version: v18.x.x
📁 Working directory: /app
✅ Loaded config from /data/options.json
📋 Config loaded: { database: {...}, tauron: {...} }
🔍 Testing database connection...
✅ Database connection OK
ℹ️ Skipping Tauron service test at startup (anti rate limit)
⏰ Setting up scheduled tasks...
📅 Scheduling task at 02:00
📅 Scheduling task at 10:00
🌐 HTTP server running on port 8099
🔗 Ingress mode: Available in Home Assistant sidebar
✅ === Addon ready ===
```

### Error Log Examples

**Database Error:**
```
❌ Database connection failed!
Error: connect ECONNREFUSED 10.1.0.100:3306
```
→ MySQL server niedostępny lub firewall blokuje

**Config Error:**
```
❌ Failed to load configuration: No configuration file found!
```
→ Brak `/data/options.json` - sprawdź konfigurację addonu w HA

**Tauron Error:**
```
⚠️ Tauron service connection failed (use manual test or wait for schedule)
Tauron error: Incorrect password
```
→ Sprawdź hasło do konta Tauron

---

## 🌐 Network Requirements

### Outbound Access Required:
- **Tauron API:** `https://elicznik.tauron-dystrybucja.pl`
- **Chart.js CDN:** `https://cdn.jsdelivr.net`

Uwaga: komunikaty w konsoli przeglądarki typu „The Material theme is deprecated and will be removed in Vaadin 25” pochodzą z frontend’u Home Assistanta i nie są związane z tym dodatkiem.

### Inbound Access Required:
- **MySQL Database:** Konfigurowalny port (domyślnie 3306)
- **Home Assistant Ingress:** Port 8099 (wewnętrzny)

---

## 📞 Support

Jeśli problemy nadal występują:

1. **Zbierz logi:**
   - Addon logs (Settings → Add-ons → Tauron Reader → Log)
   - Home Assistant logs (Settings → System → Logs)

2. **Sprawdź wersję:**
   - Powinna być `3.1.2` lub nowsza

3. **Utwórz issue na GitHub:**
   - https://github.com/ussdeveloper/home-assistant-addons/issues
   - Załącz logi i opis problemu

---

## ✅ Quick Checklist

- [ ] Addon przebudowany po aktualizacji
- [ ] Logi pokazują "Addon ready"
- [ ] Port 8099 używany w trybie ingress
- [ ] Database connection test passed
- [ ] Konfiguracja `/data/options.json` poprawna
- [ ] Cache przeglądarki wyczyszczona (Ctrl+Shift+R)
- [ ] Home Assistant Supervisor zrestartowany (jeśli potrzebne)
