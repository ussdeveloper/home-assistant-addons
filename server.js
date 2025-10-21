const express = require('express');
const mysql = require('mysql2/promise');
const cron = require('node-cron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = 8765;

// Load configuration
let config;
try {
  config = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
  console.log('✅ Loaded config from /data/options.json');
} catch (err) {
  console.log('❌ Failed to load /data/options.json:', err.message);
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

// Database connection
async function connectDB() {
  return await mysql.createConnection({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name
  });
}

// Test database connection
async function testDB() {
  try {
    const db = await connectDB();
    await db.execute('SELECT 1');
    await db.end();
    console.log('✅ Database connection test passed');
    return true;
  } catch (err) {
    console.log('❌ Database connection test failed:', err.message);
    return false;
  }
}

// Call Go binary to fetch data
async function callGoBinary() {
  return new Promise((resolve, reject) => {
    console.log('� Calling Go binary: tauron-reader');
    
    const goBinary = spawn('./tauron-reader', [], {
      cwd: '/app',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    goBinary.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('� Go stdout:', data.toString().trim());
    });
    
    goBinary.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('⚠️ Go stderr:', data.toString().trim());
    });
    
    goBinary.on('close', (code) => {
      console.log(`✅ Go binary exited with code ${code}`);
      
      if (code === 0) {
        resolve({ success: true, stdout, stderr });
      } else {
        reject(new Error(`Go binary failed with code ${code}: ${stderr}`));
      }
    });
    
    goBinary.on('error', (err) => {
      console.log('❌ Failed to start Go binary:', err.message);
      reject(err);
    });
  });
}

// Get energy statistics
async function getEnergyStats() {
  const db = await connectDB();
  
  try {
    // Get today's consumption and production
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
    
    // Get yesterday's data for comparison
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
    
    // Get latest record timestamp
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

// Main fetch function
async function fetchTauronData() {
  const startTime = Date.now();
  console.log('\n🚀 === Starting Tauron data fetch ===');
  
  try {
    console.log('🌐 Calling Go binary...');
    const result = await callGoBinary();
    
    const duration = Date.now() - startTime;
    console.log(`✅ === Fetch completed successfully in ${duration}ms ===\n`);
    logRun('success', 0, 'Go binary executed successfully');
    
  } catch (err) {
    const duration = Date.now() - startTime;
    console.log(`❌ === Fetch failed after ${duration}ms: ${err.message} ===\n`);
    logRun('error', 0, err.message);
  }
}

// Web interface
app.get('/', async (req, res) => {
  try {
    const stats = await getEnergyStats();
    
    res.send(`
      <html>
      <head>
        <title>Tauron Reader</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
          .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { text-align: center; margin-bottom: 30px; }
          .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
          .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; border-left: 4px solid #007bff; }
          .stat-value { font-size: 2em; font-weight: bold; color: #007bff; }
          .stat-label { color: #666; margin-top: 5px; }
          .controls { text-align: center; margin-bottom: 30px; }
          .btn { background: #007bff; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 16px; }
          .btn:hover { background: #0056b3; }
          .section { margin-bottom: 30px; }
          .section h3 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 5px; }
          .info { background: #e9ecef; padding: 15px; border-radius: 6px; }
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
          </div>
          
          <div class="section">
            <h3>📅 Harmonogram</h3>
            <div class="info">
              <ul>${config.schedule.times.map(time => `<li>${time}</li>`).join('')}</ul>
            </div>
          </div>
          
          <div class="section">
            <h3>📊 <a href="/api/runs">Ostatnie uruchomienia</a></h3>
            <h3>💾 <a href="/api/cache">Pliki cache</a></h3>
          </div>
        </div>
        
        <script>
          function runNow() {
            if (confirm('Czy na pewno chcesz uruchomić pobieranie danych?')) {
              fetch('/run-now').then(() => {
                alert('Rozpoczęto pobieranie danych! Odśwież stronę za kilka minut.');
                location.reload();
              });
            }
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
  await fetchTauronData();
});

app.get('/api/runs', (req, res) => {
  try {
    const logs = fs.readFileSync('/data/buffer/runs.log.jsonl', 'utf8')
      .trim().split('\n')
      .slice(-50)
      .map(line => JSON.parse(line))
      .reverse();
    res.json(logs);
  } catch (err) {
    res.json([]);
  }
});

// API endpoint to list cached files
app.get('/api/cache', (req, res) => {
  try {
    const cacheDir = '/share/tauron';
    if (!fs.existsSync(cacheDir)) {
      return res.json([]);
    }
    
    const files = fs.readdirSync(cacheDir)
      .filter(file => file.startsWith('tauron_') && file.endsWith('.json'))
      .map(file => {
        const filePath = path.join(cacheDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          created: stats.mtime.toISOString(),
          current: file === path.basename(getCurrentHourCacheFile())
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));
    
    res.json(files);
  } catch (err) {
    res.json([]);
  }
});

// Start server
async function start() {
  console.log('🎯 === Tauron Reader Addon v2.0.0 ===');
  console.log('📅 Startup time:', new Date().toISOString());
  console.log('🔧 Node.js version:', process.version);
  console.log('📁 Working directory:', process.cwd());
  console.log('🌐 Environment variables:', Object.keys(process.env).filter(k => k.includes('HASSIO')));
  
  // Test database
  const dbOk = await testDB();
  if (!dbOk) {
    console.log('❌ Exiting due to database connection failure');
    process.exit(1);
  }
  
  // Setup cron jobs
  console.log('⏰ Setting up scheduled tasks...');
  config.schedule.times.forEach(time => {
    console.log(`📅 Scheduling task at ${time}`);
    const [hour, minute] = time.split(':');
    cron.schedule(`${minute} ${hour} * * *`, fetchTauronData);
  });
  
  // Start web server
  const isIngress = process.env.HASSIO_TOKEN ? true : false;
  app.listen(PORT, () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
    if (isIngress) {
      console.log('🔗 Ingress mode: Available in Home Assistant sidebar');
    } else {
      console.log('🔗 Direct access: http://YOUR_HA_IP:${PORT}');
    }
    console.log('✅ === Addon ready ===\n');
    
    // Log initial run for verification
    console.log('🚀 Performing initial test run...');
    setTimeout(() => {
      fetchTauronData().then(() => {
        console.log('✅ Initial test run completed');
      }).catch(err => {
        console.log('⚠️ Initial test run failed:', err.message);
      });
    }, 5000); // Wait 5 seconds after startup
  });
}

start().catch(err => {
  console.error('💥 Startup failed:', err);
  process.exit(1);
});