require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '+00:00',
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Historical price data ────────────────────────────────────────────────────
app.get('/api/history', async (req, res) => {
  const { days = '30', zip_code = '33129' } = req.query;
  const numDays = Math.min(Math.max(parseInt(days) || 30, 1), 3650);

  try {
    const [rows] = await pool.query(
      `SELECT fuel_type, min_price, avg_price, max_price, station_count, sampled_at
       FROM fuel_price_history
       WHERE zip_code = ?
         AND sampled_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY sampled_at ASC`,
      [zip_code, numDays]
    );
    res.json(rows);
  } catch (err) {
    console.error('DB error (history):', err.message);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// ── Latest DB entry per fuel type ────────────────────────────────────────────
app.get('/api/latest', async (req, res) => {
  const { zip_code = '33129' } = req.query;

  try {
    const [rows] = await pool.query(
      `SELECT h.*
       FROM fuel_price_history h
       INNER JOIN (
         SELECT fuel_type, MAX(sampled_at) AS latest
         FROM fuel_price_history
         WHERE zip_code = ?
         GROUP BY fuel_type
       ) l ON h.fuel_type = l.fuel_type AND h.sampled_at = l.latest
       WHERE h.zip_code = ?`,
      [zip_code, zip_code]
    );
    res.json(rows);
  } catch (err) {
    console.error('DB error (latest):', err.message);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// ── Period statistics ────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  const { days = '30', zip_code = '33129' } = req.query;
  const numDays = Math.min(Math.max(parseInt(days) || 30, 1), 3650);

  try {
    const [rows] = await pool.query(
      `SELECT fuel_type,
              MIN(min_price)  AS period_min,
              AVG(avg_price)  AS period_avg,
              MAX(max_price)  AS period_max,
              COUNT(*)        AS data_points,
              MIN(sampled_at) AS from_date,
              MAX(sampled_at) AS to_date
       FROM fuel_price_history
       WHERE zip_code = ?
         AND sampled_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY fuel_type`,
      [zip_code, numDays]
    );
    res.json(rows);
  } catch (err) {
    console.error('DB error (stats):', err.message);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// ── Proxy to external live-prices API ────────────────────────────────────────
app.get('/api/current', async (req, res) => {
  const apiBase = process.env.PRICES_API_URL;
  const apiPath = process.env.PRICES_API_PATH || '/prices';
  const paramZip = process.env.PRICES_API_PARAM_ZIP || 'zip_code';
  const paramRadius = process.env.PRICES_API_PARAM_RADIUS || 'radius_km';
  const { zip_code = '33129', radius_km = '5' } = req.query;

  if (!apiBase) {
    return res.status(503).json({ error: 'External API not configured (PRICES_API_URL missing)' });
  }

  try {
    const response = await axios.get(`${apiBase}${apiPath}`, {
      params: {
        [paramZip]: zip_code,
        [paramRadius]: parseInt(radius_km),
      },
      timeout: 6000,
    });
    res.json(response.data);
  } catch (err) {
    console.error('External API error:', err.message);
    res.status(502).json({ error: 'External API unavailable', detail: err.message });
  }
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

app.listen(PORT, () => {
  console.log(`Benzinpreise Dashboard running → http://localhost:${PORT}`);
});
