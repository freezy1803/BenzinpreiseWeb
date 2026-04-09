'use strict';

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  days: 30,
  showDiesel: true,
  showSuper: true,
  history: [],       // all rows from /api/history
  rawDiesel: [],     // filtered diesel rows
  rawSuper: [],      // filtered supere5 rows
  chart: null,
  refreshTimer: null,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(val, decimals = 3) {
  if (val == null || val === '') return '–';
  return parseFloat(val).toFixed(decimals).replace('.', ',');
}

function fmtPrice(val) { return fmt(val, 3) + ' €'; }

function fmtDate(ts) {
  if (!ts) return '–';
  const d = new Date(ts);
  return d.toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDateShort(ts) {
  if (!ts) return '–';
  const d = new Date(ts);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function el(id) { return document.getElementById(id); }

function setBadge(status) {
  const badge = el('live-badge');
  const label = el('live-label');
  badge.className = 'badge';
  if (status === 'live') {
    badge.classList.add('badge--online');
    label.textContent = 'Live';
  } else if (status === 'db') {
    badge.classList.add('badge--online');
    label.textContent = 'DB';
  } else {
    badge.classList.add('badge--offline');
    label.textContent = 'Offline';
  }
}

// ── Current prices ────────────────────────────────────────────────────────────
async function loadCurrentPrices() {
  // Try live API (always via backend, never direct from client)
  try {
    const r = await fetch('/api/current?zip_code=33129&radius=5');
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        applyPriceCards(data, 'live');
        renderStations(data);
        return;
      }
    }
  } catch { /* fall through */ }

  // Fallback: latest from DB (no station detail available)
  try {
    const r = await fetch('/api/latest?zip_code=33129');
    if (r.ok) {
      const data = await r.json();
      applyPriceCards(data, 'db');
      hideStations();
    }
  } catch {
    setBadge('offline');
  }
}

function applyPriceCards(rows, source) {
  setBadge(source);

  const diesel = rows.find(r => r.fuel_type === 'diesel');
  const super5 = rows.find(r => r.fuel_type === 'supere5' || r.fuel_type === 'e5');

  if (diesel) {
    el('diesel-avg').textContent = fmt(diesel.avg_price, 3);
    el('diesel-min').textContent = fmtPrice(diesel.min_price);
    el('diesel-max').textContent = fmtPrice(diesel.max_price);
    el('diesel-stations').textContent = diesel.station_count ?? '–';
    el('diesel-time').textContent = diesel.sampled_at
      ? 'Stand: ' + fmtDate(diesel.sampled_at)
      : source === 'live' ? 'Live-Daten' : '';
    setTrend('diesel-trend', diesel.avg_price);
    if (diesel.stations?.length) setCheapestCard('diesel', diesel.stations);
    else el('diesel-cheapest').style.display = 'none';
  }
  if (super5) {
    el('super-avg').textContent = fmt(super5.avg_price, 3);
    el('super-min').textContent = fmtPrice(super5.min_price);
    el('super-max').textContent = fmtPrice(super5.max_price);
    el('super-stations').textContent = super5.station_count ?? '–';
    el('super-time').textContent = super5.sampled_at
      ? 'Stand: ' + fmtDate(super5.sampled_at)
      : source === 'live' ? 'Live-Daten' : '';
    setTrend('super-trend', super5.avg_price);
    if (super5.stations?.length) setCheapestCard('super', super5.stations);
    else el('super-cheapest').style.display = 'none';
  }

  el('last-updated').textContent = 'Aktualisiert: ' + new Date().toLocaleTimeString('de-DE');
}

// ── Stations breakdown ────────────────────────────────────────────────────────
let stationsVisible = true;

function renderStations(rows) {
  const section = el('stations-section');
  const diesel = rows.find(r => r.fuel_type === 'diesel');
  const super5 = rows.find(r => r.fuel_type === 'supere5');

  if (!diesel?.stations && !super5?.stations) { hideStations(); return; }

  section.style.display = 'block';
  el('stations-time').textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';

  if (diesel?.stations) {
    renderStationList('stations-diesel', diesel.stations);
    setCheapestCard('diesel', diesel.stations);
  }
  if (super5?.stations) {
    renderStationList('stations-super', super5.stations);
    setCheapestCard('super', super5.stations);
  }
}

