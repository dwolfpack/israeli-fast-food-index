const TEL_AVIV_CENTER = { lat: 32.0809, lng: 34.7806 };
const STORAGE_KEY = 'iffi_history_v3';
const BASELINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const BOOTSTRAP_STEP_MS = 3 * 60 * 60 * 1000;
const AUTO_POLL_MINUTES = 15;
const MAX_BUSINESSES = 30;
const SEARCH_RADIUS_METERS = 1400;

const GOOGLE_MAPS_API_KEY = '';

const DEMO_BUSINESSES = [
  { place_id: 'demo_1', name: 'Dizengoff Burger', geometry: { location: { lat: 32.0858, lng: 34.7818 } }, rating: 4.2, user_ratings_total: 650 },
  { place_id: 'demo_2', name: 'Allenby Falafel Hub', geometry: { location: { lat: 32.0707, lng: 34.7732 } }, rating: 4.5, user_ratings_total: 410 },
  { place_id: 'demo_3', name: 'Rothschild Sabich', geometry: { location: { lat: 32.0643, lng: 34.7766 } }, rating: 4.4, user_ratings_total: 532 },
  { place_id: 'demo_4', name: 'Ibn Gabirol Shawarma', geometry: { location: { lat: 32.0912, lng: 34.7811 } }, rating: 4.1, user_ratings_total: 295 },
  { place_id: 'demo_5', name: 'Carmel Chicken Stop', geometry: { location: { lat: 32.0696, lng: 34.7694 } }, rating: 4.0, user_ratings_total: 180 },
  { place_id: 'demo_6', name: 'Florentin Slice Bar', geometry: { location: { lat: 32.0558, lng: 34.7715 } }, rating: 4.3, user_ratings_total: 260 },
  { place_id: 'demo_7', name: 'Azrieli Noodle Express', geometry: { location: { lat: 32.0742, lng: 34.7925 } }, rating: 3.9, user_ratings_total: 322 },
  { place_id: 'demo_8', name: 'King George Wraps', geometry: { location: { lat: 32.0736, lng: 34.7771 } }, rating: 4.2, user_ratings_total: 487 },
  { place_id: 'demo_9', name: 'Port Pita Station', geometry: { location: { lat: 32.0974, lng: 34.7737 } }, rating: 4.1, user_ratings_total: 378 },
  { place_id: 'demo_10', name: 'Sarona Grill Box', geometry: { location: { lat: 32.0718, lng: 34.7878 } }, rating: 4.3, user_ratings_total: 440 },
  { place_id: 'demo_11', name: 'Yehuda Halevi Toast', geometry: { location: { lat: 32.0623, lng: 34.7768 } }, rating: 3.8, user_ratings_total: 150 },
  { place_id: 'demo_12', name: 'TLV Taco Counter', geometry: { location: { lat: 32.0812, lng: 34.7689 } }, rating: 4.5, user_ratings_total: 505 }
];

const state = {
  placesService: null,
  history: loadHistory(),
  usingDemoFallback: false,
  pollingTimer: null,
  lastResult: null,
  consecutiveAlerts: 0,
};

const ui = {
  error: document.getElementById('error'),
  scoreValue: document.getElementById('scoreValue'),
  scoreStatus: document.getElementById('scoreStatus'),
  whyNow: document.getElementById('whyNow'),
  confidenceValue: document.getElementById('confidenceValue'),
  confidenceBar: document.getElementById('confidenceBar'),
  confidenceReason: document.getElementById('confidenceReason'),
  archetypeValue: document.getElementById('archetypeValue'),
  archetypeHint: document.getElementById('archetypeHint'),
  sourceMode: document.getElementById('sourceMode'),
  sourceHealth: document.getElementById('sourceHealth'),
  zoneCards: document.getElementById('zoneCards'),
  anomalyTable: document.getElementById('anomalyTable'),
  comparisonTable: document.getElementById('comparisonTable'),
  signatureChart: document.getElementById('signatureChart'),
  timeline: document.getElementById('timeline'),
  backtestHours: document.getElementById('backtestHours'),
  runBacktestBtn: document.getElementById('runBacktestBtn'),
  shareBtn: document.getElementById('shareBtn'),
  backtestSummary: document.getElementById('backtestSummary'),
  backtestTable: document.getElementById('backtestTable'),
};

