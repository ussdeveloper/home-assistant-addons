const express = require('express');
const mysql = require('mysql2/promise');
const cron = require('node-cron');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();

// Home Assistant Ingress support
app.use((req, res, next) => {
  const ingressPath = req.headers['x-ingress-path'] || '';
  req.ingressPath = ingressPath;
  next();
});

// Serve static assets with ingress path support
app.use((req, res, next) => {
  res.locals.ingressPath = req.ingressPath || '';
  next();
});

// Load configuration
let config;
try {
  // Try multiple config paths for Home Assistant compatibility
  let configPath;
  if (fs.existsSync('/data/options.json')) {
    configPath = '/data/options.json';
  } else if (fs.existsSync('/app/tauron-db-config.json')) {
    configPath = '/app/tauron-db-config.json';
  } else if (fs.existsSync('./tauron-db-config.json')) {
    configPath = './tauron-db-config.json';
  } else if (fs.existsSync('./options.json')) {
    configPath = './options.json';
  } else {
    throw new Error('No configuration file found!');
  }
  
  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log(`✅ Loaded config from ${configPath}`);
  
  // Normalize config structure for both Home Assistant and standalone modes
  config = {
    database: rawConfig.database || rawConfig.db,
    tauron: rawConfig.tauron,
    schedule: rawConfig.schedule || { times: ['02:00', '10:00'] },
    http: rawConfig.http || { port: 8765 }
  };
} catch (err) {
  console.log('❌ Failed to load configuration:', err.message);
  process.exit(1);
}

// Use ingress port (8099) for Home Assistant, fallback to config or 8765
const PORT = process.env.HASSIO_TOKEN ? 8099 : (config.http?.port || 8765);

// Mask password for logging
const maskPassword = (password) => {
  if (!password || password.length < 3) return '***';
  return password[0] + '*'.repeat(password.length - 2) + password[password.length - 1];
};

console.log('📋 Config loaded:', {
  database: { host: config.database.host, user: config.database.user, name: config.database.name, table: config.database.table },
  tauron: { 
    username: config.tauron.username,
    password: maskPassword(config.tauron.password)
  },
  schedule: config.schedule.times,
  http: { port: config.http.port }
});

// Database connection helper
async function connectDB() {
  return await mysql.createConnection({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name
  });
}