function setCheapestCard(fuel, stations) {
  const sorted = [...stations].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  const cheapest = sorted[0];
  if (!cheapest) return;

  el(`${fuel}-cheapest`).style.display = 'flex';
  el(`${fuel}-cheapest-name`).textContent = cheapest.name ?? '';
  el(`${fuel}-cheapest-dist`).textContent = cheapest.distance ? cheapest.distance + ' entfernt' : '';
  el(`${fuel}-cheapest-price`).textContent = parseFloat(cheapest.price).toFixed(3).replace('.', ',') + ' €';
}

function renderStationList(containerId, stations) {
  // Sort by price ascending
  const sorted = [...stations].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  const minPrice = parseFloat(sorted[0]?.price);

  el(containerId).innerHTML = sorted.map((s, i) => {
    const price = parseFloat(s.price);
    const isCheapest = i === 0;
    // Clean up address: collapse multiple spaces
    const address = (s.address || '').replace(/\s{2,}/g, ' ').trim();
    return `
      <div class="station-row">
        <div>
          <div class="station-name">${escHtml(s.name)}</div>
          <div class="station-address">${escHtml(address)}</div>
          <div class="station-dist">${escHtml(s.distance)}</div>
        </div>
        <div class="station-right">
          <div class="station-price">${price.toFixed(3).replace('.', ',')}</div>
          ${isCheapest ? '<div class="station-cheapest">Günstigste</div>' : ''}
        </div>
      </div>`;
  }).join('');
}

function hideStations() {
  el('stations-section').style.display = 'none';
  el('diesel-cheapest').style.display = 'none';
  el('super-cheapest').style.display = 'none';
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setTrend(elId, currentAvg) {
  const el2 = el(elId);
  if (!currentAvg || state.history.length < 2) { el2.textContent = ''; return; }

  // Compare to last two DB entries for this fuel type
  const fuelKey = elId.includes('diesel') ? 'diesel' : 'supere5';
  const relevant = state.history.filter(r => r.fuel_type === fuelKey);
  if (relevant.length < 2) { el2.textContent = ''; return; }

  const prev = parseFloat(relevant[relevant.length - 2].avg_price);
  const curr = parseFloat(currentAvg);
  const diff = curr - prev;

  if (Math.abs(diff) < 0.001) {
    el2.className = 'card-trend trend-flat';
    el2.textContent = '→ ±0,000';
  } else if (diff > 0) {
    el2.className = 'card-trend trend-up';
    el2.textContent = '↑ +' + fmt(diff, 3);
  } else {
    el2.className = 'card-trend trend-down';
    el2.textContent = '↓ ' + fmt(diff, 3);
  }
}

// ── History ───────────────────────────────────────────────────────────────────
async function loadHistory() {
  el('chart-loading').style.display = 'flex';
  try {
    const r = await fetch(`/api/history?days=${state.days}&zip_code=33129`);
    if (!r.ok) throw new Error('history fetch failed');
    state.history = await r.json();
    state.rawDiesel = state.history.filter(r => r.fuel_type === 'diesel');
    state.rawSuper  = state.history.filter(r => r.fuel_type === 'supere5');
    renderChart();
    renderTable();
  } catch (e) {
    console.error(e);
  } finally {
    el('chart-loading').style.display = 'none';
  }
}

async function loadStats() {
  try {
    const r = await fetch(`/api/stats?days=${state.days}&zip_code=33129`);
    if (!r.ok) return;
    const data = await r.json();
    const diesel = data.find(d => d.fuel_type === 'diesel');
    const super5 = data.find(d => d.fuel_type === 'supere5');

    if (diesel) {
      el('st-diesel-min').textContent = fmt(diesel.period_min, 3);
      el('st-diesel-avg').textContent = fmt(diesel.period_avg, 3);
      el('st-diesel-max').textContent = fmt(diesel.period_max, 3);
      el('st-diesel-pts').textContent = diesel.data_points;
    }
    if (super5) {
      el('st-super-min').textContent = fmt(super5.period_min, 3);
      el('st-super-avg').textContent = fmt(super5.period_avg, 3);
      el('st-super-max').textContent = fmt(super5.period_max, 3);
      el('st-super-pts').textContent = super5.data_points;
    }

    // Update stats period label
    const labels = { 1:'24 Stunden', 7:'7 Tage', 30:'30 Tage', 90:'3 Monate', 365:'1 Jahr' };
    el('stats-period').textContent = labels[state.days] || `${state.days} Tage`;
  } catch (e) {
    console.error(e);
  }
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function makeGradient(ctx, color) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0,   color + '50');
  gradient.addColorStop(0.6, color + '10');
  gradient.addColorStop(1,   color + '00');
  return gradient;
}

