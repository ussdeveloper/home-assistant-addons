const express = require('express');
const mysql = require('mysql2/promise');
const cron = require('node-cron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

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
    
    // On Windows, use WSL to run the Linux binary
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'wsl' : './tauron-reader';
    const spawnArgs = isWindows ? ['./tauron-reader', ...args] : args;
    
    const tauronReader = spawn(command, spawnArgs, {
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

// Test database connection and create table if needed
async function testDB() {
  try {
    // First test basic connection with tauron-reader
    await callTauronReader(['-test-db']);
    console.log('✅ Database connection test passed');

    // Now check if table exists and create it if needed
    const db = await connectDB();
    try {
      const tableName = config.database.table;

      // Check if table exists
      const [tables] = await db.execute(`
        SELECT TABLE_NAME
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      `, [config.database.name, tableName]);

      if (tables.length === 0) {
        console.log(`📋 Table '${tableName}' does not exist, creating it...`);

        // Create the table with the provided schema
        await db.execute(`
          CREATE TABLE \`${tableName}\` (
            \`Id\` int(11) NOT NULL AUTO_INCREMENT,
            \`ts\` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
            \`ts_real\` datetime DEFAULT NULL,
            \`ec\` double(11,3) unsigned DEFAULT NULL,
            \`oze\` double(11,3) unsigned DEFAULT NULL,
            \`temperatire_air\` double(11,3) DEFAULT NULL,
            \`temperature_comfort\` double(11,3) DEFAULT NULL,
            \`cloudiness\` double(11,3) unsigned DEFAULT NULL,
            \`windspeed\` double(11,3) DEFAULT NULL,
            \`windchill\` double(11,3) DEFAULT NULL,
            \`ab\` tinyint(1) unsigned DEFAULT 1,
            PRIMARY KEY (\`Id\`),
            UNIQUE KEY \`read_unique\` (\`ts_real\`)
          ) ENGINE=InnoDB AUTO_INCREMENT=665412 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci ROW_FORMAT=DYNAMIC
        `);

        console.log(`✅ Table '${tableName}' created successfully`);
      } else {
        console.log(`✅ Table '${tableName}' already exists`);

        // Check if we need to migrate old column names
        try {
          const [columns] = await db.execute(`
            SELECT COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME IN ('consumption', 'production')
          `, [config.database.name, tableName]);

          if (columns.length > 0) {
            console.log('🔄 Migrating old column names to new schema...');

            // Rename columns if they exist
            for (const col of columns) {
              if (col.COLUMN_NAME === 'consumption') {
                await db.execute(`ALTER TABLE \`${tableName}\` CHANGE \`consumption\` \`ec\` double(11,3) unsigned DEFAULT NULL`);
                console.log('✅ Renamed column: consumption → ec');
              } else if (col.COLUMN_NAME === 'production') {
                await db.execute(`ALTER TABLE \`${tableName}\` CHANGE \`production\` \`oze\` double(11,3) unsigned DEFAULT NULL`);
                console.log('✅ Renamed column: production → oze');
              }
            }
          }
        } catch (migrationErr) {
          console.log('⚠️ Column migration check failed:', migrationErr.message);
        }
      }

      return true;
    } finally {
      await db.end();
    }
  } catch (err) {
    console.log('❌ Database test failed:', err.message);
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
        SUM(ec) as total_consumption,
        SUM(oze) as total_production,
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
        SUM(ec) as total_consumption,
        SUM(oze) as total_production
      FROM ${config.database.table} 
      WHERE DATE(ts_real) = ?
    `, [yesterdayStr]);
    
    // Get this week's data
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    
    const [weekRows] = await db.execute(`
      SELECT 
        SUM(ec) as total_consumption,
        SUM(oze) as total_production
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
    
    // Determine tauron connection status based on last log
    const lastLog = logs.length > 0 ? logs[0] : null;
    const tauronStatus = lastLog && lastLog.status === 'success' ? 
      '<div class="status-value success">🟢 Aktywne</div>' : 
      '<div class="status-value error">🔴 Nieaktywne</div>';
    
    // Read HTML template
    let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    
    // Replace template placeholders
    html = html.replace('{{LOG_COUNT}}', logs.length);
    
    const logEntries = logs.map(log => `
      <div class="log-entry ${log.status === 'error' ? 'error' : ''}">
        <div class="log-time">${new Date(log.time).toLocaleString('pl-PL')}</div>
        <div class="log-message">${log.status === 'success' ? '✅' : '❌'} ${log.message}</div>
      </div>
    `).join('');
    html = html.replace('{{LOG_ENTRIES}}', logEntries);
    
    const emptyLogsMessage = logs.length === 0 ? '<div style="color: #8b949e; font-size: 12px; text-align: center; padding: 20px;">Brak logów</div>' : '';
    html = html.replace('{{EMPTY_LOGS_MESSAGE}}', emptyLogsMessage);
    
    html = html.replace('{{LATEST_UPDATE}}', stats.latestUpdate);
    html = html.replace('{{TODAY_CONSUMPTION}}', stats.today.consumption);
    html = html.replace('{{TODAY_PRODUCTION}}', stats.today.production);
    html = html.replace('{{WEEK_CONSUMPTION}}', stats.week.consumption);
    html = html.replace('{{WEEK_PRODUCTION}}', stats.week.production);
    html = html.replace('{{YESTERDAY_CONSUMPTION}}', stats.yesterday.consumption);
    html = html.replace('{{YESTERDAY_PRODUCTION}}', stats.yesterday.production);
    html = html.replace('{{TAURON_STATUS}}', tauronStatus);
    
    const scheduledTimes = config.schedule.times.map(time => `<span class="schedule-item">⏰ ${time}</span>`).join('');
    html = html.replace('{{SCHEDULED_TIMES}}', scheduledTimes);
    
    res.send(html);
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

    // Get year from query parameter, default to current year
    const selectedYear = parseInt(req.query.year) || new Date().getFullYear();

    // Get monthly totals for selected year - both production and consumption
    const [rows] = await db.execute(`
      SELECT
        MONTH(ts_real) as month,
        SUM(ec) / 1000 as total_consumption,
        SUM(oze) / 1000 as total_production
      FROM ${config.database.table}
      WHERE YEAR(ts_real) = ?
      GROUP BY month
      ORDER BY month ASC
    `, [selectedYear]);

    await db.end();

    const monthNames = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
    const labels = rows.map(r => monthNames[r.month - 1]);
    const consumption = rows.map(r => parseFloat(r.total_consumption || 0).toFixed(2));
    const production = rows.map(r => parseFloat(r.total_production || 0).toFixed(2));

    res.json({
      success: true,
      labels,
      consumption,
      production,
      year: selectedYear
    });
  } catch (err) {
    console.log('❌ Chart yearly data error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// API endpoint for 2 years comparison (production and consumption by months)
app.get('/api/chart-data-2years', async (req, res) => {
  try {
    const db = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name
    });

    const currentYear = new Date().getFullYear();
    const previousYear = currentYear - 1;

    // Get monthly totals for last 2 years
    const [rows] = await db.execute(`
      SELECT
        YEAR(ts_real) as year,
        MONTH(ts_real) as month,
        SUM(ec) / 1000 as total_consumption,
        SUM(oze) / 1000 as total_production
      FROM ${config.database.table}
      WHERE YEAR(ts_real) IN (?, ?)
      GROUP BY year, month
      ORDER BY year ASC, month ASC
    `, [previousYear, currentYear]);

    await db.end();

    // Create labels and data arrays
    const monthNames = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
    const labels = [];
    const consumption = [];
    const production = [];

    // Initialize arrays for both years
    for (let year = previousYear; year <= currentYear; year++) {
      for (let month = 1; month <= 12; month++) {
        const label = `${monthNames[month - 1]} ${year}`;
        labels.push(label);

        const row = rows.find(r => r.year === year && r.month === month);
        consumption.push(parseFloat((row?.total_consumption || 0)).toFixed(2));
        production.push(parseFloat((row?.total_production || 0)).toFixed(2));
      }
    }

    res.json({
      success: true,
      labels,
      consumption,
      production,
      years: [previousYear, currentYear]
    });
  } catch (err) {
    console.log('❌ Chart 2 years data error:', err.message);
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
  console.log('🎯 === Tauron Reader Addon v3.4.3 ===');
  console.log('📅 Startup time:', new Date().toISOString());
  console.log('🔧 Node.js version:', process.version);
  console.log('📁 Working directory:', process.cwd());
  
  // Test database
  const dbOk = await testDB();
  if (!dbOk) {
    console.log('❌ Exiting due to database connection failure');
    process.exit(1);
  }
  
  console.log('⏹️ Skipping Tauron service test to avoid rate limiting');
  
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
    console.log('ℹ️ Data fetch will run at scheduled times or via manual trigger from UI');
  });
}

start().catch(err => {
  console.error('💥 Startup failed:', err);
  process.exit(1);
});