init();

async function init() {
  ui.runBacktestBtn.addEventListener('click', () => runBacktest());
  ui.shareBtn.addEventListener('click', exportSnapshotCard);

  pruneHistoryToLastWeek(Date.now());
  renderTimeline();
  renderSignatureChart();
  runBacktest();

  await connectPlacesFromConfig();
  await collectSnapshot();
  state.pollingTimer = setInterval(collectSnapshot, AUTO_POLL_MINUTES * 60 * 1000);
}

async function connectPlacesFromConfig() {
  const key = GOOGLE_MAPS_API_KEY.trim();
  if (!key) {
    state.usingDemoFallback = true;
    return;
  }

  try {
    await loadGoogleMapsScript(key);
    state.placesService = new google.maps.places.PlacesService(document.createElement('div'));
    state.usingDemoFallback = false;
  } catch (err) {
    state.usingDemoFallback = true;
    showError(`Places connection failed, demo data active. ${err.message}`);
  }
}

function loadGoogleMapsScript(key) {
  if (window.google?.maps?.places) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const callbackName = '__iffiPlacesInit';
    window[callbackName] = () => {
      resolve();
      delete window[callbackName];
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Google script could not load.'));
    document.head.appendChild(script);
  });
}

async function collectSnapshot() {
  try {
    hideError();
    const businesses = await fetchBusinesses();
    if (!businesses.length) throw new Error('No businesses available for this snapshot.');

    ensureLastWeekHistory(businesses);
    const result = buildSnapshot(businesses);

    state.history.city.push(result.citySnapshot);
    for (const business of result.businessSnapshots) {
      if (!state.history.businesses[business.place_id]) state.history.businesses[business.place_id] = [];
      state.history.businesses[business.place_id].push(business.historyPoint);
    }

    pruneHistoryToLastWeek(result.citySnapshot.ts);
    saveHistory(state.history);

    state.lastResult = result;
    renderSnapshot(result);
    renderTimeline();
    renderSignatureChart();
    runBacktest();
  } catch (err) {
    showError(err.message);
  }
}

async function fetchBusinesses() {
  if (!state.placesService) {
    state.usingDemoFallback = true;
    return DEMO_BUSINESSES.slice(0, MAX_BUSINESSES).map((p) => ({ ...p }));
  }

  const request = {
    location: TEL_AVIV_CENTER,
    radius: SEARCH_RADIUS_METERS,
    keyword: 'fast food',
    type: 'restaurant',
  };

  return new Promise((resolve) => {
    const collected = [];
    const callback = (results, status, pagination) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !results) {
        if (!collected.length) {
          state.usingDemoFallback = true;
          resolve(DEMO_BUSINESSES.slice(0, MAX_BUSINESSES).map((p) => ({ ...p })));
          showError('Google Places unavailable, switched to demo panel.');
        } else {
          state.usingDemoFallback = false;
          resolve(collected.slice(0, MAX_BUSINESSES));
        }
        return;
      }

      for (const place of results) {
        const isFastFood = Array.isArray(place.types) && (place.types.includes('meal_takeaway') || place.types.includes('restaurant'));
        if (!isFastFood) continue;
        collected.push(place);
        if (collected.length >= MAX_BUSINESSES) {
          state.usingDemoFallback = false;
          resolve(collected.slice(0, MAX_BUSINESSES));
          return;
        }
      }

      if (pagination && pagination.hasNextPage && collected.length < MAX_BUSINESSES) {
        setTimeout(() => pagination.nextPage(), 1500);
      } else {
        state.usingDemoFallback = false;
        resolve(collected.slice(0, MAX_BUSINESSES));
      }
    };

    state.placesService.nearbySearch(request, callback);
  });
}