function toChartData(rows, field) {
  return rows.map(r => ({
    x: new Date(r.sampled_at),
    y: parseFloat(r[field]),
  }));
}

function renderChart() {
  const canvas = el('priceChart');
  const ctx = canvas.getContext('2d');

  const dieselColor = '#f5a623';
  const superColor  = '#3fb950';

  const datasets = [];

  if (state.showDiesel && state.rawDiesel.length) {
    datasets.push({
      label: 'Diesel',
      data: toChartData(state.rawDiesel, 'avg_price'),
      borderColor: dieselColor,
      backgroundColor: makeGradient(ctx, dieselColor),
      borderWidth: 2,
      pointRadius: state.rawDiesel.length > 80 ? 0 : 3,
      pointHoverRadius: 6,
      pointBackgroundColor: dieselColor,
      pointBorderColor: '#0d1117',
      pointBorderWidth: 2,
      fill: true,
      tension: 0.35,
      // Store raw rows for click detail
      _rawRows: state.rawDiesel,
    });
  }

  if (state.showSuper && state.rawSuper.length) {
    datasets.push({
      label: 'Super E5',
      data: toChartData(state.rawSuper, 'avg_price'),
      borderColor: superColor,
      backgroundColor: makeGradient(ctx, superColor),
      borderWidth: 2,
      pointRadius: state.rawSuper.length > 80 ? 0 : 3,
      pointHoverRadius: 6,
      pointBackgroundColor: superColor,
      pointBorderColor: '#0d1117',
      pointBorderWidth: 2,
      fill: true,
      tension: 0.35,
      _rawRows: state.rawSuper,
    });
  }

  const timeUnit = state.days <= 2 ? 'hour' : state.days <= 14 ? 'day' : state.days <= 90 ? 'week' : 'month';

  if (state.chart) {
    state.chart.data.datasets = datasets;
    state.chart.options.scales.x.time.unit = timeUnit;
    state.chart.update('active');
    return;
  }

  state.chart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      onClick(_evt, elements) {
        if (!elements.length) return;
        const el0 = elements[0];
        const ds = state.chart.data.datasets[el0.datasetIndex];
        const idx = el0.index;
        const raw = ds._rawRows;
        if (!raw) return;

        // Build close-index data for both fuels at that timestamp
        const clickedTs = new Date(ds.data[idx].x).getTime();
        const dRow = findClosest(state.rawDiesel, clickedTs);
        const sRow = findClosest(state.rawSuper,  clickedTs);
        showSpanInfo(dRow, sRow);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#161b22',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#7d8590',
          bodyColor: '#e6edf3',
          titleFont: { size: 11, weight: '600' },
          bodyFont: { size: 12, weight: '700' },
          padding: 10,
          callbacks: {
            title(items) {
              const d = new Date(items[0].parsed.x);
              return d.toLocaleDateString('de-DE', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              });
            },
            label(item) {
              return ` ${item.dataset.label}: ${item.parsed.y.toFixed(3).replace('.', ',')} €/L`;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: timeUnit, displayFormats: {
            hour:  'HH:mm',
            day:   'dd.MM.',
            week:  'dd.MM.',
            month: 'MMM yy',
          }},
          grid: { color: '#21262d', drawBorder: false },
          ticks: { color: '#7d8590', font: { size: 11 }, maxTicksLimit: 8 },
        },
        y: {
          grid: { color: '#21262d', drawBorder: false },
          ticks: {
            color: '#7d8590',
            font: { size: 11 },
            callback: v => v.toFixed(3).replace('.', ',') + ' €',
          },
        },
      },
    },
  });
}

