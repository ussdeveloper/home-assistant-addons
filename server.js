const express = require('express');
const mysql = require('mysql2/promise');
const cron = require('node-cron');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = 8765;

// Load configuration
let config;
try {
  // Try Home Assistant path first, then local fallback
  const configPath = fs.existsSync('/data/options.json') 
    ? '/data/options.json' 
    : './options.json';
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log(`✅ Loaded config from ${configPath}`);
} catch (err) {
  console.log('❌ Failed to load configuration:', err.message);
  process.exit(1);
}

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

// Web interface routes
app.get('/', async (req, res) => {
  try {
    const stats = await getEnergyStats();
    
    res.send(`
      <html>
      <head>
        <title>Tauron Reader</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
          .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { text-align: center; margin-bottom: 30px; }
          .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
          .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; border-left: 4px solid #007bff; }
          .stat-value { font-size: 2em; font-weight: bold; color: #007bff; }
          .stat-label { color: #666; margin-top: 5px; }
          .controls { text-align: center; margin-bottom: 30px; }
          .btn { background: #007bff; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 16px; margin: 5px; }
          .btn:hover { background: #0056b3; }
          .btn-secondary { background: #6c757d; }
          .btn-secondary:hover { background: #545b62; }
          .section { margin-bottom: 30px; }
          .section h3 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 5px; }
          .info { background: #e9ecef; padding: 15px; border-radius: 6px; }
          ul { list-style: none; padding: 0; }
          ul li { padding: 5px 0; }
          a { color: #007bff; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔌 Tauron Reader Status</h1>
            <p>Ostatnia aktualizacja: ${stats.latestUpdate}</p>
          </div>
          
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-value">${stats.today.consumption} kWh</div>
              <div class="stat-label">Zużycie dziś</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${stats.today.production} kWh</div>
              <div class="stat-label">Produkcja dziś</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${stats.week.consumption} kWh</div>
              <div class="stat-label">Zużycie w tym tygodniu</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${stats.week.production} kWh</div>
              <div class="stat-label">Produkcja w tym tygodniu</div>
            </div>
          </div>
          
          <div class="controls">
            <button onclick="runNow()" class="btn">▶️ Uruchom teraz</button>
            <button onclick="checkStatus()" class="btn btn-secondary">📊 Sprawdź status</button>
          </div>
          
          <div class="section">
            <h3>📅 Harmonogram</h3>
            <div class="info">
              <ul>${config.schedule.times.map(time => `<li>⏰ ${time}</li>`).join('')}</ul>
            </div>
          </div>
          
          <div class="section">
            <h3>📊 Historia uruchomień</h3>
            <div class="info">
              <a href="/api/runs" target="_blank">Zobacz szczegóły</a>
            </div>
          </div>
        </div>
        
        <script>
          function runNow() {
            if (confirm('Czy na pewno chcesz uruchomić pobieranie danych?')) {
              fetch('/run-now').then(() => {
                alert('Rozpoczęto pobieranie danych! Sprawdź logi za kilka sekund.');
              });
            }
          }
          
          function checkStatus() {
            fetch('/api/status')
              .then(r => r.json())
              .then(data => {
                if (data.success) {
                  alert('Status:\\n\\n' + data.status);
                } else {
                  alert('Błąd: ' + data.error);
                }
              });
          }
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

// Start server
async function start() {
  console.log('🎯 === Tauron Reader Addon v3.0.1 ===');
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
