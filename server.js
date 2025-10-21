const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

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

console.log('📋 Config loaded:', {
  database: { host: config.database.host, user: config.database.user, name: config.database.name, table: config.database.table },
  tauron: { username: config.tauron.username },
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

// Login to Tauron
async function loginToTauron() {
  console.log('🔐 Logging into Tauron...');
  
  const jar = axios.create({
    withCredentials: true,
    timeout: 30000
  });

  try {
    // Initial GET
    await jar.get('https://elicznik.tauron-dystrybucja.pl/');
    
    // Login POST
    const loginResponse = await jar.post('https://logowanie.tauron-dystrybucja.pl/login', new URLSearchParams({
      username: config.tauron.username,
      password: config.tauron.password,
      service: 'https://elicznik.tauron-dystrybucja.pl'
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    console.log('✅ Tauron login successful');
    return jar;
  } catch (err) {
    console.log('❌ Tauron login failed:', err.message);
    throw err;
  }
}

// Fetch data from Tauron
async function fetchData(client) {
  console.log('📊 Fetching data from Tauron...');
  
  const now = new Date();
  const startDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
  
  const formatDate = (date) => {
    return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  
  const url = `https://elicznik.tauron-dystrybucja.pl/energia/do/dane?form[from]=${formatDate(startDate)}&form[to]=${formatDate(now)}&form[type]=godzin&form[energy][netto]=1&form[energy][netto_oze]=1&form[fileType]=CSV`;
  
  try {
    const response = await client.get(url, {
      headers: {
        'User-Agent': 'PostmanRuntime/7.29.2',
        'Accept': '*/*'
      }
    });
    
    console.log('✅ CSV data received, parsing...');
    
    // Parse CSV
    const records = parse(response.data, {
      delimiter: ';',
      skip_empty_lines: true
    });
    
    console.log(`📝 CSV has ${records.length} rows`);
    
    // Process data like in original code
    const headers = records[0].reduce((acc, header, index) => {
      acc[header.trim()] = index;
      return acc;
    }, {});
    
    const valueColumn = Object.keys(headers).find(key => 
      key.toLowerCase().includes('warto') && key.toLowerCase().includes('kwh')
    );
    
    if (!valueColumn) {
      throw new Error('Could not find value column in CSV');
    }
    
    console.log(`📊 Using value column: ${valueColumn}`);
    
    const data = [];
    
    // Process consumption records
    for (let i = 1; i < records.length; i++) {
      const row = records[i];
      const rodzaj = row[headers['Rodzaj']];
      
      if (rodzaj !== 'pobrana po zbilansowaniu') continue;
      
      const dataStr = row[headers['Data']];
      const wartoscStr = row[headers[valueColumn]];
      
      // Find matching production
      let production = 0;
      for (let j = 1; j < records.length; j++) {
        const prodRow = records[j];
        if (prodRow[headers['Rodzaj']] === 'oddana po zbilansowaniu' && 
            prodRow[headers['Data']] === dataStr) {
          const prodValue = parseFloat(prodRow[headers[valueColumn]].replace(',', '.')) || 0;
          production = Math.round(prodValue * 1000); // kWh to Wh
          break;
        }
      }
      
      const consumption = Math.round(parseFloat(wartoscStr.replace(',', '.')) * 1000); // kWh to Wh
      
      // Parse date and subtract 1 minute
      let date = new Date(dataStr.replace(' 24:00', ' 23:59'));
      if (dataStr.includes(' 24:00')) {
        date.setDate(date.getDate() + 1);
        date.setHours(0, 0, 0, 0);
      }
      date.setMinutes(date.getMinutes() - 1);
      
      data.push({
        date: date.toISOString().slice(0, 19).replace('T', ' '),
        consumption,
        production
      });
    }
    
    console.log(`✅ Processed ${data.length} energy records`);
    return data;
    
  } catch (err) {
    console.log('❌ Data fetch failed:', err.message);
    throw err;
  }
}

// Insert data to database
async function insertData(data) {
  console.log(`💾 Inserting ${data.length} records to database...`);
  
  const db = await connectDB();
  
  try {
    for (const item of data) {
      await db.execute(`
        INSERT INTO ${config.database.table} (
          ts_real, consumption, production,
          temperatire_air, temperature_comfort, cloudiness, windspeed, windchill
        ) VALUES (?, ?, ?, 0, 0, 0, 0, 0)
        ON DUPLICATE KEY UPDATE
          consumption = ?, production = ?,
          temperatire_air = 0, temperature_comfort = 0,
          cloudiness = 0, windspeed = 0, windchill = 0
      `, [item.date, item.consumption, item.production, item.consumption, item.production]);
    }
    
    console.log(`✅ Inserted ${data.length} records successfully`);
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
async function fetchTauronData() {
  const startTime = Date.now();
  console.log('\n🚀 === Starting Tauron data fetch ===');
  
  try {
    const client = await loginToTauron();
    const data = await fetchData(client);
    await insertData(data);
    
    const duration = Date.now() - startTime;
    console.log(`✅ === Fetch completed successfully in ${duration}ms ===\n`);
    logRun('success', data.length, 'automatic fetch');
    
  } catch (err) {
    const duration = Date.now() - startTime;
    console.log(`❌ === Fetch failed after ${duration}ms: ${err.message} ===\n`);
    logRun('error', 0, err.message);
  }
}

// Web interface
app.get('/', (req, res) => {
  res.send(`
    <html>
    <head><title>Tauron Reader</title></head>
    <body style="font-family: Arial, sans-serif; margin: 20px;">
      <h1>🔌 Tauron Reader Status</h1>
      <button onclick="runNow()" style="padding: 10px 20px; font-size: 16px;">▶️ Uruchom teraz</button>
      <br><br>
      <h3>📅 Harmonogram:</h3>
      <ul>${config.schedule.times.map(time => `<li>${time}</li>`).join('')}</ul>
      <h3>📊 <a href="/api/runs">Ostatnie uruchomienia</a></h3>
      <script>
        function runNow() {
          fetch('/run-now').then(() => alert('Rozpoczęto pobieranie danych!'));
        }
      </script>
    </body>
    </html>
  `);
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

// Start server
async function start() {
  console.log('🎯 === Tauron Reader Addon v1.2.0 ===');
  
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
  app.listen(PORT, () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
    console.log('✅ === Addon ready ===\n');
  });
}

start().catch(err => {
  console.error('💥 Startup failed:', err);
  process.exit(1);
});