function buildSnapshot(businesses) {
  const now = Date.now();
  const keys = bucketKeys(now);

  const businessSnapshots = businesses.map((place) => {
    const id = place.place_id || place.id || place.name;
    const prevHistory = state.history.businesses[id] || [];
    const latest = prevHistory[prevHistory.length - 1];

    const ratingTotal = Number(place.user_ratings_total || 0);
    const rating = Number(place.rating || 3.8);
    const openNow = Boolean(place.opening_hours?.open_now);
    const lat = place.geometry?.location?.lat?.() ?? place.geometry?.location?.lat ?? TEL_AVIV_CENTER.lat;
    const lng = place.geometry?.location?.lng?.() ?? place.geometry?.location?.lng ?? TEL_AVIV_CENTER.lng;

    const elapsedHours = latest ? Math.max((now - latest.ts) / (1000 * 60 * 60), 0.03) : 1;
    let reviewVelocity = latest ? (ratingTotal - latest.ratingTotal) / elapsedHours : 0;
    if (state.usingDemoFallback) reviewVelocity += randomBetween(0, 1.3);

    const hourTemplate = templateExpected(keys.hour, keys.dow);
    const openComponent = openNow ? 18 : 5;
    const ratingComponent = clamp(rating * 8.5, 18, 42);
    const crowdComponent = clamp(Math.log10(ratingTotal + 10) * 14, 8, 44);
    const velocityComponent = clamp(reviewVelocity * 11, 0, 24);
    const noise = randomBetween(-4.2, 4.2);

    const proxyLoad = clamp(hourTemplate * 0.34 + openComponent + ratingComponent * 0.24 + crowdComponent * 0.22 + velocityComponent + noise, 0, 100);
    const baseline = computeBusinessBaseline(prevHistory, keys, hourTemplate, now);
    const z = (proxyLoad - baseline.expected) / baseline.scale;

    const deltaPrev = latest ? proxyLoad - latest.proxyLoad : 0;
    const deltaPrevPct = latest ? (deltaPrev / Math.max(latest.proxyLoad, 1)) * 100 : 0;
    const deltaWeekly = proxyLoad - baseline.expected;

    let signal = 'Normal';
    if (z >= 3.2) signal = 'Extreme surge';
    else if (z >= 2.2) signal = 'Strong surge';
    else if (z >= 1.5) signal = 'Elevated';

    return {
      place_id: id,
      name: place.name || 'Unnamed',
      lat,
      lng,
      zone: zoneFor(lat, lng),
      proxyLoad: round1(proxyLoad),
      zScore: round2(z),
      signal,
      deltaPrev: round1(deltaPrev),
      deltaPrevPct: round1(deltaPrevPct),
      deltaWeekly: round1(deltaWeekly),
      historyPoint: {
        ts: now,
        dow: keys.dow,
        hour: keys.hour,
        proxyLoad: round1(proxyLoad),
        ratingTotal,
        openNow,
      },
    };
  });

  const cityPressure = avg(businessSnapshots.map((b) => b.proxyLoad));
  const anomalousShare = businessSnapshots.filter((b) => b.zScore >= 1.5).length / businessSnapshots.length;
  const cityBase = computeCityBaseline(state.history.city, keys, templateExpected(keys.hour, keys.dow), now);
  const cityZ = (cityPressure - cityBase.expected) / cityBase.scale;
  const score = clamp(cityPressure * 0.42 + sigmoid(Math.max(0, cityZ)) * 34 + anomalousShare * 24, 0, 100);

  const alertCandidate = score >= 76 && anomalousShare >= 0.25 && cityZ >= 1;
  state.consecutiveAlerts = alertCandidate ? state.consecutiveAlerts + 1 : 0;

  const citySnapshot = {
    ts: now,
    dow: keys.dow,
    hour: keys.hour,
    score: round1(score),
    cityPressure: round1(cityPressure),
    anomalousShare: round2(anomalousShare),
    cityZ: round2(cityZ),
    businessCount: businessSnapshots.length,
    alerted: state.consecutiveAlerts >= 2,
  };

  businessSnapshots.sort((a, b) => b.zScore - a.zScore);
  return { citySnapshot, businessSnapshots };
}

