package main

import (
	"bufio"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

type Config struct {
	Database struct {
		Host     string `json:"host"`
		Port     int    `json:"port"`
		User     string `json:"user"`
		Password string `json:"password"`
		Name     string `json:"name"`
		Table    string `json:"table"`
	} `json:"database"`
	Tauron struct {
		Username string `json:"username"`
		Password string `json:"password"`
	} `json:"tauron"`
	Schedule struct {
		Times []string `json:"times"`
	} `json:"schedule"`
	Http struct {
		Port int `json:"port"`
	} `json:"http"`
}

type EnergyData struct {
	Date        string
	Consumption int
	Production  int
}

type RunRecord struct {
	Time       string `json:"time"`
	Status     string `json:"status"`
	Message    string `json:"message"`
	Records    int    `json:"records"`
	DurationMs int64  `json:"durationMs"`
}

func main() {
	config, err := loadConfig("/data/options.json")
	if err != nil {
		log.Fatal("Error loading config:", err)
	}

	// Set default HTTP port from config, or 8765 if not set
	defaultHttpPort := 8765
	if config.Http.Port > 0 {
		defaultHttpPort = config.Http.Port
	}

	verbose := flag.Bool("verbose", false, "Enable verbose output")
	force := flag.Bool("force", false, "Force fetch even if data was recently updated (bypass throttle)")
	httpPort := flag.Int("http-port", defaultHttpPort, "HTTP server port for run status page")
	serveOnly := flag.Bool("serve-only", false, "Run only the HTTP status server and do not fetch data")
	flag.Parse()

	// normalize schedule times once
	times, err := normalizeTimes(config.Schedule.Times)
	if err != nil {
		log.Fatal("Invalid schedule times:", err)
	}
	if len(times) == 0 {
		times = defaultTimes()
	}

	// Serve-only mode for persistent status server (needs config for schedule)
	if *serveOnly {
		if err := startHTTPServer(*httpPort, times, config); err != nil {
			log.Fatal(err)
		}
		return
	}

	// Normal operation
	runStart := time.Now()

	if *verbose {
		fmt.Println("Connecting to database...")
	}
	db, err := connectDB(config)
	if err != nil {
		logAndExit(runStart, "error", 0, fmt.Sprintf("DB connect error: %v", err))
	}
	defer db.Close()
	if *verbose {
		fmt.Println("Connected to database.")
	}

	// Check if data was recently fetched (within last hour) unless forced
	if !*force && shouldSkipFetch(db, config.Database.Table, *verbose) {
		if *verbose {
			fmt.Println("Data was recently fetched, skipping...")
		}
		fmt.Println("Data fetch skipped (recently updated).")
		logRun(runStart, "skipped", 0, "recently updated")
		return
	}

	if *verbose {
		fmt.Println("Logging in to Tauron...")
	}
	client, err := loginToTauron(config)
	if err != nil {
		logAndExit(runStart, "error", 0, fmt.Sprintf("Login error: %v", err))
	}
	if *verbose {
		fmt.Println("Logged in to Tauron.")
	}

	if *verbose {
		fmt.Println("Fetching data...")
	}
	data, err := fetchData(client, *verbose)
	if err != nil {
		logAndExit(runStart, "error", 0, fmt.Sprintf("Fetch error: %v", err))
	}
	if *verbose {
		fmt.Printf("Fetched %d records.\n", len(data))
	}

	if *verbose {
		fmt.Println("Inserting data...")
	}
	err = insertData(db, data, config.Database.Table, *verbose)
	if err != nil {
		logAndExit(runStart, "error", len(data), fmt.Sprintf("Insert error: %v", err))
	}
	if *verbose {
		fmt.Printf("Inserted %d records.\n", len(data))
	}

	// Save buffer to file
	err = saveBufferToFile(data, "/data/buffer")
	if err != nil {
		logAndExit(runStart, "error", len(data), fmt.Sprintf("Buffer save error: %v", err))
	}

	fmt.Println("Data fetched and inserted successfully.")
	logRun(runStart, "success", len(data), "ok")
}

func loadConfig(filename string) (*Config, error) {
	file, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var config Config
	decoder := json.NewDecoder(file)
	err = decoder.Decode(&config)
	return &config, err
}

func connectDB(config *Config) (*sql.DB, error) {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s",
		config.Database.User,
		config.Database.Password,
		config.Database.Host,
		config.Database.Port,
		config.Database.Name)
	return sql.Open("mysql", dsn)
}