function findClosest(rows, targetTs) {
  if (!rows || !rows.length) return null;
  return rows.reduce((best, r) => {
    const diff = Math.abs(new Date(r.sampled_at).getTime() - targetTs);
    const bestDiff = Math.abs(new Date(best.sampled_at).getTime() - targetTs);
    return diff < bestDiff ? r : best;
  });
}

function showSpanInfo(dRow, sRow) {
  const section = el('span-section');
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  if (dRow) {
    el('sp-diesel-time').textContent = fmtDate(dRow.sampled_at);
    el('sp-diesel-min').textContent  = fmtPrice(dRow.min_price);
    el('sp-diesel-avg').textContent  = fmtPrice(dRow.avg_price);
    el('sp-diesel-max').textContent  = fmtPrice(dRow.max_price);
    el('sp-diesel-sta').textContent  = dRow.station_count ?? '–';
  }
  if (sRow) {
    el('sp-super-time').textContent = fmtDate(sRow.sampled_at);
    el('sp-super-min').textContent  = fmtPrice(sRow.min_price);
    el('sp-super-avg').textContent  = fmtPrice(sRow.avg_price);
    el('sp-super-max').textContent  = fmtPrice(sRow.max_price);
    el('sp-super-sta').textContent  = sRow.station_count ?? '–';
  }
}

// ── Table ─────────────────────────────────────────────────────────────────────
let tableExpanded = false;

function renderTable() {
  const tbody = el('data-tbody');
  const empty = el('table-empty');
  const rows = [...state.history].reverse(); // newest first

  if (!rows.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const limit = tableExpanded ? rows.length : 20;
  const visible = rows.slice(0, limit);

  tbody.innerHTML = visible.map(r => {
    const isD = r.fuel_type === 'diesel';
    const pillClass = isD ? 'fuel-pill--diesel' : 'fuel-pill--super';
    const pillLabel = isD ? 'Diesel' : 'Super E5';
    return `
      <tr>
        <td>${fmtDate(r.sampled_at)}</td>
        <td><span class="fuel-pill ${pillClass}">${pillLabel}</span></td>
        <td>${fmt(r.min_price, 3)}</td>
        <td>${fmt(r.avg_price, 3)}</td>
        <td>${fmt(r.max_price, 3)}</td>
        <td>${r.station_count}</td>
      </tr>
    `;
  }).join('');

  el('table-toggle').textContent = tableExpanded
    ? 'Weniger anzeigen'
    : `Alle ${rows.length} anzeigen`;
}

// ── Event handlers ────────────────────────────────────────────────────────────
function initControls() {
  // Time range buttons
  el('time-btns').addEventListener('click', e => {
    const btn = e.target.closest('.time-btn');
    if (!btn) return;
    el('time-btns').querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.days = parseInt(btn.dataset.days);
    loadHistory();
    loadStats();
  });

  // Fuel toggle buttons
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fuel = btn.dataset.fuel;
      btn.classList.toggle('active');
      if (fuel === 'diesel') state.showDiesel = btn.classList.contains('active');
      else                    state.showSuper  = btn.classList.contains('active');
      renderChart();
    });
  });

  // Stations collapse
  el('stations-toggle-btn').addEventListener('click', () => {
    stationsVisible = !stationsVisible;
    el('stations-grid').style.display = stationsVisible ? '' : 'none';
    el('stations-toggle-btn').textContent = stationsVisible ? 'Einklappen' : 'Ausklappen';
  });

  // Table expand
  el('table-toggle').addEventListener('click', () => {
    tableExpanded = !tableExpanded;
    renderTable();
  });
}

// ── Auto refresh ──────────────────────────────────────────────────────────────
function startAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    loadCurrentPrices();
    loadHistory();
    loadStats();
  }, 5 * 60 * 1000); // every 5 minutes
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  initControls();
  await loadHistory();
  await Promise.all([loadCurrentPrices(), loadStats()]);
  startAutoRefresh();
}

document.addEventListener('DOMContentLoaded', init);