function renderSnapshot(result) {
  const city = result.citySnapshot;
  const confidence = calculateConfidence(result);
  const archetype = inferArchetype(result);

  ui.scoreValue.textContent = `${Math.round(city.score)}`;
  ui.scoreStatus.textContent = `${statusLabel(city)} | z=${city.cityZ.toFixed(2)} | updated ${new Date(city.ts).toLocaleTimeString()}`;
  ui.whyNow.textContent = `Why now: ${whyNowText(result)}`;

  ui.confidenceValue.textContent = `${confidence.value}%`;
  ui.confidenceBar.style.width = `${confidence.value}%`;
  ui.confidenceReason.textContent = confidence.reason;

  ui.archetypeValue.textContent = archetype.label;
  ui.archetypeHint.textContent = archetype.hint;

  ui.sourceMode.textContent = state.usingDemoFallback ? 'Demo Source' : 'Live Places';
  ui.sourceHealth.textContent = `Polling every ${AUTO_POLL_MINUTES}m | panel ${city.businessCount}/${MAX_BUSINESSES} | weekly points ${state.history.city.length}`;

  renderZoneCards(result.businessSnapshots);

  ui.anomalyTable.innerHTML = result.businessSnapshots.slice(0, 10).map((b) => `
    <tr>
      <td>${escapeHtml(b.name)}</td>
      <td>${b.proxyLoad.toFixed(1)}</td>
      <td>${b.zScore.toFixed(2)}</td>
      <td>${b.signal}</td>
    </tr>
  `).join('');

  ui.comparisonTable.innerHTML = [...result.businessSnapshots]
    .sort((a, b) => Math.abs(b.deltaWeekly) - Math.abs(a.deltaWeekly))
    .slice(0, 10)
    .map((b) => `
      <tr>
        <td>${escapeHtml(b.name)}</td>
        <td>${b.proxyLoad.toFixed(1)}</td>
        <td>${signed(b.deltaPrev)} (${signed(b.deltaPrevPct)}%)</td>
        <td>${signed(b.deltaWeekly)}</td>
      </tr>
    `)
    .join('');
}

function statusLabel(city) {
  if (city.alerted) return 'ALERT: sustained anomaly';
  if (city.score >= 85) return 'High likelihood: major event';
  if (city.score >= 72) return 'Rising anomaly pressure';
  if (city.score >= 58) return 'Mildly elevated';
  return 'Calm baseline';
}

function whyNowText(result) {
  const top = result.businessSnapshots.slice(0, 3).map((b) => `${shortName(b.name)} ${signed(b.deltaWeekly)}`);
  return `${Math.round(result.citySnapshot.anomalousShare * 100)}% counters elevated; main drivers: ${top.join(', ')}.`;
}

function renderZoneCards(businesses) {
  const zones = ['NW', 'NE', 'SW', 'SE'];
  const stats = zones.map((zone) => {
    const rows = businesses.filter((b) => b.zone === zone);
    const pressure = rows.length ? avg(rows.map((r) => r.proxyLoad)) : 0;
    const rush = rows.length ? rows.filter((r) => r.zScore >= 1.5).length / rows.length : 0;
    return { zone, pressure, rush, size: rows.length };
  });

  ui.zoneCards.innerHTML = stats.map((z) => `
    <article class="zone-card ${z.pressure >= 70 ? 'hot' : ''}">
      <p class="metric-label">${z.zone}</p>
      <p class="zone-value">${z.pressure.toFixed(1)}</p>
      <p class="hint">Rush ${Math.round(z.rush * 100)}% | ${z.size} counters</p>
    </article>
  `).join('');
}

function calculateConfidence(result) {
  const city = result.citySnapshot;
  const sameHourPoints = state.history.city.filter((h) => h.hour === city.hour).length;
  let score = 35;
  score += Math.min(20, result.businessSnapshots.length * 0.6);
  score += Math.min(25, sameHourPoints * 1.2);
  score += state.usingDemoFallback ? -20 : 12;
  score += city.cityZ > 1 ? 6 : 0;
  score = clamp(score, 20, 98);

  const reason = state.usingDemoFallback
    ? 'Demo source lowers confidence; still useful for pattern testing.'
    : 'Live Places data with weekly baseline coverage.';

  return { value: Math.round(score), reason };
}