func loginToTauron(config *Config) (*http.Client, error) {
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	// Initial GET to get cookies
	resp, err := client.Get("https://elicznik.tauron-dystrybucja.pl/")
	if err != nil {
		return nil, err
	}
	resp.Body.Close()

	// POST login with redirect handling
	loginURL := "https://logowanie.tauron-dystrybucja.pl/login"
	data := url.Values{}
	data.Set("username", config.Tauron.Username)
	data.Set("password", config.Tauron.Password)
	data.Set("service", "https://elicznik.tauron-dystrybucja.pl")

	var redirectCookies []*http.Cookie
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		// Collect cookies from redirect responses
		redirectCookies = append(redirectCookies, req.Cookies()...)
		if len(via) >= 2 {
			return http.ErrUseLastResponse // Stop after 2 redirects
		}
		return nil
	}

	req, err := http.NewRequest("POST", loginURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.82 Safari/537.36")
	req.Header.Set("Accept", "application/json, text/javascript, */*; q=0.01")

	resp, err = client.Do(req)
	if err != nil {
		return nil, err
	}
	resp.Body.Close()

	// Add redirect cookies to jar
	u, _ := url.Parse("https://elicznik.tauron-dystrybucja.pl")
	client.Jar.SetCookies(u, redirectCookies)

	// Reset CheckRedirect
	client.CheckRedirect = nil

	if resp.StatusCode != 200 && resp.StatusCode != 302 {
		return nil, fmt.Errorf("login failed with status %d", resp.StatusCode)
	}

	return client, nil
}

func fetchData(client *http.Client, verbose bool) ([]EnergyData, error) {
	// Use Europe/Warsaw timezone like Node-RED Moment nodes
	loc, err := time.LoadLocation("Europe/Warsaw")
	if err != nil {
		loc = time.Local
	}
	now := time.Now().In(loc)
	startDate := now.AddDate(0, 0, -3).Format("02.01.2006")
	endDate := now.Format("02.01.2006")

	dataURL := fmt.Sprintf("https://elicznik.tauron-dystrybucja.pl/energia/do/dane?form[from]=%s&form[to]=%s&form[type]=godzin&form[energy][netto]=1&form[energy][netto_oze]=1&form[fileType]=CSV",
		startDate, endDate)

	req, err := http.NewRequest("GET", dataURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "PostmanRuntime/7.29.2")
	req.Header.Set("Accept", "*/*")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("fetch failed with status %d", resp.StatusCode)
	}

	// Parse CSV
	reader := csv.NewReader(bufio.NewReader(resp.Body))
	reader.Comma = ';'
	reader.FieldsPerRecord = -1

	records, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}

	if verbose {
		fmt.Printf("CSV has %d rows\n", len(records))
	}

	// Get headers from first row - handle encoding issues
	headers := make(map[string]int)
	var valueColumnKey string
	for i, h := range records[0] {
		key := strings.TrimSpace(h)
		headers[key] = i
		// Find the value column regardless of encoding
		if strings.Contains(strings.ToLower(key), "warto") && strings.Contains(strings.ToLower(key), "kwh") {
			valueColumnKey = key
		}
	}

	if verbose {
		fmt.Printf("Headers found: %v\n", headers)
		fmt.Printf("Value column key: '%s'\n", valueColumnKey)
	}

	if valueColumnKey == "" {
		return nil, fmt.Errorf("could not find value column in CSV")
	}

	// Convert records to objects
	var csvObjects []map[string]string
	for i := 1; i < len(records); i++ {
		obj := make(map[string]string)
		for header, index := range headers {
			if index < len(records[i]) {
				obj[header] = strings.TrimSpace(records[i][index])
			}
		}
		if len(obj) > 0 {
			csvObjects = append(csvObjects, obj)
		}
	}

	if verbose {
		fmt.Printf("Parsed %d objects with value column: %s\n", len(csvObjects), valueColumnKey)
	}

	// Filter and process like Node-RED ParserDB
	var data []EnergyData

	// Filter items with 'pobrana po zbilansowaniu' (KWP - consumption)
	for _, item := range csvObjects {
		rodzaj := item["Rodzaj"]
		if rodzaj != "pobrana po zbilansowaniu" {
			continue
		}

		dataStr := item["Data"]
		wartoscStr := item[valueColumnKey]

		// Find matching 'oddana po zbilansowaniu' with same date (WP - production)
		var production float64
		for _, prod := range csvObjects {
			if prod["Rodzaj"] == "oddana po zbilansowaniu" && prod["Data"] == dataStr {
				wartoscProdStr := prod[valueColumnKey]
				wartoscProdStr = strings.Replace(wartoscProdStr, ",", ".", -1)
				p, err := strconv.ParseFloat(wartoscProdStr, 64)
				if err == nil {
					production = p
				}
				break
			}
		}

		// Parse consumption in kWh
		wartoscStr = strings.Replace(wartoscStr, ",", ".", -1)
		consumption, err := strconv.ParseFloat(wartoscStr, 64)
		if err != nil {
			continue
		}

		// Parse date and subtract 1 minute like Node-RED
		parsedDate, err := time.ParseInLocation("2006-01-02 15:04", dataStr, loc)
		if err != nil {
			// Handle 24:00 hour (should be 00:00 of next day)
			if strings.Contains(err.Error(), "hour out of range") && strings.Contains(dataStr, "24:00") {
				// Replace 24:00 with 00:00 and add 1 day
				dataStr = strings.Replace(dataStr, " 24:00", " 00:00", 1)
				parsedDate, err = time.ParseInLocation("2006-01-02 15:04", dataStr, loc)
				if err != nil {
					if verbose {
						fmt.Printf("Error parsing corrected date '%s': %v\n", dataStr, err)
					}
					continue
				}
				parsedDate = parsedDate.AddDate(0, 0, 1) // Add 1 day
			} else {
				if verbose {
					fmt.Printf("Error parsing date '%s': %v\n", dataStr, err)
				}
				continue
			}
		}
		parsedDate = parsedDate.Add(-time.Minute)
		ts := parsedDate.Format("2006-01-02 15:04:05")

		// Scale kWh to Wh (e.g., 0.653 kWh -> 653 Wh; 1.1 kWh -> 1100 Wh) and round to nearest integer
		consumptionWh := int(math.Round(consumption * 1000.0))
		productionWh := int(math.Round(production * 1000.0))

		data = append(data, EnergyData{
			Date:        ts,
			Consumption: consumptionWh,
			Production:  productionWh,
		})
	}

	// Preserve original CSV order like Node-RED (no explicit sorting here)

	return data, nil
}

