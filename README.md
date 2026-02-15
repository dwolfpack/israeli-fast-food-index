# Israeli Fast Food Index

A local website that estimates unusual city events in central Tel Aviv from fast-food business activity proxies.

## Run

1. Open `/Users/drorwolfshtat/Documents/weather-forecast/app.js`
2. Set your Google key (optional but recommended):

```js
const GOOGLE_MAPS_API_KEY = 'PASTE_YOUR_KEY_HERE';
```

3. Start a local server:

```bash
cd /Users/drorwolfshtat/Documents/weather-forecast
python3 -m http.server 8080
```

4. Open `http://localhost:8080`

## Current behavior

- Polling starts immediately when the page opens.
- A snapshot is collected on every visit.
- Polling continues automatically every 15 minutes.
- Baseline and anomaly calculations use only last 7 days of local history.
- Top anomalies and comparison tables are updated after each polling cycle.
- If Google Places is unavailable, the app falls back to demo business data.

## Notes

- Google Places API does not provide official live "popular times" via API.
- This app uses proxy signals (open status, ratings volume, review velocity estimate, and historical deviation).