function inferArchetype(result) {
  const hour = result.citySnapshot.hour;
  const zoneDominance = dominantZone(result.businessSnapshots);

  if (hour >= 22 || hour <= 2) return { label: 'Nightlife surge', hint: 'Late-hour pressure is above typical pattern.' };
  if (hour >= 7 && hour <= 10) return { label: 'Commute spike', hint: 'Morning counters rising around transit windows.' };
  if (hour >= 11 && hour <= 14) return { label: 'Lunch crunch', hint: 'Midday demand concentration above weekly baseline.' };
  if (zoneDominance.share >= 0.45) return { label: 'Localized zone event', hint: `${zoneDominance.zone} drives most anomalous counters.` };
  return { label: 'Distributed urban pulse', hint: 'Signal spread across multiple zones.' };
}

function dominantZone(businesses) {
  const anomalous = businesses.filter((b) => b.zScore >= 1.5);
  const counts = { NW: 0, NE: 0, SW: 0, SE: 0 };
  anomalous.forEach((b) => { counts[b.zone] += 1; });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = anomalous.length || 1;
  return { zone: entries[0][0], share: entries[0][1] / total };
}

function zoneFor(lat, lng) {
  const north = lat >= TEL_AVIV_CENTER.lat;
  const east = lng >= TEL_AVIV_CENTER.lng;
  if (north && east) return 'NE';
  if (north && !east) return 'NW';
  if (!north && east) return 'SE';
  return 'SW';
}

function renderSignatureChart() {
  const history = state.history.city;
  if (!history.length) {
    ui.signatureChart.innerHTML = '<text x="20" y="120" fill="#7f8ea1" font-size="16">Waiting for data...</text>';
    return;
  }

  const baseline = Array.from({ length: 24 }, (_, h) => median(history.filter((r) => r.hour === h).map((r) => r.cityPressure)) || null);
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const todayRows = history.filter((r) => r.ts >= dayStart);
  const todayByHour = Array.from({ length: 24 }, (_, h) => avg(todayRows.filter((r) => r.hour === h).map((r) => r.cityPressure)) || null);

  const baselinePath = seriesToPoints(baseline, 900, 240);
  const todayPath = seriesToPoints(todayByHour, 900, 240);

  ui.signatureChart.innerHTML = `
    <rect x="0" y="0" width="900" height="240" fill="#f9fbff"></rect>
    <line x1="20" y1="200" x2="880" y2="200" stroke="#dee6f1" stroke-width="1" />
    <polyline points="${baselinePath}" fill="none" stroke="#8da2bf" stroke-width="2" stroke-dasharray="4 4" />
    <polyline points="${todayPath}" fill="none" stroke="#2d6af0" stroke-width="3" />
    <text x="24" y="28" fill="#7487a0" font-size="13">Gray: typical week | Blue: today</text>
  `;
}

function seriesToPoints(series, width, height) {
  const pad = 20;
  const points = [];
  for (let i = 0; i < series.length; i += 1) {
    if (series[i] == null) continue;
    const x = pad + (i / 23) * (width - pad * 2);
    const y = height - pad - (clamp(series[i], 0, 100) / 100) * (height - pad * 2);
    points.push(`${x},${y}`);
  }
  return points.join(' ');
}

function renderTimeline() {
  const series = state.history.city.slice(-48);
  if (!series.length) {
    ui.timeline.innerHTML = '<text x="20" y="110" fill="#7e8a9a" font-size="16">No snapshots yet. First poll is running now.</text>';
    return;
  }

  const points = series.map((row, idx) => {
    const x = 20 + (idx / Math.max(series.length - 1, 1)) * 860;
    const y = 200 - (row.score / 100) * 160;
    return `${x},${y}`;
  }).join(' ');

  ui.timeline.innerHTML = `
    <rect x="0" y="0" width="900" height="220" fill="#f7f9fc"></rect>
    <line x1="20" y1="200" x2="880" y2="200" stroke="#dde4ef" stroke-width="1" />
    <polyline points="${points}" fill="none" stroke="#2d6af0" stroke-width="3" stroke-linecap="round" />
    <text x="24" y="30" fill="#6e7e94" font-size="13">Event score (0-100)</text>
  `;
}