func insertData(db *sql.DB, data []EnergyData, tableName string, verbose bool) error {
	for i, item := range data {
		query := fmt.Sprintf(`
			INSERT INTO %s (
				ts_real,
				consumption,
				production,
				temperatire_air,
				temperature_comfort,
				cloudiness,
				windspeed,
				windchill
			) VALUES (?, ?, ?, 0, 0, 0, 0, 0)
			ON DUPLICATE KEY UPDATE
				consumption = ?,
				production = ?,
				temperatire_air = 0,
				temperature_comfort = 0,
				cloudiness = 0,
				windspeed = 0,
				windchill = 0`, tableName)
		_, err := db.Exec(query, item.Date, item.Consumption, item.Production, item.Consumption, item.Production)
		if err != nil {
			return err
		}
		if verbose && (i+1)%10 == 0 {
			fmt.Printf("Inserted %d/%d records...\n", i+1, len(data))
		}
	}
	if verbose {
		fmt.Printf("All %d records inserted.\n", len(data))
	}
	return nil
}

func shouldSkipFetch(db *sql.DB, tableName string, verbose bool) bool {
	query := fmt.Sprintf("SELECT MAX(ts_real) FROM %s", tableName)
	var maxTs sql.NullString
	err := db.QueryRow(query).Scan(&maxTs)
	if err != nil {
		if verbose {
			fmt.Printf("Error checking last fetch time: %v\n", err)
		}
		return false // If error, proceed with fetch
	}
	if !maxTs.Valid {
		if verbose {
			fmt.Println("No data in table, proceeding with fetch.")
		}
		return false
	}

	lastFetch, err := time.Parse("2006-01-02 15:04:05", maxTs.String)
	if err != nil {
		if verbose {
			fmt.Printf("Error parsing last fetch time: %v\n", err)
		}
		return false
	}

	oneHourAgo := time.Now().Add(-time.Hour)
	if lastFetch.After(oneHourAgo) {
		if verbose {
			fmt.Printf("Last fetch was at %s, which is within the last hour.\n", maxTs.String)
		}
		return true
	}

	if verbose {
		fmt.Printf("Last fetch was at %s, proceeding with fetch.\n", maxTs.String)
	}
	return false
}

