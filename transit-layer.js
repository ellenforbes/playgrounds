/**
 * transit-layer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Public transport tab for Playground Finder.
 * Load this AFTER script.js — it patches into the existing app non-destructively.
 *
 * Depends on globals defined in script.js:
 *   map, FeedMessageType, activeFilterTab, loadTransitStopNames,
 *   switchFilterTab, updateTopicCount
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ===== GLOBALS =====

let transitClusterGroup  = null;
let transitMarkers       = {};          // vehicleKey → Leaflet marker
let transitRefreshTimer  = null;
let transitVisible       = false;

let transitRoutes        = {};          // route_id → route object
let transitRoutesLoaded  = false;
let transitStopNames     = {};          // stop_id  → stop name

// Filter state (mirrors the sidebar checkboxes)
let tFilterTypes    = new Set(['Bus', 'Ferry', 'Rail']);
let tFilterHighFreq = false;
let tFilterRoute    = '';

const TRANSIT_REFRESH_MS = 30_000;

// Visual config per mode
const TRANSIT_MODE = {
  Bus:   { color: '#2563eb', bg: '#dbeafe', emoji: '🚌', gtfsTypes: [3, 700, 702, 704] },
  Ferry: { color: '#ea580c', bg: '#ffedd5', emoji: '⛴',  gtfsTypes: [4] },
  Rail:  { color: '#7c3aed', bg: '#ede9fe', emoji: '🚆', gtfsTypes: [2, 100, 101, 102, 109] },
};

// GTFS route_type integer → our mode key
function gtfsTypeToMode(routeType) {
  const n = Number(routeType);
  for (const [key, cfg] of Object.entries(TRANSIT_MODE)) {
    if (cfg.gtfsTypes.includes(n)) return key;
  }
  return null;
}

// ===== ROUTE DATA (from /api/transit-routes) =====

async function loadTransitRoutes() {
  if (transitRoutesLoaded) return;
  try {
    const res = await fetch('/api/transit-routes');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.json();
    transitRoutes = {};
    for (const r of arr) transitRoutes[r.route_id] = r;
    transitRoutesLoaded = true;
    console.log(`[transit] ${arr.length} routes loaded`);
  } catch (e) {
    console.warn('[transit] Could not load routes:', e.message);
  }
}

// ===== PROTOBUF FETCH (one call per mode) =====

async function fetchModeFeed(mode) {
  const url = `/api/transit-positions?type=${mode}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf  = await res.arrayBuffer();
  // FeedMessageType is declared in script.js and shared via global scope
  return FeedMessageType.decode(new Uint8Array(buf));
}

// ===== FILTER LOGIC =====

function vehiclePassesFilters(routeId, modeKey) {
  // 1. Mode filter
  if (!tFilterTypes.has(modeKey)) return false;

  const route = transitRoutes[routeId] || null;

  // 2. High-frequency filter
  if (tFilterHighFreq) {
    if (!route || !route.is_high_frequency) return false;
  }

  // 3. Route search
  if (tFilterRoute) {
    const q = tFilterRoute.toLowerCase();
    const sn = (route?.route_short_name || '').toLowerCase();
    const ln = (route?.route_long_name  || '').toLowerCase();
    const id = (routeId || '').toLowerCase();
    if (!sn.includes(q) && !ln.includes(q) && !id.includes(q)) return false;
  }

  return true;
}

// ===== MARKER ICON =====

function makeTransitIcon(modeKey, shortName) {
  const cfg     = TRANSIT_MODE[modeKey] || TRANSIT_MODE.Bus;
  const raw     = shortName || cfg.emoji;
  const label   = raw.length > 6 ? raw.slice(0, 6) : raw;
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${cfg.color};color:#fff;
      font-size:10px;font-weight:700;font-family:system-ui,sans-serif;
      padding:2px 5px;border-radius:4px;
      border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.35);
      white-space:nowrap;text-align:center;line-height:1.4;
    ">${label}</div>`,
    iconAnchor: [0, 8],
    iconSize:   null,
  });
}

// ===== POPUP HTML =====

function buildTransitPopup(vehicle, modeKey, routeId) {
  const cfg   = TRANSIT_MODE[modeKey] || TRANSIT_MODE.Bus;
  const route = transitRoutes[routeId] || null;

  const shortName = route?.route_short_name || routeId || '—';
  const longName  = route?.route_long_name  || '';
  const hfBadge   = route?.is_high_frequency
    ? ' <span style="background:#059669;color:#fff;font-size:.65rem;padding:1px 5px;border-radius:3px;margin-left:4px;">⚡ High Freq</span>'
    : '';

  const STATUS = { 0: 'Incoming at', 1: 'Stopped at', 2: 'In transit to' };
  const statusText = STATUS[vehicle.current_status] || '';
  const rawStopId  = vehicle.stop_id || '';
  const stopName   = rawStopId ? (transitStopNames[rawStopId] || rawStopId) : '';
  const stopLine   = (statusText && stopName)
    ? `<b>${statusText}:</b> ${stopName}<br>` : '';

  const vehicleLabel = vehicle.vehicle?.label || vehicle.vehicle?.id || '—';
  const speed = vehicle.position?.speed != null
    ? `${Math.round(Number(vehicle.position.speed) * 3.6)} km/h`
    : null;

  return `
    <div style="font-family:system-ui,sans-serif;min-width:185px;">
      <div style="font-weight:700;font-size:1rem;margin-bottom:6px;color:${cfg.color};">
        ${cfg.emoji} Route ${shortName}${hfBadge}
      </div>
      <div style="font-size:.8rem;color:#333;line-height:1.75;">
        ${longName ? `<b>Service:</b> ${longName}<br>` : ''}
        <b>Vehicle:</b> ${vehicleLabel}<br>
        ${stopLine}
        ${speed ? `<b>Speed:</b> ${speed}<br>` : ''}
      </div>
    </div>`;
}

// ===== FETCH + RENDER =====

async function fetchAndDisplayTransit() {
  if (!transitVisible) return;
  if (typeof FeedMessageType === 'undefined' || !FeedMessageType) {
    console.warn('[transit] Proto not ready yet — skipping refresh');
    return;
  }

  const modesToFetch = [...tFilterTypes];
  const results = await Promise.allSettled(
    modesToFetch.map(mode => fetchModeFeed(mode).then(feed => ({ mode, feed })))
  );

  const seenKeys = new Set();

  for (const result of results) {
    if (result.status !== 'fulfilled') {
      console.warn('[transit] Feed error:', result.reason?.message);
      continue;
    }

    const { mode: modeKey, feed } = result.value;
    if (!feed?.entity) continue;

    for (const entity of feed.entity) {
      const v = entity.vehicle;
      if (!v?.position?.latitude) continue;

      const lat     = Number(v.position.latitude);
      const lon     = Number(v.position.longitude);
      const routeId = v.trip?.route_id || '';

      // Use a stable key: mode + vehicle id (avoids cross-mode collisions)
      const vKey = `${modeKey}:${v.vehicle?.id || v.vehicle?.label || entity.id}`;

      if (!vehiclePassesFilters(routeId, modeKey)) {
        // Remove stale marker if it no longer passes
        if (transitMarkers[vKey]) {
          transitClusterGroup.removeLayer(transitMarkers[vKey]);
          delete transitMarkers[vKey];
        }
        continue;
      }

      seenKeys.add(vKey);

      const route     = transitRoutes[routeId] || null;
      const shortName = route?.route_short_name || routeId || TRANSIT_MODE[modeKey]?.emoji;
      const icon      = makeTransitIcon(modeKey, shortName);
      const popup     = buildTransitPopup(v, modeKey, routeId);

      if (transitMarkers[vKey]) {
        transitMarkers[vKey].setLatLng([lat, lon]);
        transitMarkers[vKey].setIcon(icon);
        transitMarkers[vKey].setPopupContent(popup);
      } else {
        const marker = L.marker([lat, lon], { icon }).bindPopup(popup);
        transitClusterGroup.addLayer(marker);
        transitMarkers[vKey] = marker;
      }
    }
  }

  // Remove markers that are gone from the feed or filtered out
  for (const key of Object.keys(transitMarkers)) {
    if (!seenKeys.has(key)) {
      transitClusterGroup.removeLayer(transitMarkers[key]);
      delete transitMarkers[key];
    }
  }

  refreshTransitCount();
}

// ===== COUNT =====

function refreshTransitCount() {
  if (typeof activeFilterTab === 'undefined' || activeFilterTab !== 'transit') return;
  const count = Object.keys(transitMarkers).length;
  document.querySelectorAll('.playgroundCount').forEach(el => {
    el.textContent = `${count} vehicle${count !== 1 ? 's' : ''}`;
  });
}

// ===== TRACKING =====

function startTransitTracking() {
  fetchAndDisplayTransit();
  transitRefreshTimer = setInterval(fetchAndDisplayTransit, TRANSIT_REFRESH_MS);
}

function stopTransitTracking() {
  if (transitRefreshTimer) { clearInterval(transitRefreshTimer); transitRefreshTimer = null; }
}

// ===== TOGGLE (map button) =====

function toggleTransit() {
  const btn = document.getElementById('toggleTransitBtn');
  if (!transitVisible) {
    map.addLayer(transitClusterGroup);
    transitVisible = true;
    startTransitTracking();
    btn?.classList.remove('transit-hidden');
    if (typeof switchFilterTab === 'function') switchFilterTab('transit');
  } else {
    map.removeLayer(transitClusterGroup);
    transitVisible = false;
    stopTransitTracking();
    btn?.classList.add('transit-hidden');
  }
}

// ===== FILTER CHANGE HANDLER =====

function applyTransitFilters() {
  tFilterTypes = new Set();
  if (document.getElementById('transitFilterBus')?.checked)   tFilterTypes.add('Bus');
  if (document.getElementById('transitFilterFerry')?.checked) tFilterTypes.add('Ferry');
  if (document.getElementById('transitFilterRail')?.checked)  tFilterTypes.add('Rail');

  tFilterHighFreq = document.getElementById('transitHighFreqOnly')?.checked || false;
  tFilterRoute    = (document.getElementById('transitRouteSearch')?.value || '').trim();

  fetchAndDisplayTransit();
}

// ===== INIT =====

function initialiseTransitLayer() {

  // ── Cluster group ──────────────────────────────────────────────────────────
  transitClusterGroup = L.markerClusterGroup({
    maxClusterRadius:    60,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    iconCreateFunction: cluster => {
      const n = cluster.getChildCount();
      const size = n < 10 ? 32 : n < 50 ? 40 : 48;
      return L.divIcon({
        html: `<div style="
          background:#2563eb;color:#fff;border-radius:50%;
          width:${size}px;height:${size}px;
          display:flex;align-items:center;justify-content:center;
          font-weight:700;font-size:${n < 10 ? 12 : 14}px;
          border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);
        ">${n}</div>`,
        className:  'transit-cluster-icon',
        iconSize:   [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    },
  });

  // ── Background data loads ──────────────────────────────────────────────────
  loadTransitRoutes();
  // Reuse the function already defined in script.js
  if (typeof loadTransitStopNames === 'function') {
    loadTransitStopNames('all').then(lookup => { transitStopNames = lookup; });
  }

  // ── Patch updateTopicCount to handle transit tab ───────────────────────────
  const _origCount = typeof updateTopicCount === 'function' ? updateTopicCount.bind(window) : null;
  window.updateTopicCount = function () {
    if (typeof activeFilterTab !== 'undefined' && activeFilterTab === 'transit') {
      refreshTransitCount();
    } else if (_origCount) {
      _origCount();
    }
  };

  // ── Add transit button to the existing toggle button container ─────────────
  // createToggleButtons() in script.js already ran by the time this fires.
  const container = document.getElementById('toggleButtonContainer');
  if (container) {
    const btn = document.createElement('button');
    btn.id        = 'toggleTransitBtn';
    btn.className = 'toggle-events-btn transit-hidden';
    btn.innerHTML = '<span class="events-icon">🚌</span><span class="events-text">Transit</span>';
    btn.addEventListener('click', toggleTransit);
    container.appendChild(btn);
  }

  // ── Filter sidebar event listeners ─────────────────────────────────────────
  ['transitFilterBus', 'transitFilterFerry', 'transitFilterRail', 'transitHighFreqOnly']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', applyTransitFilters);
    });

  const routeInput = document.getElementById('transitRouteSearch');
  if (routeInput) {
    let debounce;
    routeInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(applyTransitFilters, 300);
    });
  }

  const clearBtn = document.getElementById('transitRouteClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const inp = document.getElementById('transitRouteSearch');
      if (inp) { inp.value = ''; applyTransitFilters(); }
    });
  }

  console.log('[transit] Layer initialised');
}

// Run after script.js's DOMContentLoaded has fired (script.js is loaded first)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialiseTransitLayer);
} else {
  initialiseTransitLayer();
}