function runBacktest() {
  const lookbackHours = clampInt(Number(ui.backtestHours.value), 6, 336);
  const since = Date.now() - lookbackHours * 60 * 60 * 1000;
  const rows = state.history.city.filter((r) => r.ts >= since).sort((a, b) => a.ts - b.ts);
  const flagged = rows.filter((r) => r.score >= 76 && r.anomalousShare >= 0.25 && r.cityZ >= 1);

  ui.backtestSummary.textContent = `Replay ${lookbackHours}h: ${flagged.length} alert windows out of ${rows.length} snapshots.`;
  ui.backtestTable.innerHTML = rows.slice(-12).reverse().map((r) => {
    const fired = r.score >= 76 && r.anomalousShare >= 0.25 && r.cityZ >= 1;
    return `
      <tr>
        <td>${new Date(r.ts).toLocaleString()}</td>
        <td>${r.score.toFixed(1)}</td>
        <td>${fired ? 'Would alert' : 'No alert'}</td>
      </tr>
    `;
  }).join('');
}

async function exportSnapshotCard() {
  if (!state.lastResult) return;

  const city = state.lastResult.citySnapshot;
  const top = state.lastResult.businessSnapshots.slice(0, 3).map((b) => `${shortName(b.name)} ${b.zScore.toFixed(2)}`).join(' | ');
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f6f9ff"/>
      <stop offset="100%" stop-color="#eaf0fb"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <text x="60" y="110" font-family="Inter, Arial" font-size="54" font-weight="800" fill="#12223a">Israeli Fast Food Index</text>
  <text x="60" y="190" font-family="Inter, Arial" font-size="36" fill="#2d6af0">Event Likelihood: ${Math.round(city.score)}</text>
  <text x="60" y="250" font-family="Inter, Arial" font-size="28" fill="#334e72">Pressure ${city.cityPressure.toFixed(1)} | Rush ${Math.round(city.anomalousShare * 100)}% | z ${city.cityZ.toFixed(2)}</text>
  <text x="60" y="320" font-family="Inter, Arial" font-size="26" fill="#516785">Top counters: ${escapeForSvg(top)}</text>
  <text x="60" y="560" font-family="Inter, Arial" font-size="22" fill="#6b7f9d">${new Date(city.ts).toLocaleString()}</text>
</svg>`;

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `iffi-snapshot-${Date.now()}.svg`;
  a.click();
  URL.revokeObjectURL(url);

  const summary = `Israeli Fast Food Index | Score ${Math.round(city.score)} | Pressure ${city.cityPressure.toFixed(1)} | Rush ${Math.round(city.anomalousShare * 100)}% | ${new Date(city.ts).toLocaleString()}`;
  try {
    await navigator.clipboard.writeText(summary);
  } catch {
    // ignore clipboard failures
  }
}

function ensureLastWeekHistory(businesses) {
  const now = Date.now();
  const minTs = now - BASELINE_WINDOW_MS;
  if (state.history.city.filter((row) => row.ts >= minTs).length >= 40) return;

  const generatedCity = [];
  for (let ts = minTs; ts < now; ts += BOOTSTRAP_STEP_MS) {
    const keys = bucketKeys(ts);
    const samples = businesses.map((place) => {
      const ratingTotal = Number(place.user_ratings_total || 0);
      const rating = Number(place.rating || 3.8);
      const hourTemplate = templateExpected(keys.hour, keys.dow);
      const openNow = likelyOpenAtHour(keys.hour);
      const openComponent = openNow ? 18 : 5;
      const ratingComponent = clamp(rating * 8.5, 18, 42);
      const crowdComponent = clamp(Math.log10(ratingTotal + 10) * 14, 8, 44);
      const noise = randomBetween(-6, 6);
      const proxyLoad = clamp(hourTemplate * 0.36 + openComponent + ratingComponent * 0.24 + crowdComponent * 0.2 + noise, 0, 100);
      return { placeId: place.place_id || place.id || place.name, proxyLoad: round1(proxyLoad), ratingTotal, openNow };
    });

    const cityPressure = avg(samples.map((s) => s.proxyLoad));
    const anomalousShare = samples.filter((s) => Math.abs(s.proxyLoad - cityPressure) > 13).length / Math.max(samples.length, 1);
    const score = clamp(cityPressure * 0.5 + anomalousShare * 22, 0, 100);

    generatedCity.push({ ts, dow: keys.dow, hour: keys.hour, score: round1(score), cityPressure: round1(cityPressure), anomalousShare: round2(anomalousShare), cityZ: 0, businessCount: samples.length, alerted: false });

    for (const s of samples) {
      if (!state.history.businesses[s.placeId]) state.history.businesses[s.placeId] = [];
      state.history.businesses[s.placeId].push({ ts, dow: keys.dow, hour: keys.hour, proxyLoad: s.proxyLoad, ratingTotal: s.ratingTotal, openNow: s.openNow });
    }
  }

  state.history.city = [...state.history.city, ...generatedCity];
  pruneHistoryToLastWeek(now);
  saveHistory(state.history);
}

function computeBusinessBaseline(history, keys, fallbackExpected, nowTs) {
  const recent = history.filter((h) => h.ts >= nowTs - BASELINE_WINDOW_MS);
  const sameBucket = recent.filter((h) => h.dow === keys.dow && h.hour === keys.hour).map((h) => h.proxyLoad);
  const window = sameBucket.length >= 6 ? sameBucket : recent.slice(-50).map((h) => h.proxyLoad);
  if (!window.length) return { expected: fallbackExpected, scale: 8.5 };
  const med = median(window);
  return { expected: med, scale: Math.max(6.8, mad(window, med) * 1.4826) };
}

function computeCityBaseline(cityHistory, keys, fallbackExpected, nowTs) {
  const recent = cityHistory.filter((h) => h.ts >= nowTs - BASELINE_WINDOW_MS);
  const sameBucket = recent.filter((h) => h.dow === keys.dow && h.hour === keys.hour).map((h) => h.cityPressure);
  const window = sameBucket.length >= 6 ? sameBucket : recent.slice(-120).map((h) => h.cityPressure);
  if (!window.length) return { expected: fallbackExpected, scale: 9 };
  const med = median(window);
  return { expected: med, scale: Math.max(7.5, mad(window, med) * 1.4826) };
}

function pruneHistoryToLastWeek(nowTs) {
  const minTs = nowTs - BASELINE_WINDOW_MS;
  state.history.city = state.history.city.filter((row) => row.ts >= minTs);
  for (const placeId of Object.keys(state.history.businesses)) {
    const recent = state.history.businesses[placeId].filter((row) => row.ts >= minTs);
    if (!recent.length) delete state.history.businesses[placeId];
    else state.history.businesses[placeId] = recent;
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { city: [], businesses: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.city) || typeof parsed.businesses !== 'object') return { city: [], businesses: {} };
    return parsed;
  } catch {
    return { city: [], businesses: {} };
  }
}

function saveHistory(history) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function templateExpected(hour, dow) {
  const isWeekend = dow === 5 || dow === 6;
  if (hour >= 1 && hour <= 6) return isWeekend ? 38 : 24;
  if (hour >= 7 && hour <= 10) return 48;
  if (hour >= 11 && hour <= 14) return isWeekend ? 70 : 82;
  if (hour >= 15 && hour <= 17) return 56;
  if (hour >= 18 && hour <= 22) return isWeekend ? 86 : 74;
  return isWeekend ? 64 : 52;
}

function likelyOpenAtHour(hour) { return hour >= 10 && hour <= 23; }
function bucketKeys(ts) { const d = new Date(ts); return { dow: d.getDay(), hour: d.getHours() }; }

function showError(message) { ui.error.textContent = message; ui.error.classList.remove('hidden'); }
function hideError() { ui.error.classList.add('hidden'); }

function shortName(name) { return String(name).split(' ').slice(0, 2).join(' '); }
function signed(v) { return v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1); }
function escapeForSvg(str) { return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
function escapeHtml(str) { return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function avg(nums) { return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0; }
function median(nums) { if (!nums.length) return 0; const s = [...nums].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]; }
function mad(nums, med = median(nums)) { return median(nums.map((n) => Math.abs(n - med))); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function randomBetween(min, max) { return min + Math.random() * (max - min); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clampInt(value, min, max) { return Math.round(clamp(Number.isFinite(value) ? value : min, min, max)); }
function round1(value) { return Math.round(value * 10) / 10; }
function round2(value) { return Math.round(value * 100) / 100; }
