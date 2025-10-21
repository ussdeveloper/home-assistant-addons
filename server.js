const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

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

// Login to Tauron
async function loginToTauron() {
  console.log('🔐 Logging into Tauron...');
  console.log('👤 Username:', config.tauron.username);
  console.log('🔑 Password:', maskPassword(config.tauron.password));
  
  // Create axios instance with manual redirect handling like Go version
  const jar = axios.create({
    timeout: 30000,
    maxRedirects: 0, // Handle redirects manually like Go version
    validateStatus: function (status) {
      return status >= 200 && status < 400; // Accept all success/redirect codes
    },
    withCredentials: true
  });

  try {
    console.log('📄 Step 1: Getting initial page for cookies...');
    // Initial GET to get cookies
    const initialResponse = await jar.get('https://elicznik.tauron-dystrybucja.pl/');
    console.log('✅ Initial page loaded, status:', initialResponse.status);
    
    // Extract cookies from initial request
    const cookies = initialResponse.headers['set-cookie'] || [];
    console.log('🍪 Received cookies:', cookies.length);
    
    console.log('🔐 Step 2: Sending login credentials...');
    // Login POST with exact headers from Go version
    const loginData = new URLSearchParams({
      username: config.tauron.username,
      password: config.tauron.password,
      service: 'https://elicznik.tauron-dystrybucja.pl'
    });
    
    try {
      const loginResponse = await jar.post('https://logowanie.tauron-dystrybucja.pl/login', loginData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.82 Safari/537.36',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Cookie': cookies.join('; ')
        },
        maxRedirects: 2 // Allow max 2 redirects like Go version
      });
      
      console.log('📥 Login response status:', loginResponse.status);
      console.log('✅ Tauron login successful');
      
      // Return axios instance for data fetching
      return jar;
      
    } catch (redirectErr) {
      // Handle redirect manually if needed
      if (redirectErr.response && (redirectErr.response.status === 302 || redirectErr.response.status === 301)) {
        console.log('🔀 Handling redirect, status:', redirectErr.response.status);
        console.log('✅ Login redirect received - likely successful');
        return jar;
      }
      throw redirectErr;
    }
    
  } catch (err) {
    console.log('❌ Tauron login failed:', err.message);
    if (err.response) {
      console.log('📄 Response status:', err.response.status);
      console.log('� Response headers:', Object.keys(err.response.headers));
    }
    throw err;
  }
}

// Fetch data from Tauron - EXACTLY like Node-RED "0406b8c182c9830e" (SetRangeOze) + "c7b230a49ff7924e" (http request)
async function fetchData(client) {
  console.log('📊 Fetching data from Tauron (Node-RED method)...');
  
  // Use same date format as Node-RED (DD.MM.YYYY)
  const now = new Date();
  const startDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
  
  const formatDate = (date) => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  };
  
  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(now);
  
  // URL encode parameters EXACTLY like Node-RED: form%5Bfrom%5D=...
  // Node-RED "SetRangeOze" function builds this URL
  const url = `https://elicznik.tauron-dystrybucja.pl/energia/do/dane?form%5Bfrom%5D=${startDateStr}&form%5Bto%5D=${endDateStr}&form%5Btype%5D=godzin&form%5Benergy%5D%5Bnetto%5D=1&form%5Benergy%5D%5Bnetto_oze%5D=1&form%5BfileType%5D=CSV`;
  
  console.log('📅 Date range:', startDateStr, 'to', endDateStr);
  console.log('🔗 Data URL:', url);
  
  try {
    // Node-RED "Prepare Header" (3b88dce006e1c634) uses followRedirects=false and specific headers
    const response = await client.get(url, {
      headers: {
        'User-Agent': 'PostmanRuntime/7.29.2',
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Connection': 'keep-alive',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      maxRedirects: 0, // followRedirects=false like Node-RED "Prepare Header"
      validateStatus: function (status) {
        return status >= 200 && status < 400;
      }
    });
    
    console.log('✅ CSV data received, status:', response.status);
    
    // If we got 302, we're not logged in properly
    if (response.status === 302 || response.status === 301) {
      const redirectTo = response.headers.location;
      console.log('❌ Got redirect instead of CSV data, redirecting to:', redirectTo);
      throw new Error('Not authenticated - redirected instead of getting CSV data');
    }
    
    console.log('📊 Data length:', response.data.length, 'characters');
    console.log('📄 First 200 chars:', response.data.substring(0, 200));
    
    // Save raw data for debugging
    const rawFile = saveRawData(response.data, 'csv');
    
    // Check if response is actually CSV or HTML error page
    if (response.data.includes('<html') || response.data.includes('<!DOCTYPE')) {
      console.log('❌ Received HTML instead of CSV - authentication failed');
      console.log('🔍 This means we are not properly logged in');
      console.log('🔍 Raw data saved to:', rawFile);
      
      // Try to extract useful info from HTML
      const titleMatch = response.data.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) {
        console.log('📄 HTML page title:', titleMatch[1]);
      }
      
      throw new Error('Authentication failed - redirected to login page instead of getting CSV data');
    }
    
    // Check if response looks like CSV
    if (!response.data.includes(';') && !response.data.includes('Data')) {
      console.log('❌ Response does not look like CSV data');
      console.log('🔍 Raw data saved to:', rawFile);
      throw new Error('Response does not appear to be CSV format');
    };

    // Parse CSV
    const records = parse(response.data, {
      delimiter: ';',
      skip_empty_lines: true
    });
    
    console.log(`📝 CSV has ${records.length} rows`);    // Process data like in original code
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
  console.log('🎯 === Tauron Reader Addon v1.4.1 ===');
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