func saveBufferToFile(data []EnergyData, bufferDir string) error {
	// Create buffer directory if it doesn't exist
	err := os.MkdirAll(bufferDir, 0755)
	if err != nil {
		return err
	}

	// Create filename with timestamp
	filename := fmt.Sprintf("%s/buffer_%s.json", bufferDir, time.Now().Format("2006-01-02_15-04-05"))

	// Marshal data to JSON
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	// Write to file
	err = os.WriteFile(filename, jsonData, 0644)
	if err != nil {
		return err
	}

	fmt.Printf("Buffer saved to %s\n", filename)
	return nil
}

// ---- Run logging and HTTP server ----

func runLogPath() string {
	return filepath.Join("/data/buffer", "runs.log.jsonl")
}

func logRun(start time.Time, status string, records int, message string) {
	rec := RunRecord{
		Time:       time.Now().Format(time.RFC3339),
		Status:     status,
		Message:    message,
		Records:    records,
		DurationMs: time.Since(start).Milliseconds(),
	}
	_ = os.MkdirAll("/data/buffer", 0755)
	f, err := os.OpenFile(runLogPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	b, _ := json.Marshal(rec)
	f.Write(b)
	f.Write([]byte("\n"))
}

func logAndExit(start time.Time, status string, records int, message string) {
	logRun(start, status, records, message)
	log.Fatal(message)
}

func readLastRuns(limit int) ([]RunRecord, error) {
	data, err := os.ReadFile(runLogPath())
	if err != nil {
		if os.IsNotExist(err) {
			return []RunRecord{}, nil
		}
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	var recs []RunRecord
	for i := len(lines) - 1; i >= 0 && len(recs) < limit; i-- {
		var r RunRecord
		if err := json.Unmarshal([]byte(lines[i]), &r); err == nil {
			recs = append(recs, r)
		}
	}
	// reverse to chronological
	for i := 0; i < len(recs)/2; i++ {
		recs[i], recs[len(recs)-1-i] = recs[len(recs)-1-i], recs[i]
	}
	return recs, nil
}

func startHTTPServer(port int, scheduleTimes []string, config *Config) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		recs, _ := readLastRuns(50)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		// Polish timezone and format
		loc, _ := time.LoadLocation("Europe/Warsaw")
		polFmt := "15:04:05 02/01/2006"
		// HTML
		fmt.Fprintf(w, "<html><head><title>Tauron Reader - Status</title>"+
			"<meta charset='utf-8'>"+
			"<style>body{font-family:Segoe UI,Arial,sans-serif;margin:20px}h1{margin-top:0}table{border-collapse:collapse;width:100%%;max-width:1200px}td,th{border:1px solid #ddd;padding:8px}th{background:#f4f4f4;text-align:left}small{color:#666}ul{padding-left:20px}code{background:#f8f8f8;padding:2px 4px;border-radius:3px}</style></head><body>")
		fmt.Fprintf(w, "<h1>Status odczytu Tauron</h1>")
		fmt.Fprintf(w, "<button onclick=\"runNow()\">Uruchom teraz</button><br><br>")
		fmt.Fprintf(w, "<script>function runNow(){fetch('/run-now').then(r=>alert('Rozpoczęto uruchomienie ręczne'))}</script>")
		// Schedule times section
		fmt.Fprintf(w, "<h3>Zaplanowane uruchomienia</h3><ul>")
		for _, t := range scheduleTimes {
			fmt.Fprintf(w, "<li><code>%s</code></li>", t)
		}
		fmt.Fprintf(w, "</ul>")
		// Runs table
		fmt.Fprintf(w, "<h3>Ostatnie uruchomienia</h3>")
		fmt.Fprintf(w, "<table><tr><th>Czas</th><th>Status</th><th>Rekordy</th><th>Czas trwania (ms)</th><th>Wiadomość</th></tr>")
		for _, r := range recs {
			color := map[string]string{"success": "#2e7d32", "error": "#c62828", "skipped": "#6d6d6d"}[r.Status]
			// r.Time is RFC3339; show in Polish tz and format
			ts := r.Time
			if tt, err := time.Parse(time.RFC3339, r.Time); err == nil {
				ts = tt.In(loc).Format(polFmt)
			}
			fmt.Fprintf(w, "<tr><td>%s</td><td style='color:%s'>%s</td><td>%d</td><td>%d</td><td>%s</td></tr>", ts, color, r.Status, r.Records, r.DurationMs, r.Message)
		}
		fmt.Fprintf(w, "</table>")
		fmt.Fprintf(w, "<p><small>Strefa czasowa: Europa/Warszawa | API: <a href='/api/runs'>/api/runs</a>, <a href='/api/schedule'>/api/schedule</a></small></p>")
		fmt.Fprintf(w, "</body></html>")
	})
	mux.HandleFunc("/api/runs", func(w http.ResponseWriter, r *http.Request) {
		recs, _ := readLastRuns(100)
		w.Header().Set("Content-Type", "application/json")
		// augment with Polish formatted time
		loc, _ := time.LoadLocation("Europe/Warsaw")
		polFmt := "15:04:05 02/01/2006"
		type runOut struct {
			Time       string `json:"time"`
			TimePL     string `json:"time_pl"`
			Status     string `json:"status"`
			Message    string `json:"message"`
			Records    int    `json:"records"`
			DurationMs int64  `json:"durationMs"`
		}
		out := make([]runOut, 0, len(recs))
		for _, rr := range recs {
			ts := rr.Time
			tspl := rr.Time
			if tt, err := time.Parse(time.RFC3339, rr.Time); err == nil {
				ts = tt.Format(time.RFC3339)
				tspl = tt.In(loc).Format(polFmt)
			}
			out = append(out, runOut{
				Time:       ts,
				TimePL:     tspl,
				Status:     rr.Status,
				Message:    rr.Message,
				Records:    rr.Records,
				DurationMs: rr.DurationMs,
			})
		}
		json.NewEncoder(w).Encode(out)
	})
	mux.HandleFunc("/run-now", func(w http.ResponseWriter, r *http.Request) {
		go func() {
			runStart := time.Now()
			fmt.Println("Manual run started...")

			db, err := connectDB(config)
			if err != nil {
				logRun(runStart, "error", 0, fmt.Sprintf("DB connect error: %v", err))
				return
			}
			defer db.Close()

			client, err := loginToTauron(config)
			if err != nil {
				logRun(runStart, "error", 0, fmt.Sprintf("Login error: %v", err))
				return
			}

			data, err := fetchData(client, true)
			if err != nil {
				logRun(runStart, "error", 0, fmt.Sprintf("Fetch error: %v", err))
				return
			}

			err = insertData(db, data, config.Database.Table, true)
			if err != nil {
				logRun(runStart, "error", len(data), fmt.Sprintf("Insert error: %v", err))
				return
			}

			err = saveBufferToFile(data, "/data/buffer")
			if err != nil {
				logRun(runStart, "error", len(data), fmt.Sprintf("Buffer save error: %v", err))
				return
			}

			logRun(runStart, "success", len(data), "manual run")
			fmt.Println("Manual run completed.")
		}()
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Manual run started. Check logs for status."))
	})
	mux.HandleFunc("/api/schedule", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(struct {
			Times   []string `json:"times"`
			Timezone string  `json:"timezone"`
			Format   string  `json:"format"`
		}{Times: scheduleTimes, Timezone: "Europe/Warsaw", Format: "HH:MM:SS DD/MM/YYYY"})
	})
	srv := &http.Server{Addr: fmt.Sprintf(":%d", port), Handler: mux}
	return srv.ListenAndServe()
}

// schedule helpers
func normalizeTimes(times []string) ([]string, error) {
	seen := map[string]bool{}
	out := make([]string, 0, len(times))
	for _, raw := range times {
		s := strings.TrimSpace(raw)
		if s == "" {
			continue
		}
		// accept formats like 2:00 or 02:00; normalize to HH:MM
		tm, err := time.Parse("15:04", s)
		if err != nil {
			// try to pad if needed
			parts := strings.Split(s, ":")
			if len(parts) == 2 {
				if len(parts[0]) == 1 {
					parts[0] = "0" + parts[0]
				}
				if len(parts[1]) == 1 {
					parts[1] = "0" + parts[1]
				}
				s2 := parts[0] + ":" + parts[1]
				if _, err2 := time.Parse("15:04", s2); err2 == nil {
					s = s2
				} else {
					return nil, fmt.Errorf("invalid time format: %s", raw)
				}
			} else {
				return nil, fmt.Errorf("invalid time format: %s", raw)
			}
		} else {
			s = tm.Format("15:04")
		}
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out, nil
}

func defaultTimes() []string { return []string{"02:00", "10:00"} }