// Call tauron-reader binary with arguments
async function callTauronReader(args = []) {
  return new Promise((resolve, reject) => {
    console.log(`🔌 Calling tauron-reader with args: [${args.join(', ')}]`);
    
    // Determine working directory (Docker vs local)
    const cwd = fs.existsSync('/app') ? '/app' : process.cwd();
    
    const tauronReader = spawn('./tauron-reader', args, {
      cwd: cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    tauronReader.stdout.on('data', (data) => {
      const output = data.toString().trim();
      stdout += output + '\n';
      if (output) console.log('📊', output);
    });
    
    tauronReader.stderr.on('data', (data) => {
      const output = data.toString().trim();
      stderr += output + '\n';
      if (output) console.log('⚠️', output);
    });
    
    tauronReader.on('close', (code) => {
      console.log(`✅ tauron-reader exited with code ${code}`);
      
      if (code === 0) {
        resolve({ success: true, stdout, stderr });
      } else {
        reject(new Error(`tauron-reader failed with code ${code}: ${stderr || stdout}`));
      }
    });
    
    tauronReader.on('error', (err) => {
      console.log('❌ Failed to start tauron-reader:', err.message);
      reject(err);
    });
  });
}

// Test database connection using tauron-reader
async function testDB() {
  try {
    await callTauronReader(['-test-db']);
    console.log('✅ Database connection test passed');
    return true;
  } catch (err) {
    console.log('❌ Database connection test failed:', err.message);
    return false;
  }
}

// Test Tauron service connection
async function testTauronService() {
  try {
    await callTauronReader(['-test-service']);
    console.log('✅ Tauron service connection test passed');
    return true;
  } catch (err) {
    console.log('⚠️ Tauron service connection test failed:', err.message);
    return false;
  }
}

// Get energy statistics from database
async function getEnergyStats() {
  const db = await connectDB();
  
  try {
    // Get today's data
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    
    const [todayRows] = await db.execute(`
      SELECT 
        SUM(consumption) as total_consumption,
        SUM(production) as total_production,
        COUNT(*) as records
      FROM ${config.database.table} 
      WHERE DATE(ts_real) = ?
    `, [todayStr]);
    
    // Get yesterday's data
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    
    const [yesterdayRows] = await db.execute(`
      SELECT 
        SUM(consumption) as total_consumption,
        SUM(production) as total_production
      FROM ${config.database.table} 
      WHERE DATE(ts_real) = ?
    `, [yesterdayStr]);
    
    // Get this week's data
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    
    const [weekRows] = await db.execute(`
      SELECT 
        SUM(consumption) as total_consumption,
        SUM(production) as total_production
      FROM ${config.database.table} 
      WHERE ts_real >= ?
    `, [weekStartStr]);
    
    // Get latest record
    const [latestRows] = await db.execute(`
      SELECT ts_real 
      FROM ${config.database.table} 
      ORDER BY ts_real DESC 
      LIMIT 1
    `);
    
    const todayData = todayRows[0] || { total_consumption: 0, total_production: 0, records: 0 };
    const yesterdayData = yesterdayRows[0] || { total_consumption: 0, total_production: 0 };
    const weekData = weekRows[0] || { total_consumption: 0, total_production: 0 };
    const latestRecord = latestRows[0] ? new Date(latestRows[0].ts_real) : null;
    
    return {
      today: {
        consumption: Math.round(todayData.total_consumption / 1000), // Convert to kWh
        production: Math.round(todayData.total_production / 1000),
        records: todayData.records
      },
      yesterday: {
        consumption: Math.round(yesterdayData.total_consumption / 1000),
        production: Math.round(yesterdayData.total_production / 1000)
      },
      week: {
        consumption: Math.round(weekData.total_consumption / 1000),
        production: Math.round(weekData.total_production / 1000)
      },
      latestUpdate: latestRecord ? latestRecord.toLocaleString('pl-PL') : 'Brak danych'
    };
    
  } finally {
    await db.end();
  }
}

// Save run log
function logRun(status, records, message) {
  const logEntry = {
    time: new Date().toISOString(),
    status,
    records,
    message
  };
  
  try {
    fs.mkdirSync('/data/buffer', { recursive: true });
    fs.appendFileSync('/data/buffer/runs.log.jsonl', JSON.stringify(logEntry) + '\n');
  } catch (err) {
    console.log('⚠️ Failed to save log:', err.message);
  }
}

// Main fetch function
async function fetchTauronData(force = false) {
  const startTime = Date.now();
  console.log('\n🚀 === Starting Tauron data fetch ===');
  
  try {
    const args = ['-verbose'];
    if (force) {
      args.push('-force');
      console.log('🔥 Force mode enabled - bypassing throttle');
    }
    
    console.log('🌐 Calling tauron-reader...');
    const result = await callTauronReader(args);
    
    const duration = Date.now() - startTime;
    console.log(`✅ === Fetch completed successfully in ${(duration/1000).toFixed(1)}s ===\n`);
    logRun('success', 0, 'Data fetched successfully');
    
    return { success: true, duration, output: result.stdout };
    
  } catch (err) {
    const duration = Date.now() - startTime;
    console.log(`❌ === Fetch failed after ${(duration/1000).toFixed(1)}s: ${err.message} ===\n`);
    logRun('error', 0, err.message);
    
    return { success: false, duration, error: err.message };
  }
}

// Get recent logs
function getRecentLogs(limit = 20) {
  try {
    const logs = fs.readFileSync('/data/buffer/runs.log.jsonl', 'utf8')
      .trim().split('\n')
      .filter(line => line.trim())
      .slice(-limit)
      .map(line => JSON.parse(line))
      .reverse();
    return logs;
  } catch (err) {
    return [];
  }
}

// Web interface routes
app.get('/', async (req, res) => {
  try {
    const stats = await getEnergyStats();
    const logs = getRecentLogs(20);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Tauron Reader</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #0d1117;
            color: #c9d1d9;
            height: 100vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }
          
          /* Sekcja wykresów - Grafana style */
          .chart-section {
            width: 100%;
            background: #161b22;
            height: 230px;
            display: flex;
            flex-direction: column;
            border-bottom: 1px solid #30363d;
          }
          .chart-top-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 5px 15px;
            background: linear-gradient(180deg, #161b22 0%, #0d1117 100%);
            border-bottom: 1px solid #30363d;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            height: 30px;
            flex-shrink: 0;
          }
          .chart-title {
            font-size: 14px;
            font-weight: 700;
            color: #58a6ff;
            letter-spacing: 0.3px;
            text-shadow: 0 1px 2px rgba(0,0,0,0.5);
          }
          .chart-tabs {
            display: flex;
            gap: 5px;
          }
          .chart-tab {
            padding: 5px 12px;
            background: #21262d;
            border: 1px solid #30363d;
            border-radius: 4px;
            color: #8b949e;
            cursor: pointer;
            font-size: 11px;
            transition: all 0.2s;
          }
          .chart-tab:hover {
            background: #30363d;
            color: #c9d1d9;
          }
          .chart-tab.active {
            background: #1f6feb;
            color: white;
            border-color: #1f6feb;
          }
          .chart-menu {
            display: flex;
            gap: 10px;
            align-items: center;
          }
          .checkbox-group {
            display: flex;
            gap: 12px;
          }
          .checkbox-group label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            cursor: pointer;
            user-select: none;
            color: #8b949e;
            padding: 4px 8px;
            border-radius: 4px;
            transition: all 0.2s;
          }
          .checkbox-group label:hover {
            background: rgba(88, 166, 255, 0.1);
            color: #c9d1d9;
          }
          .checkbox-group input[type="checkbox"] {
            cursor: pointer;
            width: 14px;
            height: 14px;
          }
          .btn {
            background: linear-gradient(180deg, #2ea043 0%, #238636 100%);
            color: white;
            border: none;
            padding: 6px 14px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            transition: all 0.2s;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            letter-spacing: 0.3px;
          }
          .btn:hover {
            background: linear-gradient(180deg, #3fb950 0%, #2ea043 100%);
            transform: translateY(-1px);
            box-shadow: 0 3px 6px rgba(0,0,0,0.4);
          }
          .btn:active {
            transform: translateY(0);
            box-shadow: 0 1px 2px rgba(0,0,0,0.3);
          }
          .btn-secondary {
            background: linear-gradient(180deg, #388bfd 0%, #1f6feb 100%);
          }
          .btn-secondary:hover {
            background: linear-gradient(180deg, #58a6ff 0%, #388bfd 100%);
          }
          
          .chart-container {
            position: relative;
            flex: 1;
            background: #0d1117;
            padding: 10px 15px;
          }
          
          /* Sekcje dolne */
          .content-sections {
            display: flex;
            flex: 1;
            overflow: hidden;
            gap: 1px;
            background: #30363d;
          }
          
          .section {
            flex: 1;
            background: #161b22;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          
          .section-header {
            background: linear-gradient(180deg, #161b22 0%, #0d1117 100%);
            padding: 5px 15px;
            border-bottom: 1px solid #30363d;
            box-shadow: 0 1px 2px rgba(0,0,0,0.2);
            height: 30px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          
          .section-title {
            font-size: 13px;
            font-weight: 700;
            color: #58a6ff;
            letter-spacing: 0.3px;
          }
          
          .section-count {
            font-size: 10px;
            color: #8b949e;
          }
          
          .section-content {
            flex: 1;
            overflow-y: auto;
            padding: 15px;
            background: #0d1117;
          }
          
          /* Logi */
          .log-entry {
            background: #161b22;
            border-left: 3px solid #3fb950;
            padding: 10px 12px;
            margin-bottom: 8px;
            border-radius: 6px;
            font-size: 11px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            transition: all 0.2s;
          }
          .log-entry:hover {
            background: #1c2128;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            transform: translateX(2px);
          }
          .log-entry.error {
            border-left-color: #f85149;
          }
          .log-time {
            color: #8b949e;
            font-size: 10px;
          }
          .log-message {
            margin-top: 3px;
            color: #c9d1d9;
          }
          
          /* Status */
          .status-item {
            background: #161b22;
            padding: 12px 14px;
            margin-bottom: 10px;
            border-radius: 8px;
            font-size: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            border: 1px solid #21262d;
            transition: all 0.2s;
          }
          .status-item:hover {
            border-color: #30363d;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
          }
          .status-label {
            color: #8b949e;
            font-size: 11px;
            margin-bottom: 4px;
          }
          .status-value {
            color: #c9d1d9;
            font-weight: 500;
          }
          .status-value.success {
            color: #3fb950;
          }
          .status-value.error {
            color: #f85149;
          }
          .status-value.warning {
            color: #d29922;
          }
          
          .schedule-item {
            display: inline-block;
            background: #21262d;
            padding: 4px 8px;
            margin: 2px;
            border-radius: 4px;
            font-size: 11px;
            color: #58a6ff;
          }
          
          /* Scrollbar */
          ::-webkit-scrollbar {
            width: 8px;
          }
          ::-webkit-scrollbar-track {
            background: #0d1117;
          }
          ::-webkit-scrollbar-thumb {
            background: #30363d;
            border-radius: 4px;
          }
          ::-webkit-scrollbar-thumb:hover {
            background: #484f58;
          }
        </style>
      </head>
      <body>
        <!-- Sekcja wykresów - Grafana style -->
        <div class="chart-section">
          <div class="chart-top-bar">
            <div style="display: flex; gap: 15px; align-items: center;">
              <div class="chart-title">📊 Produkcja energii</div>
              <div class="chart-tabs">
                <div class="chart-tab active" onclick="switchChartType('monthly')">Miesięczna</div>
                <div class="chart-tab" onclick="switchChartType('daily')">Ó24h</div>
                <div class="chart-tab" onclick="switchChartType('yearly')">Ód roku</div>
              </div>
            </div>
            <div class="chart-menu">
              <div class="checkbox-group" id="chartOptions">
                <label>
                  <input type="checkbox" id="showProduction" checked onchange="updateChart()">
                  <span>� Produkcja</span>
                </label>
              </div>
              <button class="btn btn-secondary" onclick="runNow()">▶️ Uruchom</button>
            </div>
          </div>
          <div class="chart-container">
            <canvas id="energyChart"></canvas>
          </div>
        </div>
        
        <!-- Sekcje dolne -->
        <div class="content-sections">
          <!-- Logi -->
          <div class="section">
            <div class="section-header">
              <div class="section-title">📝 Logi i aktualizacje</div>
              <div class="section-count">${logs.length} wpisów</div>
            </div>
            <div class="section-content">
              ${logs.map(log => `
                <div class="log-entry ${log.status === 'error' ? 'error' : ''}">
                  <div class="log-time">${new Date(log.time).toLocaleString('pl-PL')}</div>
                  <div class="log-message">${log.status === 'success' ? '✅' : '❌'} ${log.message}</div>
                </div>
              `).join('')}
              ${logs.length === 0 ? '<div style="color: #8b949e; font-size: 12px; text-align: center; padding: 20px;">Brak logów</div>' : ''}
            </div>
          </div>
          
          <!-- Status i podsumowanie -->
          <div class="section">
            <div class="section-header">
              <div class="section-title">ℹ️ Status i podsumowanie</div>
            </div>
            <div class="section-content">
            
            <div class="status-item">
              <div class="status-label">OSTATNIA AKTUALIZACJA</div>
              <div class="status-value">${stats.latestUpdate}</div>
            </div>
            
            <div class="status-item">
              <div class="status-label">DZISIAJ</div>
              <div class="status-value">⚡ ${stats.today.consumption} kWh zużycie</div>
              <div class="status-value">☀️ ${stats.today.production} kWh produkcja</div>
            </div>
            
            <div class="status-item">
              <div class="status-label">TEN TYDZIEŃ</div>
              <div class="status-value">⚡ ${stats.week.consumption} kWh zużycie</div>
              <div class="status-value">☀️ ${stats.week.production} kWh produkcja</div>
            </div>
            
            <div class="status-item">
              <div class="status-label">WCZORAJ</div>
              <div class="status-value">⚡ ${stats.yesterday.consumption} kWh zużycie</div>
              <div class="status-value">☀️ ${stats.yesterday.production} kWh produkcja</div>
            </div>
            
            <div class="status-item">
              <div class="status-label">POŁĄCZENIE TAURON</div>
              <div class="status-value success" id="tauronStatus">🟢 Aktywne</div>
            </div>
            
            <div class="status-item">
              <div class="status-label">POŁĄCZENIE BAZA DANYCH</div>
              <div class="status-value success" id="dbStatus">🟢 Aktywne</div>
            </div>
            
            <div class="status-item">
              <div class="status-label">ZAPLANOWANE URUCHOMIENIA</div>
              <div class="status-value">
                ${config.schedule.times.map(time => `<span class="schedule-item">⏰ ${time}</span>`).join('')}
              </div>
            </div>
            </div>
          </div>
        </div>
        
        <script>
          // Ingress path support for Home Assistant
          const basePath = window.location.pathname.replace(/\/$/, '');
          
          // Chart setup
          const ctx = document.getElementById('energyChart').getContext('2d');
          let chart = null;
          let currentChartType = 'monthly'; // default
          
          function switchChartType(type) {
            currentChartType = type;
            
            // Update active tab
            document.querySelectorAll('.chart-tab').forEach(tab => tab.classList.remove('active'));
            event.target.classList.add('active');
            
            // Update title and options
            const titleEl = document.querySelector('.chart-title');
            const optionsEl = document.getElementById('chartOptions');
            
            if (type === 'monthly') {
              titleEl.textContent = '📊 Produkcja energii';
              optionsEl.innerHTML = '<label><input type="checkbox" id="showProduction" checked onchange="updateChart()"><span>🟢 Produkcja</span></label>';
            } else if (type === 'yearly') {
              titleEl.textContent = '📊 Od roku do teraz';
              optionsEl.innerHTML = '<label><input type="checkbox" id="showProduction" checked onchange="updateChart()"><span>🟢 Produkcja</span></label>';
            } else {
              titleEl.textContent = '📊 Ostatnie 24h';
              optionsEl.innerHTML = '<label><input type="checkbox" id="showProduction" checked onchange="updateChart()"><span>🟢 Produkcja</span></label><label><input type="checkbox" id="showConsumption" checked onchange="updateChart()"><span>🔴 Zużycie</span></label>';
            }
            
            updateChart();
          }
          
          async function updateChart() {
            const showProduction = document.getElementById('showProduction')?.checked || false;
            const showConsumption = document.getElementById('showConsumption')?.checked || false;
            
            try {
              // Select API endpoint based on chart type
              let apiUrl;
              if (currentChartType === 'monthly') {
                apiUrl = basePath + '/api/chart-data-monthly';
              } else if (currentChartType === 'yearly') {
                apiUrl = basePath + '/api/chart-data-yearly';
              } else {
                apiUrl = basePath + '/api/chart-data';
              }
              
              console.log('Fetching chart data from:', apiUrl);
              const response = await fetch(apiUrl);
              const data = await response.json();
              
              console.log('Chart data received:', data);
              
              if (!data.success) {
                console.error('Failed to load chart data:', data.error);
                document.querySelector('.chart-container').innerHTML = 
                  '<div style="color: #f85149; text-align: center; padding: 40px;">❌ Błąd ładowania danych: ' + data.error + '</div>';
                return;
              }
              
              if (!data.labels || data.labels.length === 0) {
                console.warn('No data available for chart');
                document.querySelector('.chart-container').innerHTML = 
                  '<div style="color: #8b949e; text-align: center; padding: 40px;">📊 Brak danych</div>';
                return;
              }
              
              const datasets = [];
              
              // For monthly/yearly - only production
              if (currentChartType === 'monthly' || currentChartType === 'yearly') {
                if (showProduction) {
                  datasets.push({
                    label: 'Produkcja (kWh)',
                    data: data.production,
                    borderColor: '#3fb950',
                    backgroundColor: 'rgba(63, 185, 80, 0.2)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 3
                  });
                }
              } else {
                // For daily - production and consumption
                if (showProduction) {
                  datasets.push({
                    label: 'Produkcja (kWh)',
                    data: data.production,
                    borderColor: '#3fb950',
                    backgroundColor: 'rgba(63, 185, 80, 0.1)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 2
                  });
                }
                if (showConsumption) {
                  datasets.push({
                    label: 'Zużycie (kWh)',
                    data: data.consumption,
                    borderColor: '#f85149',
                    backgroundColor: 'rgba(248, 81, 73, 0.1)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 2
                  });
                }
              }
              
              if (chart) chart.destroy();
              
              // Recreate canvas if it was replaced with error message
              const container = document.querySelector('.chart-container');
              if (!document.getElementById('energyChart')) {
                container.innerHTML = '<canvas id="energyChart"></canvas>';
              }
              
              const newCtx = document.getElementById('energyChart').getContext('2d');
              
              chart = new Chart(newCtx, {
                type: 'line',
                data: {
                  labels: data.labels,
                  datasets: datasets
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: false
                    },
                    tooltip: {
                      mode: 'index',
                      intersect: false
                    }
                  },
                  scales: {
                    y: {
                      beginAtZero: true,
                      grid: {
                        color: '#21262d'
                      },
                      ticks: {
                        color: '#8b949e',
                        font: { size: 10 },
                        callback: function(value) {
                          return value + ' kWh';
                        }
                      }
                    },
                    x: {
                      grid: {
                        color: '#21262d'
                      },
                      ticks: {
                        color: '#8b949e',
                        font: { size: 10 }
                      }
                    }
                  }
                }
              });
            } catch (err) {
              console.error('Chart update error:', err);
            }
          }
          
          function runNow() {
            if (confirm('Uruchomić pobieranie danych teraz?')) {
              fetch(basePath + '/run-now').then(() => {
                setTimeout(() => location.reload(), 2000);
              });
            }
          }
          
          // Initialize chart
          updateChart();
          
          // Auto-refresh every 60 seconds
          setInterval(() => {
            updateChart(); // Update chart only, not full page reload
          }, 60000);
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.log('❌ Failed to load stats:', err.message);
    res.send(`
      <html>
      <head><title>Tauron Reader - Error</title></head>
      <body style="font-family: Arial, sans-serif; margin: 20px;">
        <h1>❌ Błąd ładowania statystyk</h1>
        <p>${err.message}</p>
        <button onclick="location.reload()">Odśwież</button>
      </body>
      </html>
    `);
  }
});

app.get('/run-now', async (req, res) => {
  res.send('Manual run started. Check logs for status.');
  // Run with force flag to bypass throttle
  await fetchTauronData(true);
});

app.get('/api/status', async (req, res) => {
  try {
    const result = await callTauronReader(['-status']);
    res.json({ success: true, status: result.stdout });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/runs', (req, res) => {
  try {
    const logs = fs.readFileSync('/data/buffer/runs.log.jsonl', 'utf8')
      .trim().split('\n')
      .filter(line => line.trim())
      .slice(-50)
      .map(line => JSON.parse(line))
      .reverse();
    res.json(logs);
  } catch (err) {
    res.json([]);
  }
});

// API endpoint for monthly production data (current month across years)
app.get('/api/chart-data-monthly', async (req, res) => {
  try {
    const db = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name
    });

    const currentMonth = new Date().getMonth() + 1; // 1-12

    // Get total production for current month across all available years
    const [rows] = await db.execute(`
      SELECT 
        YEAR(ts_real) as year,
        SUM(oze) / 1000 as total_production
      FROM ${config.database.table}
      WHERE MONTH(ts_real) = ?
      GROUP BY year
      ORDER BY year ASC
    `, [currentMonth]);

    await db.end();

    const labels = rows.map(r => r.year.toString());
    const production = rows.map(r => parseFloat(r.total_production || 0).toFixed(2));

    res.json({
      success: true,
      labels,
      production,
      month: new Date().toLocaleString('pl-PL', { month: 'long' })
    });
  } catch (err) {
    console.log('❌ Chart monthly data error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// API endpoint for yearly comparison
app.get('/api/chart-data-yearly', async (req, res) => {
  try {
    const db = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name
    });

    const currentYear = new Date().getFullYear();

    // Get monthly totals for current year
    const [rows] = await db.execute(`
      SELECT 
        MONTH(ts_real) as month,
        SUM(oze) / 1000 as total_production
      FROM ${config.database.table}
      WHERE YEAR(ts_real) = ?
      GROUP BY month
      ORDER BY month ASC
    `, [currentYear]);

    await db.end();

    const monthNames = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
    const labels = rows.map(r => monthNames[r.month - 1]);
    const production = rows.map(r => parseFloat(r.total_production || 0).toFixed(2));

    res.json({
      success: true,
      labels,
      production,
      year: currentYear
    });
  } catch (err) {
    console.log('❌ Chart yearly data error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// API endpoint for chart data (last 24 hours)
app.get('/api/chart-data', async (req, res) => {
  try {
    const db = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name
    });

    // Get hourly data for last 24 hours
    const [rows] = await db.execute(`
      SELECT 
        DATE_FORMAT(ts_real, '%Y-%m-%d %H:00:00') as hour,
        SUM(ec) as consumption,
        SUM(oze) as production
      FROM ${config.database.table}
      WHERE ts_real >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY hour
      ORDER BY hour ASC
    `);

    await db.end();

    const labels = rows.map(r => {
      const date = new Date(r.hour);
      return date.getHours() + 'h';
    });
    const consumption = rows.map(r => parseFloat((r.consumption || 0) / 1000).toFixed(2)); // Convert to kWh
    const production = rows.map(r => parseFloat((r.production || 0) / 1000).toFixed(2));

    res.json({
      success: true,
      labels,
      consumption,
      production
    });
  } catch (err) {
    console.log('❌ Chart data error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// Start server
async function start() {
  console.log('🎯 === Tauron Reader Addon v3.3.0 ===');
  console.log('📅 Startup time:', new Date().toISOString());
  console.log('🔧 Node.js version:', process.version);
  console.log('📁 Working directory:', process.cwd());
  
  // Test database
  const dbOk = await testDB();
  if (!dbOk) {
    console.log('❌ Exiting due to database connection failure');
    process.exit(1);
  }
  
  // Test Tauron service (non-critical)
  await testTauronService();
  
  // Setup cron jobs
  console.log('⏰ Setting up scheduled tasks...');
  config.schedule.times.forEach(time => {
    console.log(`📅 Scheduling task at ${time}`);
    const [hour, minute] = time.split(':');
    cron.schedule(`${minute} ${hour} * * *`, () => fetchTauronData(false));
  });
  
  // Start web server
  const isIngress = process.env.HASSIO_TOKEN ? true : false;
  app.listen(PORT, () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
    if (isIngress) {
      console.log('🔗 Ingress mode: Available in Home Assistant sidebar');
    } else {
      console.log(`🔗 Direct access: http://YOUR_HA_IP:${PORT}`);
    }
    console.log('✅ === Addon ready ===\n');
    
    // Perform initial data fetch after startup
    console.log('🚀 Performing initial data fetch in 10 seconds...');
    setTimeout(() => {
      fetchTauronData(false).then(result => {
        if (result.success) {
          console.log('✅ Initial data fetch completed');
        } else {
          console.log('⚠️ Initial data fetch failed:', result.error);
        }
      });
    }, 10000); // Wait 10 seconds after startup
  });
}

start().catch(err => {
  console.error('💥 Startup failed:', err);
  process.exit(1);
});
