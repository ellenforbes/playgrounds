// ===== GLOBAL VARIABLES =====

let playgroundData = null;
let eventsData = null;
let librariesData = null;
let markerClusterGroup;
let eventsClusterGroup;
let librariesClusterGroup;
let currentEditingPlayground = null;
let map;
let playgroundLookup = {};
let allKeywords = [];
let selectedKeywords = [];
let allSuburbs = [];
let selectedSuburbs = [];
let allLGAs = [];
let selectedLGAs = [];
let userLocationMarker = null;
let userAccuracyCircle = null;
let watchId = null;
let loadedBounds = new Set();
let isLoadingPlaygrounds = false;
let allLoadedPlaygrounds = [];
let dropdownsInitialized = false;
let initialLoadComplete = false;
let allTypes = [];
let allShadeOptions = [];
let allFencingOptions = [];
let allParkingOptions = [];
let allSeatingOptions = [];
let allFloorOptions = [];
let allVerifiedOptions = [];
let allFoxOptions = [];
let searchIndex = [];
let searchIndexLoaded = false;

// ===== FERRY TRACKING GLOBALS =====
let ferryLayerGroup = null;
let ferryMarkers = {};
let ferryRefreshInterval = null;
let ferryVisible = false;
let ferryProtoLoaded = false;
let FeedMessageType = null;

const FERRY_TARGETS = ['GOOTCHA', 'KULUWIN'];
const FERRY_GTFS_URL = '/api/gtfs-rt?feed=positions&type=Ferry&raw=1';  // raw=1 → protobuf for client-side decode
const FERRY_CORS_PROXY = '';
const FERRY_REFRESH_MS = 30000;

const FERRY_DISPLAY_NAMES = { 'GOOTCHA': 'Bluey', 'KULUWIN': 'Bingo' };
const FERRY_VESSEL_NAMES  = { 'GOOTCHA': 'Gootcha', 'KULUWIN': 'Kuluwin' };

const VEHICLE_STATUS_TEXT = { 0: 'Incoming at', 1: 'Stopped at', 2: 'In transit to' };

const FERRY_TRIP_UPDATES_URL = '/api/gtfs-rt?feed=updates&type=Ferry';
const TRANSIT_STOPS_URL = '/api/gtfs-static?data=stops';
let ferryStopNames = {};

async function loadTransitStopNames(type = 'Ferry') {
    try {
        const res = await fetch(`${TRANSIT_STOPS_URL}&type=${type}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const lookup = await res.json();
        console.log(`Transit stop names loaded (type=${type}): ${Object.keys(lookup).length} stops`);
        return lookup;
    } catch (e) {
        console.warn(`Could not load transit stop names (type=${type}):`, e.message);
        return {};
    }
}

const FERRY_PROTO_SCHEMA = `
  syntax = "proto2";
  message FeedMessage {
    required FeedHeader header = 1;
    repeated FeedEntity entity = 2;
    extensions 1000 to 1999;
  }
  message FeedHeader {
    required string gtfs_realtime_version = 1;
    optional uint32 incrementality = 2;
    optional uint64 timestamp = 3;
    extensions 1000 to 1999;
  }
  message FeedEntity {
    required string id = 1;
    optional bool is_deleted = 2;
    optional TripUpdate trip_update = 3;
    optional VehiclePosition vehicle = 4;
    optional Alert alert = 5;
    extensions 1000 to 1999;
  }
  message VehiclePosition {
    optional TripDescriptor trip = 1;
    optional VehicleDescriptor vehicle = 8;
    optional Position position = 2;
    optional uint32 current_stop_sequence = 3;
    optional string stop_id = 7;
    optional int32 current_status = 4;
    optional uint64 timestamp = 5;
    extensions 1000 to 1999;
  }
  message Position {
    required float latitude = 1;
    required float longitude = 2;
    optional float bearing = 3;
    optional double odometer = 4;
    optional float speed = 5;
  }
  message TripDescriptor {
    optional string trip_id = 1;
    optional string route_id = 5;
    optional uint32 direction_id = 6;
    extensions 1000 to 1999;
  }
  message VehicleDescriptor {
    optional string id = 1;
    optional string label = 2;
    optional string license_plate = 3;
  }
  message TripUpdate {
    optional TripDescriptor trip = 1;
    repeated StopTimeUpdate stop_time_update = 2;
    extensions 1000 to 1999;
  }
  message StopTimeUpdate {
    optional uint32 stop_sequence = 1;
    optional string stop_id = 4;
    optional StopTimeEvent arrival = 2;
    optional StopTimeEvent departure = 3;
    optional int32 schedule_relationship = 5;
  }
  message StopTimeEvent {
    optional int32 delay = 1;
    optional int64 time = 2;
    optional float uncertainty = 3;
  }
  message Alert { extensions 1000 to 1999; }
`;


// ===== SUPABASE CLIENT =====

const supabaseUrl = 'https://mrcodrddkxvoszuwdaks.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yY29kcmRka3h2b3N6dXdkYWtzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAzNTc0NzUsImV4cCI6MjA3NTkzMzQ3NX0.GOKyB7-vdg968lE2jC5PxrOdVKp7IOis6QtyG2FNptQ';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// ===== CONFIGURATION OBJECTS =====

const sizeConfigs = {
    marker: {
        'Super':    { radius: 20, fillColor: '#8b5cf6', borderColor: '#ffffff' },
        'Large':    { radius: 16, fillColor: '#dc2626', borderColor: '#ffffff' },
        'Medium':   { radius: 13, fillColor: '#ea580c', borderColor: '#ffffff' },
        'Small':    { radius: 11, fillColor: '#faaa3c', borderColor: '#ffffff' },
        'Tiny':     { radius: 8,  fillColor: '#eab308', borderColor: '#ffffff' },
        'Unverified': { radius: 8, fillColor: '#6b7280', borderColor: '#202020' },
        'Exists: Not Digitally Classifiable': { radius: 8, fillColor: '#16a34a', borderColor: '#202020' },
        'Under Construction': { radius: 8, fillColor: '#facc15', borderColor: '#ffffff', emoji: '🚧' },
        'Unsure If Exists': { radius: 8, fillColor: '#dc2626', borderColor: '#202020' }
    },
    cluster: {
        colors: {
            'Super':    { bg: '#8b5cf6', border: '#7c3aed' },
            'Large':    { bg: '#dc2626', border: '#b91c1c' },
            'Medium':   { bg: '#ea580c', border: '#c2410c' },
            'Small':    { bg: '#faaa3c', border: '#ea580c' },
            'Tiny':     { bg: '#eab308', border: '#ca8a04' },
            'Unverified': { bg: '#374151', border: '#1f2937' },
            'Exists: Not Digitally Classifiable': { bg: '#16a34a', border: '#1f2937' },
            'Under Construction': { bg: '#eab308', border: '#1f2937' },
            'Unsure If Exists': { bg: '#dc2626', border: '#1f2937' }
        },
        hierarchy: ['Super', 'Large', 'Medium', 'Small', 'Tiny', 'Unverified',
                    'Exists: Not Digitally Classifiable', 'Under Construction', 'Unsure If Exists']
    }
};

const sizeSliderConfig = {
    order: ['Unverified', 'Unsure If Exists', 'Exists: Not Digitally Classifiable',
            'Under Construction', 'Tiny', 'Small', 'Medium', 'Large', 'Super'],
    labels: {
        'Unverified': 'Unverified',
        'Unsure If Exists': 'Unverified',
        'Exists: Not Digitally Classifiable': 'Unverified',
        'Under Construction': 'Rebuild',
        'Tiny': 'Tiny', 'Small': 'Small', 'Medium': 'Medium', 'Large': 'Large', 'Super': 'Super'
    }
};

const baseLayers = {
    "Greyscale": L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }),
    "Dark": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM'
    }),
    "Street Map": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }),
    "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
    })
};

// ===== UTILITY FUNCTIONS =====

function parseIntSafe(value) {
    if (!value) return 0;
    const parsed = parseInt(value);
    return isNaN(parsed) ? 0 : parsed;
}

function hasValue(value) {
    return value && value !== 'None' && value !== 'No' && value !== 'null';
}

function generateUniqueId(props) { return props.uid; }

function createElement(tag, className, innerHTML, attributes = {}) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (innerHTML) element.innerHTML = innerHTML;
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
}

function extractUniqueValues(data, propertyName) {
    return [...new Set(data.map(p => p[propertyName]).filter(Boolean))].sort();
}

function sortWithCustomOrder(items, preferredOrder) {
    return items.sort((a, b) => {
        const ia = preferredOrder.indexOf(a);
        const ib = preferredOrder.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
    });
}

function enlargePhoto(img) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;cursor:zoom-out;z-index:9999;';
    const enlargedImg = document.createElement('img');
    enlargedImg.src = img.src;
    enlargedImg.style.cssText = 'max-width:90%;max-height:90%;border-radius:6px;box-shadow:0 0 20px rgba(0,0,0,0.5);';
    overlay.appendChild(enlargedImg);
    document.body.appendChild(overlay);
    overlay.onclick = () => document.body.removeChild(overlay);
}

// ===== UI HELPER FUNCTIONS =====

function setupDrawerHandleText() {
    const drawer = document.querySelector('.w-80.bg-white.shadow-lg');
    const drawerHandleText = document.querySelector('.drawer-handle-text');
    if (!drawer || !drawerHandleText) return;

    function updateDrawerText() {
        const isFullyExpanded = drawer.classList.contains('drawer-full');
        let countSpan = drawerHandleText.querySelector('.playgroundCount');
        const currentCount = countSpan ? countSpan.textContent : '? playgrounds';
        const actionText = isFullyExpanded ? ' • Tap to minimise' : ' • Tap to expand';
        drawerHandleText.innerHTML = `<span id="playgroundCountMobile" class="playgroundCount">${currentCount}</span>${actionText}`;
    }

    updateDrawerText();
    const observer = new MutationObserver(updateDrawerText);
    observer.observe(drawer, { attributes: true, attributeFilter: ['class'] });
}

function addUserLocationMarker(lat, lng) {
    updateUserLocationMarker(lat, lng, 50);
}

function updateUserLocationMarker(lat, lng, accuracy) {
    if (!map.getPane('userLocationPane')) {
        map.createPane('userLocationPane');
        map.getPane('userLocationPane').style.zIndex = 650;
    }

    if (userLocationMarker) {
        userLocationMarker.setLatLng([lat, lng]);
    } else {
        userLocationMarker = L.circleMarker([lat, lng], {
            radius: 6, fillColor: '#6097f0ff', color: '#caecf6ff',
            weight: 3, opacity: 1, fillOpacity: 1, interactive: false, pane: 'userLocationPane'
        }).addTo(map);
    }

    if (userAccuracyCircle) {
        userAccuracyCircle.setLatLng([lat, lng]);
        userAccuracyCircle.setRadius(accuracy);
    } else {
        userAccuracyCircle = L.circle([lat, lng], {
            radius: accuracy, fillColor: '#4285F4', color: '#4285F4',
            weight: 1, opacity: 0.2, fillOpacity: 0.1, interactive: false, pane: 'userLocationPane'
        }).addTo(map);
    }
}

function toggleFooter() {
    const footer = document.getElementById('footer');
    const footerToggle = document.getElementById('footerToggle');
    if (!footer || !footerToggle) return;
    footer.classList.toggle('open');
    footerToggle.style.display = footer.classList.contains('open') ? 'none' : 'block';
}

function setupEventListeners() {
    const dropdownBtns = [
        { id: 'typeDropdownBtn',    menus: ['typeDropdownMenu', 'lgaDropdownMenu', 'suburbDropdownMenu'] },
        { id: 'shadeDropdownBtn',   menus: ['shadeDropdownMenu'] },
        { id: 'fencingDropdownBtn', menus: ['fencingDropdownMenu'] },
        { id: 'parkingDropdownBtn', menus: ['parkingDropdownMenu'] },
    ];

    dropdownBtns.forEach(({ id, menus }) => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', () => toggleDropdown(menus[0]));
    });

    const filterIds = [
        'filterHasTrampoline', 'filterHasSkatePark', 'filterHasLargeFlyingFox', 'filterHasSandpit',
        'filterHasScootTrack', 'filterHasWaterPlay', 'filterHasAccessibleFeatures',
        'filterHasToilet', 'filterHasBBQ', 'filterHasBubbler'
    ];
    filterIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', filterMarkers);
    });

    initialiseSizeSlider();

    const footerToggle = document.getElementById('footerToggle');
    if (footerToggle) footerToggle.addEventListener('click', toggleFooter);

    document.addEventListener('click', handleOutsideClick);
    setupModalEventListeners();
    setupFormSubmission();
    setupDrawerHandleText();
    initialiseAddNewPlayground();
}

function handleOutsideClick(event) {
    [
        { btn: 'typeDropdownBtn',    menu: 'typeDropdownMenu' },
        { btn: 'shadeDropdownBtn',   menu: 'shadeDropdownMenu' },
        { btn: 'fencingDropdownBtn', menu: 'fencingDropdownMenu' },
        { btn: 'parkingDropdownBtn', menu: 'parkingDropdownMenu' },
    ].forEach(({ btn, menu }) => {
        const button   = document.getElementById(btn);
        const dropdown = document.getElementById(menu);
        if (button && dropdown && !button.contains(event.target) && !dropdown.contains(event.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

function updateTopicCount() {
    let count = 0;
    let label = '';

    if (activeFilterTab === 'playgrounds') {
        if (map && markerClusterGroup) {
            const bounds = map.getBounds();
            markerClusterGroup.eachLayer(m => { if (bounds.contains(m.getLatLng())) count++; });
        }
        label = `playground${count !== 1 ? 's' : ''}`;

    } else if (activeFilterTab === 'events') {
        if (map && eventsClusterGroup) {
            const bounds = map.getBounds();
            eventsClusterGroup.eachLayer(m => { if (bounds.contains(m.getLatLng())) count++; });
        }
        label = `event${count !== 1 ? 's' : ''}`;

    } else if (activeFilterTab === 'libraries') {
        if (map && librariesClusterGroup) {
            const bounds = map.getBounds();
            librariesClusterGroup.eachLayer(m => { if (bounds.contains(m.getLatLng())) count++; });
        }
        label = `librar${count !== 1 ? 'ies' : 'y'}`;
    }

    document.querySelectorAll('.playgroundCount').forEach(el => {
        el.textContent = `${count} ${label}`;
    });
}

// ===== MAP INITIALIZATION =====

let hasGeolocated = false;
let geolocationTimeout = null;

const MAITLAND = [-32.75, 151.57];
const FALLBACK_ZOOM = 12;
const USER_ZOOM = 14;

function initialiseMap() {
    try {
        // Create map WITHOUT a view — avoids rendering Maitland tiles before we know the user's location
        map = L.map('map');
    } catch (err) {
        console.error('Leaflet map init failed:', err);
        return;
    }

    baseLayers["Greyscale"].addTo(map);
    L.control.layers(baseLayers).addTo(map);

    // Called exactly once — sets the map view and triggers viewport data load
    function applyPosition(lat, lng, zoom) {
        if (hasGeolocated) return;
        hasGeolocated = true;
        clearTimeout(geolocationTimeout);
        map.setView([lat, lng], zoom, { animate: false });
        loadVisiblePlaygrounds().then(() => { initialLoadComplete = true; });
    }

    const secure = location.protocol === 'https:' || location.hostname === 'localhost';

    if (!('geolocation' in navigator) || !secure) {
        console.warn('Geolocation unavailable — using default location.');
        applyPosition(MAITLAND[0], MAITLAND[1], FALLBACK_ZOOM);
        return;
    }

    // Hard fallback — if nothing succeeds within 3 s, load Maitland
    geolocationTimeout = setTimeout(() => {
        console.log('Geolocation timed out — loading default location.');
        applyPosition(MAITLAND[0], MAITLAND[1], FALLBACK_ZOOM);
    }, 3000);

    // First: try a quick look-up that accepts a cached position (instant on return visits)
    navigator.geolocation.getCurrentPosition(
        ({ coords: { latitude: lat, longitude: lng, accuracy } }) => {
            applyPosition(lat, lng, USER_ZOOM);
            updateUserLocationMarker(lat, lng, accuracy);
            // Start continuous tracking for the blue dot
            watchId = navigator.geolocation.watchPosition(
                ({ coords: c }) => updateUserLocationMarker(c.latitude, c.longitude, c.accuracy),
                (err) => console.warn('Watch error:', err.message),
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
            );
        },
        () => {
            // Quick cached look-up failed — fall back to watchPosition (takes longer but still tries)
            watchId = navigator.geolocation.watchPosition(
                ({ coords: { latitude: lat, longitude: lng, accuracy } }) => {
                    applyPosition(lat, lng, USER_ZOOM);
                    updateUserLocationMarker(lat, lng, accuracy);
                },
                (err) => {
                    console.warn('Geolocation error:', err.message);
                    applyPosition(MAITLAND[0], MAITLAND[1], FALLBACK_ZOOM);
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        },
        // Accept a cached position up to 30 s old, must answer within 2 s
        { maximumAge: 30000, timeout: 2000, enableHighAccuracy: false }
    );
}

// ===== CLUSTER FUNCTIONALITY =====

function initialiseClusterGroup() {
    const clusterOpts = (iconFn) => ({
        maxClusterRadius: 50, spiderfyOnMaxZoom: true,
        showCoverageOnHover: false, zoomToBoundsOnClick: true,
        iconCreateFunction: iconFn
    });

    markerClusterGroup   = L.markerClusterGroup(clusterOpts(createClusterIcon));
    librariesClusterGroup = L.markerClusterGroup(clusterOpts(createLibraryClusterIcon));
    eventsClusterGroup   = L.markerClusterGroup(clusterOpts(createEventClusterIcon));
}

function createClusterIcon(cluster) {
    const count = cluster.getChildCount();
    const dominantSize = getDominantRating(cluster.getAllChildMarkers());
    const config = getClusterSizeConfig(dominantSize, count);
    return L.divIcon({
        html: `<div class="cluster-marker" style="background:${config.backgroundColor};border:3px solid ${config.borderColor};width:${config.size}px;height:${config.size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;color:white;font-size:${config.fontSize}px;box-shadow:0 2px 8px rgba(0,0,0,0.3);">${count}</div>`,
        className: 'custom-cluster-icon',
        iconSize: [config.size, config.size],
        iconAnchor: [config.size / 2, config.size / 2]
    });
}

function getDominantRating(markers) {
    const hierarchy = sizeConfigs.cluster.hierarchy;
    let highestIndex = hierarchy.length;
    let highestRating = null;
    markers.forEach(marker => {
        const rating = marker.playgroundData.classification || marker.playgroundData.size;
        const idx = hierarchy.indexOf(rating);
        if (idx !== -1 && idx < highestIndex) { highestIndex = idx; highestRating = rating; }
    });
    return highestRating || (markers[0].playgroundData.classification || markers[0].playgroundData.size);
}

function getClusterSizeConfig(dominantSize, count) {
    const colorConfig = sizeConfigs.cluster.colors[dominantSize] || sizeConfigs.cluster.colors['Unverified'];
    let size, fontSize;
    if      (count < 10)  { size = 35; fontSize = 12; }
    else if (count < 50)  { size = 45; fontSize = 14; }
    else if (count < 100) { size = 55; fontSize = 16; }
    else                  { size = 65; fontSize = 18; }
    return { backgroundColor: colorConfig.bg, borderColor: colorConfig.border, size, fontSize };
}

// ===== MARKER FUNCTIONALITY =====

function createMarker(playground) {
    playgroundLookup[playground.uid] = playground;
    const sizeConfig = getMarkerSizeConfig(playground.classification);
    let marker;

    if (playground.classification === 'Under Construction') {
        marker = L.marker([playground.lat, playground.lng], {
            icon: L.divIcon({
                className: 'emoji-marker',
                html: `<div style="font-size:${sizeConfig.radius * 3}px;">🚧</div>`,
                iconSize: [sizeConfig.radius * 2, sizeConfig.radius * 2],
                iconAnchor: [sizeConfig.radius, sizeConfig.radius]
            })
        });
    } else {
        marker = L.circleMarker([playground.lat, playground.lng], {
            radius: sizeConfig.radius, fillColor: sizeConfig.fillColor,
            color: sizeConfig.borderColor, weight: 3, opacity: 1, fillOpacity: 0.9
        });
    }

    marker.bindPopup(createPopupContent(playground, [playground.lng, playground.lat]));
    if (window.innerWidth > 768) {
        marker.bindTooltip(playground.name || 'Unnamed Playground', {
            permanent: false, direction: 'top', offset: [0, -10], className: 'playground-tooltip'
        });
    }
    marker.playgroundData = playground;
    return marker;
}

function getMarkerSizeConfig(size) {
    return sizeConfigs.marker[size] || sizeConfigs.marker['Unverified'];
}

function getPlaygroundCoordinates(playground) {
    if (playground.geom) {
        try {
            const geometry = typeof playground.geom === 'string' ? JSON.parse(playground.geom) : playground.geom;
            if (geometry.coordinates?.length >= 2) {
                return { lat: geometry.coordinates[1], lng: geometry.coordinates[0] };
            }
        } catch (e) {
            console.warn('Failed to parse geom for:', playground.name);
        }
    }
    if (playground.lat != null && playground.lng != null) return { lat: playground.lat, lng: playground.lng };
    return null;
}

function addMarkersToMap() {
    if (!playgroundData?.length) { console.error('No playground data available'); return; }
    markerClusterGroup.clearLayers();
    playgroundData.forEach(playground => {
        if (playground.lat != null && playground.lng != null) {
            markerClusterGroup.addLayer(createMarker(playground));
        }
    });
    if (!map.hasLayer(markerClusterGroup)) map.addLayer(markerClusterGroup);
}

let eventsVisible = false;
let librariesVisible = false;
let playgroundsVisible = true;    // Playgrounds start ON
let activeFilterTab    = 'playgrounds';


function switchFilterTab(tab) {
    // Update tab buttons
    document.querySelectorAll('.topic-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Show/hide panels
    document.querySelectorAll('.filter-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `filter-panel-${tab}`);
    });

    activeFilterTab = tab;
    updateTopicCount();
}

function togglePlaygrounds() {
    const btn = document.getElementById('togglePlaygroundsBtn');
    if (playgroundsVisible) {
        map.removeLayer(markerClusterGroup);
        btn?.classList.add('playgrounds-hidden');
        playgroundsVisible = false;
    } else {
        map.addLayer(markerClusterGroup);
        btn?.classList.remove('playgrounds-hidden');
        playgroundsVisible = true;
        switchFilterTab('playgrounds');
    }
    updateTopicCount();
}

function toggleEvents() {
    const btn = document.getElementById('toggleEventsBtn');
    if (eventsVisible) {
        map.removeLayer(eventsClusterGroup);
        btn?.classList.add('events-hidden');
        eventsVisible = false;
    } else {
        map.addLayer(eventsClusterGroup);
        btn?.classList.remove('events-hidden');
        eventsVisible = true;
        switchFilterTab('events');  // auto-switch filter tab
    }
    updateTopicCount();
}

function toggleLibraries() {
    const btn = document.getElementById('toggleLibrariesBtn');
    if (librariesVisible) {
        map.removeLayer(librariesClusterGroup);
        btn?.classList.add('libraries-hidden');
        librariesVisible = false;
    } else {
        map.addLayer(librariesClusterGroup);
        btn?.classList.remove('libraries-hidden');
        librariesVisible = true;
        switchFilterTab('libraries');  // auto-switch filter tab
    }
    updateTopicCount();
}

// ===== POPUP FUNCTIONALITY =====

function createPopupContent(props) {
    return `
        <div style="font-family:system-ui,-apple-system,sans-serif;min-width:300px;padding:12px;">
            ${createPopupHeader(props)}
            ${generateCompactFeaturesList(props)}
            ${createPopupFooter(props, generateUniqueId(props))}
        </div>
    `;
}

function createPopupHeader(props) {
    const mapsIcon = props.lat && props.lng
        ? `<a href="https://www.google.com/maps?q=${props.lat},${props.lng}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;margin-left:4px;">📍</a>`
        : '';
    const title = props.link
        ? `<a href="${props.link}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">${props.name} 🔗</a>`
        : props.name;
    return `
        <div style="margin-bottom:8px;">
            <h3 style="font-weight:bold;font-size:var(--font-size-lg);margin:0;">${title}${mapsIcon}</h3>
            <div style="font-style:italic;margin-top:2px;">${props.keywords || ''}</div>
        </div>
    `;
}

function createPopupFooter(props, uniqueId) {
    const baseUrl = 'https://mrcodrddkxvoszuwdaks.supabase.co/storage/v1/object/public/Photos/';
    const photoUrl = props.photo ? `${baseUrl}${props.photo}` : null;
    const photo = photoUrl
        ? `<div style="margin-bottom:4px;"><img src="${photoUrl}" style="max-width:100%;height:auto;border-radius:4px;cursor:zoom-in;" alt="Playground photo" onclick="enlargePhoto(this)"></div>`
        : '';
    const comments = props.comments ? `<div style="font-style:italic;margin-bottom:8px;">${props.comments}</div>` : '';
    return `
        <div style="margin-top:12px;padding-top:8px;border-top:2px dotted var(--text-light);">
            ${photo}
            ${comments}
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="color:var(--text-tertiary);">
                    Verified: ${props.last_visit_date ? new Date(props.last_visit_date).toLocaleDateString('en-GB') : 'Unknown'}, ${props.verified || 'Unknown'}
                </div>
                <button class="submit-btn" style="padding:6px 12px;font-size:var(--font-size-sm);width:auto;" onclick="editPlayground('${uniqueId}')">
                    Edit Details
                </button>
            </div>
        </div>
    `;
}

// ===== HOVER EFFECTS =====

function highlightSection(category, uid) {
    ['word', 'emoji'].forEach(type => {
        const el = document.getElementById(`${category}-${type}-${uid}`);
        if (el) { el.style.backgroundColor = 'var(--contrast-light)'; el.style.padding = '2px 4px'; el.style.borderRadius = '3px'; }
    });
    const details = document.getElementById(`${category}-details-${uid}`);
    if (details) details.style.display = 'inline';
}

function unhighlightSection(category, uid) {
    ['word', 'emoji'].forEach(type => {
        const el = document.getElementById(`${category}-${type}-${uid}`);
        if (el) { el.style.backgroundColor = ''; el.style.padding = ''; el.style.borderRadius = ''; }
    });
    const details = document.getElementById(`${category}-details-${uid}`);
    if (details) details.style.display = 'none';
}

// ===== FEATURES LIST GENERATION =====

function generateCompactFeaturesList(props) {
    const sections = [
        createFacilitiesSection(props),
        createSecondaryFacilitiesSection(props),
        createSeatingSection(props)
    ];

    const equipmentSections = createEquipmentSections(props);
    const hasEquipment = equipmentSections.length > 0 || hasValue(props.accessible);

    if (sections.some(Boolean) && hasEquipment) {
        sections.push('<div style="border-bottom:2px dotted var(--text-light);margin-bottom:8px;"></div>');
    }
    if (hasValue(props.accessible)) sections.push('<div style="margin-bottom:6px;">♿ Accessible Infrastructure</div>');
    sections.push(equipmentSections.join(''));

    const activities = createActivitiesSection(props);
    if ((hasEquipment || hasValue(props.accessible)) && activities) {
        sections.push('<div style="border-bottom:2px dotted var(--text-light);margin-bottom:8px;margin-top:8px;"></div>');
    }
    sections.push(activities);

    return sections.filter(Boolean).join('');
}

function createFacilitiesSection(props) {
    const f = [];
    if (hasValue(props.toilet))  f.push('🚻 Toilets');
    if (hasValue(props.bbq))     f.push('🔥 BBQ');
    if (hasValue(props.bubbler)) f.push('💧 Bubbler');
    return f.length ? `<div style="margin-bottom:6px;">${f.join(', ')}</div>` : '';
}

function createSecondaryFacilitiesSection(props) {
    const f = [];
    if (hasValue(props.fencing)) {
        const icon = (props.fencing === 'No Fence' || props.fencing === 'Other') ? '🔓' : '🔒';
        f.push(`${icon} ${props.fencing}`);
    }
    if (hasValue(props.shade))   f.push(`${props.shade === 'No Shade' ? '☀️' : '🌳'} ${props.shade}`);
    if (hasValue(props.parking)) f.push(`🚗 ${props.parking}`);
    return f.length ? `<div style="margin-bottom:8px;">${f.join(', ')}</div>` : '';
}

function createSeatingSection(props) {
    return hasValue(props.seating) ? `<div style="margin-bottom:8px;">🪑 ${props.seating}</div>` : '';
}

function createEquipmentSections(props) {
    return [
        createSwingsSection(props),
        createSlidesSection(props),
        createClimbingSection(props),
        createBalanceSection(props),
        createOtherEquipmentSection(props)
    ].filter(Boolean);
}

function createSwingsSection(props) {
    const types = [
        { key: 'baby_swing', name: 'Baby' }, { key: 'belt_swing', name: 'Belt' },
        { key: 'basket_swing', name: 'Basket' }, { key: 'dual_swing', name: 'Dual' },
        { key: 'hammock', name: 'Hammock' }
    ];
    const swings = []; let total = 0; let baby = 0;
    types.forEach(({ key, name }) => {
        const count = parseIntSafe(props[key]);
        if (count) { swings.push(name); total += count; if (key === 'baby_swing') baby = count; }
    });
    if (!swings.length) return '';
    const max = Math.min(total, 8);
    const babyCount = Math.min(baby, max);
    return createHoverableSection('Swings', props.uid,
        '👶'.repeat(babyCount) + '🤸‍♀️'.repeat(Math.max(0, max - babyCount)),
        swings.join(', '));
}

function createSlidesSection(props) {
    const types = [
        { key: 'straight_slide', name: 'Straight' }, { key: 'spiral_slide', name: 'Spiral/Curved' },
        { key: 'tube_slide', name: 'Tube' }, { key: 'double_slide', name: 'Double' },
        { key: 'triple_slide', name: 'Triple' }
    ];
    const slides = []; let total = 0;
    types.forEach(({ key, name }) => { const c = parseIntSafe(props[key]); if (c) { slides.push(name); total += c; } });
    if (!slides.length) return '';
    return createHoverableSection('Slides', props.uid, '🛝'.repeat(Math.min(total, 10)), slides.join(', '));
}

function createClimbingSection(props) {
    const types = [
        { key: 'stairs', name: 'Stairs' }, { key: 'metal_ladder', name: 'Metal Ladder' },
        { key: 'rope_ladder', name: 'Rope/Chain' }, { key: 'rock_climbing', name: 'Rock' },
        { key: 'monkey_bars', name: 'Monkey Bars' }, { key: 'rope_gym', name: 'Rope Gym' },
        { key: 'other_climbing', name: 'Other' }
    ];
    const items = []; let total = 0;
    types.forEach(({ key, name }) => { const c = parseIntSafe(props[key]); if (c) { items.push(name); total += c; } });
    if (!items.length) return '';
    return createHoverableSection('Climbing', props.uid, '🧗'.repeat(Math.min(total, 10)), items.join(', '));
}

function createBalanceSection(props) {
    const types = [
        { key: 'spinning_pole', name: 'Spinning Pole' }, { key: 'spinning_bucket', name: 'Spinning Bucket' },
        { key: 'merry_go_round', name: 'Merry Go Round' }, { key: 'balance_beam', name: 'Balance Beam' },
        { key: 'stepping_stones', name: 'Stepping Stones' }, { key: 'spring_rocker', name: 'Spring Rocker' },
        { key: 'seesaw', name: 'Seesaw' }
    ];
    const items = []; let total = 0;
    types.forEach(({ key, name }) => { const c = parseIntSafe(props[key]); if (c) { items.push(name); total += c; } });
    if (!items.length) return '';
    return createHoverableSection('Balance', props.uid, '⚖️'.repeat(Math.min(total, 10)), items.join(', '));
}

function createOtherEquipmentSection(props) {
    const types = [
        { key: 'flying_fox', name: 'Flying Fox', useHasValue: true },
        { key: 'firemans_pole', name: 'Firemans Pole' }, { key: 'bridge', name: 'Bridge' },
        { key: 'tunnel', name: 'Tunnel' }, { key: 'trampoline', name: 'Trampoline' },
        { key: 'hamster_wheel', name: 'Hamster or Roller Wheel' }
    ];
    const items = []; let total = 0;
    types.forEach(({ key, name, useHasValue }) => {
        const c = useHasValue ? (hasValue(props[key]) ? 1 : 0) : parseIntSafe(props[key]);
        if (c) { items.push(name); total += c; }
    });
    if (!items.length) return '';
    return createHoverableSection('Other', props.uid, '🎠'.repeat(Math.min(total, 10)), items.join(', '));
}

function createActivitiesSection(props) {
    const types = [
        { key: 'musical_play', emoji: '🎵', name: 'Musical Play' },
        { key: 'talking_tube', emoji: '📞', name: 'Talking Tube' },
        { key: 'activity_wall', emoji: '🧩', name: 'Activity Wall' },
        { key: 'sensory_play', emoji: '🤏', name: 'Sensory Play' },
        { key: 'sandpit', emoji: '🏖️', name: 'Sandpit' },
        { key: 'water_play', emoji: '💦', name: 'Water Play' },
        { key: 'basketball', emoji: '🏀', name: 'Basketball' },
        { key: 'tennis_court', emoji: '🎾', name: 'Tennis' },
        { key: 'skate_park', emoji: '🛹', name: 'Skate Park' },
        { key: 'scooter_track', emoji: '🛴', name: 'Scooter Track' },
        { key: 'pump_track', emoji: '🚂', name: 'Pump Track' },
        { key: 'cricket_net', emoji: '🏏', name: 'Cricket' }
    ];
    const activities = types.filter(({ key }) => hasValue(props[key])).map(({ emoji, name }) => `${emoji} ${name}`);
    return activities.length ? `<div style="margin-bottom:6px;">${activities.join(', ')}</div>` : '';
}

function createHoverableSection(category, uid, emojis, details) {
    const cat = category.toLowerCase().replace(/\s+/g, '-');
    return `
        <div style="margin-bottom:4px;">
            <span id="${cat}-word-${uid}" style="color:var(--text-primary);cursor:help;"
                onmouseenter="highlightSection('${cat}','${uid}')" onmouseleave="unhighlightSection('${cat}','${uid}')"
                ontouchstart="highlightSection('${cat}','${uid}')" ontouchend="setTimeout(()=>unhighlightSection('${cat}','${uid}'),2000)">
                ${category}
            </span>
            <span id="${cat}-emoji-${uid}" style="cursor:help;"
                onmouseenter="highlightSection('${cat}','${uid}')" onmouseleave="unhighlightSection('${cat}','${uid}')"
                ontouchstart="highlightSection('${cat}','${uid}')" ontouchend="setTimeout(()=>unhighlightSection('${cat}','${uid}'),2000)">
                ${emojis}
            </span>
            <span id="${cat}-details-${uid}" style="color:var(--primary);margin-left:8px;display:none;">${details}</span>
        </div>
    `;
}

// ===== DROPDOWN FUNCTIONALITY =====

function toggleDropdown(menuId) {
    const menu = document.getElementById(menuId);
    if (!menu) return;
    document.querySelectorAll('.dropdown-menu').forEach(d => { if (d.id !== menuId) d.classList.add('hidden'); });
    menu.classList.toggle('hidden');
}

function toggleAllItems(allCheckboxId, itemCheckboxClass, updateFunction) {
    const allCheckbox = document.getElementById(allCheckboxId);
    document.querySelectorAll(itemCheckboxClass).forEach(cb => { cb.checked = allCheckbox.checked; });
    updateFunction();
}

function updateSelection(itemCheckboxClass, allCheckboxId, selectedSpanId, allText, updateFunction) {
    const itemCheckboxes = document.querySelectorAll(itemCheckboxClass);
    const allCheckbox = document.getElementById(allCheckboxId);
    const selectedItems = Array.from(itemCheckboxes).filter(cb => cb.checked);
    const selectedSpan = document.getElementById(selectedSpanId);

    if (selectedItems.length === 0) {
        allCheckbox.indeterminate = false; allCheckbox.checked = false;
        selectedSpan.textContent = allText;
    } else if (selectedItems.length === itemCheckboxes.length) {
        allCheckbox.indeterminate = false; allCheckbox.checked = true;
        selectedSpan.textContent = allText;
    } else {
        allCheckbox.indeterminate = true; allCheckbox.checked = false;
        if (selectedItems.length === 1) {
            selectedSpan.textContent = selectedItems[0].value;
        } else {
            const type = allText.split(' ')[1].toLowerCase();
            selectedSpan.textContent = `${selectedItems.length} ${type} selected`;
        }
    }
    updateFunction();
}

function getSelectedValues(checkboxClass) {
    return Array.from(document.querySelectorAll(`${checkboxClass}:checked`)).map(cb => cb.value);
}

function toggleAllTypes()    { toggleAllItems('allTypes',   '.type-checkbox',    updateTypeSelection); }
function toggleAllShade()    { toggleAllItems('allshades',  '.shade-checkbox',   updateShadeSelection); }
function toggleAllFencing()  { toggleAllItems('allfencing', '.fence-checkbox',   updateFencingSelection); }
function toggleAllParking()  { toggleAllItems('allparking', '.parking-checkbox', updateParkingSelection); }

function updateTypeSelection()    { updateSelection('.type-checkbox',    'allTypes',   'typeSelected',    'All types',    filterMarkers); }
function updateShadeSelection()   { updateSelection('.shade-checkbox',   'allshades',  'shadeSelected',   'Any shade',    filterMarkers); }
function updateFencingSelection() { updateSelection('.fence-checkbox',   'allfencing', 'fenceSelected',   'Any fencing',  filterMarkers); }
function updateParkingSelection() { updateSelection('.parking-checkbox', 'allparking', 'parkingSelected', 'Any parking',  filterMarkers); }

function getSelectedTypes()   { return getSelectedValues('.type-checkbox'); }
function getSelectedShade()   { return getSelectedValues('.shade-checkbox'); }
function getSelectedFencing() { return getSelectedValues('.fence-checkbox'); }
function getSelectedParking() { return getSelectedValues('.parking-checkbox'); }

// ===== MULTI-SELECT SEARCH FUNCTIONALITY =====

function initialiseMultiSelectSearch(inputId, dropdownId, allItemsArray, selectedItemsArray, itemType) {
    const input    = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;

    input.addEventListener('input', function () {
        const term = this.value.trim().toLowerCase();
        if (!term) { dropdown.classList.add('hidden'); return; }
        const matches = allItemsArray.filter(i => i.toLowerCase().includes(term));
        if (matches.length) {
            displayItemDropdown(dropdown, matches, selectedItemsArray, itemType);
        } else {
            dropdown.classList.add('hidden');
        }
    });

    document.addEventListener('click', e => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.classList.add('hidden');
    });
}

function displayItemDropdown(dropdown, items, selectedItemsArray, itemType) {
    dropdown.innerHTML = '';
    dropdown.classList.remove('hidden');
    items.forEach(item => {
        const option = document.createElement('div');
        option.className = 'dropdown-option';
        option.textContent = item;
        option.addEventListener('click', () => selectItem(item, selectedItemsArray, itemType));
        dropdown.appendChild(option);
    });
}

function selectItem(item, selectedItemsArray, itemType) {
    if (selectedItemsArray.includes(item)) return;
    selectedItemsArray.push(item);
    updateSelectedItemsDisplay(selectedItemsArray, itemType);
    const input    = document.getElementById(`${itemType}SearchInput`);
    const dropdown = document.getElementById(`${itemType}Dropdown`);
    if (input)    input.value = '';
    if (dropdown) dropdown.classList.add('hidden');
    filterMarkers();
}

function removeItem(item, selectedItemsArray, itemType) {
    const idx = selectedItemsArray.indexOf(item);
    if (idx > -1) selectedItemsArray.splice(idx, 1);
    updateSelectedItemsDisplay(selectedItemsArray, itemType);
    filterMarkers();
}

function clearAllItems(selectedItemsArray, itemType) {
    selectedItemsArray.length = 0;
    updateSelectedItemsDisplay(selectedItemsArray, itemType);
    filterMarkers();
}

function updateSelectedItemsDisplay(selectedItemsArray, itemType) {
    const containerId = `selected${itemType.charAt(0).toUpperCase() + itemType.slice(1)}s`;
    const container = document.getElementById(containerId);
    if (!container) return;

    const wrapper = container.closest('.mt-2');
    container.innerHTML = '';

    if (!selectedItemsArray.length) {
        const placeholder = document.createElement('span');
        placeholder.className = 'keyword-placeholder';
        placeholder.textContent = `No ${itemType}s selected`;
        container.appendChild(placeholder);
        if (wrapper) wrapper.style.display = 'none';
        return;
    }

    selectedItemsArray.forEach(item => {
        const tag       = document.createElement('div'); tag.className = 'keyword-tag';
        const text      = document.createElement('span'); text.textContent = item; text.className = 'keyword-tag-text';
        const removeBtn = document.createElement('button'); removeBtn.innerHTML = '×'; removeBtn.className = 'keyword-tag-remove';
        removeBtn.addEventListener('click', () => removeItem(item, selectedItemsArray, itemType));
        tag.appendChild(text); tag.appendChild(removeBtn);
        container.appendChild(tag);
    });

    if (wrapper) wrapper.style.display = 'block';
}

function initialiseSuburbSearch()  { initialiseMultiSelectSearch('suburbSearchInput',  'suburbDropdown',  allSuburbs,  selectedSuburbs,  'suburb');  }
function initialiseLGASearch()     { initialiseMultiSelectSearch('lgaSearchInput',     'lgaDropdown',     allLGAs,     selectedLGAs,     'lga');     }
function initialiseKeywordSearch() { initialiseMultiSelectSearch('keywordSearchInput', 'keywordDropdown', allKeywords, selectedKeywords, 'keyword'); }

function clearAllSuburbs()   { clearAllItems(selectedSuburbs,  'suburb');  }
function clearAllLGAs()      { clearAllItems(selectedLGAs,     'lga');     }
function clearAllKeywords()  { clearAllItems(selectedKeywords, 'keyword'); }

function playgroundMatchesKeywords(playground) {
    if (!selectedKeywords.length) return true;
    if (!playground.keywords?.trim()) return false;
    const list = playground.keywords.split(',').map(k => k.trim().toLowerCase());
    return selectedKeywords.some(k => list.includes(k.toLowerCase()));
}

// ===== SIZE SLIDER =====

function getSizeColor(sizeCategory) {
    if (['Unverified', 'Unsure If Exists', 'Exists: Not Digitally Classifiable'].includes(sizeCategory)) {
        return sizeConfigs.marker['Unverified'].fillColor;
    }
    return sizeConfigs.marker[sizeCategory]?.fillColor || '#6b7280';
}

const visualSliderOrder = ['Unverified', 'Under Construction', 'Tiny', 'Small', 'Medium', 'Large', 'Super'];
const visualToActualCategories = {
    0: ['Unverified', 'Unsure If Exists', 'Exists: Not Digitally Classifiable'],
    1: ['Under Construction'],
    2: ['Tiny'], 3: ['Small'], 4: ['Medium'], 5: ['Large'], 6: ['Super']
};

function initialiseSizeSlider() {
    const slider = document.getElementById('sizeSlider');
    if (!slider) return;

    slider.classList.add('size-slider-track');
    noUiSlider.create(slider, {
        start: [0, visualSliderOrder.length - 1],
        connect: true,
        range: { min: 0, max: visualSliderOrder.length - 1 },
        step: 1
    });

    slider.noUiSlider.on('update', (values) => {
        const minIdx = Math.round(values[0]);
        const maxIdx = Math.round(values[1]);
        document.getElementById('sizeSliderMinLabel').textContent = sizeSliderConfig.labels[visualSliderOrder[minIdx]];
        document.getElementById('sizeSliderMaxLabel').textContent = sizeSliderConfig.labels[visualSliderOrder[maxIdx]];
        const handles = slider.querySelectorAll('.noUi-handle');
        if (handles.length >= 2) {
            handles[0].style.background = getSizeColor(visualSliderOrder[minIdx]);
            handles[1].style.background = getSizeColor(visualSliderOrder[maxIdx]);
        }
        filterMarkers();
    });

    const handles = slider.querySelectorAll('.noUi-handle');
    if (handles.length >= 2) {
        handles[0].style.background = getSizeColor('Unverified');
        handles[1].style.background = getSizeColor('Super');
    }
}

function getSelectedSizesFromSlider() {
    const slider = document.getElementById('sizeSlider');
    if (!slider?.noUiSlider) return [...sizeSliderConfig.order];
    const values = slider.noUiSlider.get();
    const minIdx = Math.round(parseFloat(values[0]));
    const maxIdx = Math.round(parseFloat(values[1]));
    let selected = [];
    for (let i = minIdx; i <= maxIdx; i++) selected.push(...visualToActualCategories[i]);
    return selected;
}

function isSizeIncluded(classification) {
    const selected = getSelectedSizesFromSlider();
    const norm = (!classification || !sizeSliderConfig.order.includes(classification)) ? 'Unverified' : classification;
    return selected.includes(norm);
}

// ===== FILTERING =====

function filterMarkers() {
    if (!searchIndex?.length) { console.warn('Search index not loaded yet'); return; }

    const filters = getActiveFilters();
    markerClusterGroup.clearLayers();

    const filteredIds = new Set(
        searchIndex.filter(p => shouldShowPlayground(p, filters)).map(p => p.uid)
    );

    playgroundData?.forEach(playground => {
        if (filteredIds.has(playground.uid)) markerClusterGroup.addLayer(createMarker(playground));
    });

    updateTopicCount();
}

function updatePlaygroundCount(count) {
    document.querySelectorAll('.playgroundCount').forEach(el => {
        el.textContent = `${count} playground${count !== 1 ? 's' : ''}`;
    });
}

function getActiveFilters() {
    return {
        hasTrampoline:        document.getElementById('filterHasTrampoline')?.checked || false,
        hasSkatePark:         document.getElementById('filterHasSkatePark')?.checked || false,
        hasLargeFlyingFox:    document.getElementById('filterHasLargeFlyingFox')?.checked || false,
        hasSandpit:           document.getElementById('filterHasSandpit')?.checked || false,
        hasScootTrack:        document.getElementById('filterHasScootTrack')?.checked || false,
        hasWaterPlay:         document.getElementById('filterHasWaterPlay')?.checked || false,
        hasAccessibleFeatures:document.getElementById('filterHasAccessibleFeatures')?.checked || false,
        hasToilet:            document.getElementById('filterHasToilet')?.checked || false,
        hasBBQ:               document.getElementById('filterHasBBQ')?.checked || false,
        hasBubbler:           document.getElementById('filterHasBubbler')?.checked || false,
        selectedShade:        getSelectedShade(),
        selectedParking:      getSelectedParking(),
        selectedFencing:      getSelectedFencing(),
        selectedSuburbs, selectedLGAs,
        selectedTypes:        getSelectedTypes()
    };
}

function shouldShowPlayground(playground, filters) {
    if (filters.hasTrampoline        && Number(playground.trampoline) <= 0)       return false;
    if (filters.hasSkatePark         && playground.skate_park !== true)            return false;
    if (filters.hasLargeFlyingFox    && playground.flying_fox !== 'Large')         return false;
    if (filters.hasSandpit           && playground.sandpit !== true)               return false;
    if (filters.hasScootTrack        && playground.scooter_track !== true)         return false;
    if (filters.hasWaterPlay         && playground.water_play !== true)            return false;
    if (filters.hasAccessibleFeatures && playground.accessible !== true)           return false;
    if (filters.hasToilet            && playground.toilet !== true)                return false;
    if (filters.hasBBQ               && playground.bbq !== true)                   return false;
    if (filters.hasBubbler           && playground.bubbler !== true)               return false;

    const classification = playground.classification || 'Unverified';
    if (!isSizeIncluded(classification)) return false;

    if (filters.selectedSuburbs.length  && !filters.selectedSuburbs.includes(playground.suburb))    return false;
    if (filters.selectedLGAs.length     && !filters.selectedLGAs.includes(playground.lga))          return false;
    if (filters.selectedTypes.length    && !filters.selectedTypes.includes(playground.type))        return false;
    if (filters.selectedShade.length    && !filters.selectedShade.includes(playground.shade))       return false;
    if (filters.selectedFencing.length  && !filters.selectedFencing.includes(playground.fencing))   return false;
    if (filters.selectedParking.length  && !filters.selectedParking.includes(playground.parking))   return false;
    if (!playgroundMatchesKeywords(playground))                                                      return false;

    return true;
}

//Events filtering //
function filterEvents() {
    if (!eventsData?.length) return;

    const futureOnly      = document.getElementById('filterEventsFutureOnly')?.checked;
    const dateFrom        = document.getElementById('filterEventsDateFrom')?.value;
    const dateTo          = document.getElementById('filterEventsDateTo')?.value;
    const selCategories   = Array.from(document.querySelectorAll('.event-category-cb:checked')).map(cb => cb.value);
    const selTypes        = Array.from(document.querySelectorAll('.event-type-cb:checked')).map(cb => cb.value);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate   = dateTo   ? new Date(dateTo + 'T23:59:59') : null;

    eventsClusterGroup.clearLayers();

    eventsData.forEach(event => {
        const eventDate = event.start_datetime ? new Date(event.start_datetime) : parseEventDate(event.formatteddatetime);

        // Future-only gate
        if (futureOnly && eventDate && eventDate < today) return;

        // Date-from gate
        if (fromDate && eventDate && eventDate < fromDate) return;

        // Date-to gate
        if (toDate && eventDate && eventDate > toDate) return;

        // Category gate
        if (selCategories.length && !selCategories.includes(event.display_category)) return;

        // Type gate (event_type is array-ish)
        if (selTypes.length) {
            const types = parseArrayField(event.event_type);
            if (!types.some(t => selTypes.includes(t))) return;
        }

        if (event.latitude != null && event.longitude != null) {
            eventsClusterGroup.addLayer(createEventMarker(event));
        }
    });

    updateTopicCount();
}

// Parse the formatteddatetime string — handles common AU formats
function parseEventDate(str) {
    if (!str) return null;
    try {
        // "Saturday, 5 April 2025 10:00am"
        // new Date() handles many formats, including ISO
        const d = new Date(str);
        return isNaN(d) ? null : d;
    } catch { return null; }
}


// ===== LIBRARY MARKERS =====

function createLibraryMarker(library) {
    const marker = L.marker([library.latitude, library.longitude], {
        icon: L.divIcon({
            html: `<div style="width:15px;height:15px;background:#ef4444;border:2px solid #ffffff;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`,
            className: 'library-marker', iconSize: [20, 20], iconAnchor: [10, 10]
        })
    });
    marker.bindPopup(createLibraryPopupContent(library));
    marker.bindTooltip(library.name || 'Unnamed Library', {
        permanent: false, direction: 'top', offset: [0, -10], className: 'playground-tooltip'
    });
    marker.libraryData = library;
    return marker;
}

function createLibraryPopupContent(library) {
    const mapsIcon = library.latitude && library.longitude
        ? `<a href="https://www.google.com/maps?q=${library.latitude},${library.longitude}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;margin-left:4px;">📍</a>`
        : '';
    const title = library.website
        ? `<a href="${library.website}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">${library.name} 🔗</a>`
        : library.name;
    return `
        <div style="font-family:system-ui,-apple-system,sans-serif;min-width:300px;padding:12px;">
            <div style="margin-bottom:8px;">
                <h3 style="font-weight:bold;font-size:var(--font-size-lg);margin:0;">${title}${mapsIcon}</h3>
                ${library.address ? `<div style="font-style:italic;margin-top:2px;">${library.address}</div>` : ''}
            </div>
            ${library.open ? `<div style="margin-bottom:6px;">🕧 <strong>Open:</strong> ${library.open}</div>` : ''}
        </div>
    `;
}

function addLibrariesToMap() {
    if (!librariesData?.length || !librariesClusterGroup) return;
    librariesClusterGroup.clearLayers();
    librariesData.forEach(library => {
        if (library.latitude != null && library.longitude != null) {
            librariesClusterGroup.addLayer(createLibraryMarker(library));
        }
    });
}

//Library filtering
function filterLibraries() {
    if (!librariesData?.length) return;

    // const openNow = document.getElementById('filterLibrariesOpenNow')?.checked;
    // Parsing opening hours reliably requires knowing the data format —
    // add logic here once the field format is confirmed.

    librariesClusterGroup.clearLayers();
    librariesData.forEach(lib => {
        if (lib.latitude != null && lib.longitude != null) {
            librariesClusterGroup.addLayer(createLibraryMarker(lib));
        }
    });

    updateTopicCount();
}


async function loadLibrariesData() {
    try {
        const response = await fetch('/api/libraries');
        const result   = await response.json();
        if (!response.ok) throw new Error(result.error);
        librariesData = result.data;
        console.log(`✅ Loaded ${librariesData.length} libraries`);
        if (librariesData.length) addLibrariesToMap();
    } catch (err) {
        console.error('Failed to load libraries data:', err);
    }
}

function createLibraryClusterIcon(cluster) {
    const count = cluster.getChildCount();
    let size, fontSize;
    if      (count < 10)  { size = 25; fontSize = 12; }
    else if (count < 50)  { size = 35; fontSize = 14; }
    else if (count < 100) { size = 45; fontSize = 16; }
    else                  { size = 65; fontSize = 18; }
    return L.divIcon({
        html: `<div style="background:#ef4444;border:3px solid #b91c1c;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-weight:bold;color:white;font-size:${fontSize}px;box-shadow:0 2px 8px rgba(0,0,0,0.3);">${count}</div>`,
        className: 'library-cluster-icon', iconSize: [size, size], iconAnchor: [size / 2, size / 2]
    });
}

// ===== EVENT MARKERS =====

const EVENT_CATEGORY_COLORS = { 'council': '#3b82f6', 'playgroups': '#542a7b', 'other': '#8c0052' };

function createEventMarker(event) {
    const fillColor = EVENT_CATEGORY_COLORS[event.display_category] || '#3b82f6';
    const marker = L.marker([event.latitude, event.longitude], {
        icon: L.divIcon({
            html: `<div style="width:24px;height:24px;position:relative;"><svg viewBox="0 0 24 24" width="24" height="24" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="${fillColor}" stroke="#ffffff" stroke-width="1.5"/></svg></div>`,
            className: 'event-star-marker', iconSize: [24, 24], iconAnchor: [12, 12]
        })
    });
    marker.bindPopup(createEventPopupContent(event));
    if (window.innerWidth > 768) {
        marker.bindTooltip(event.subject || 'Unnamed Event', {
            permanent: false, direction: 'top', offset: [0, -10], className: 'playground-tooltip'
        });
    }
    marker.eventData = event;
    return marker;
}

function parseArrayField(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        if (value.startsWith('{')) {
            return value.replace(/[{}]/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        }
        try { return JSON.parse(value); } catch { return [value]; }
    }
    return [];
}

function createEventPopupContent(event) {
    const ageRanges  = parseArrayField(event.agerange);
    const eventTypes = parseArrayField(event.event_type);
    const mapsIcon   = event.latitude && event.longitude
        ? `<a href="https://www.google.com/maps?q=${event.latitude},${event.longitude}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;margin-left:4px;">📍</a>`
        : '';
    const title = event.web_link
        ? `<a href="${event.web_link}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">${event.subject} 🔗</a>`
        : event.subject;
    return `
        <div style="font-family:system-ui,-apple-system,sans-serif;min-width:300px;padding:12px;">
            <div style="margin-bottom:8px;">
                <h3 style="font-weight:bold;font-size:var(--font-size-lg);margin:0;">${title}${mapsIcon}</h3>
                ${event.formatteddatetime ? `<div style="font-style:italic;margin-top:2px;">📅 ${event.formatteddatetime}</div>` : ''}
            </div>
            ${ageRanges.length  ? `<div style="margin-bottom:6px;">👶 <strong>Ages:</strong> ${ageRanges.join(', ')}</div>` : ''}
            ${eventTypes.length ? `<div style="margin-bottom:6px;">🎯 <strong>Type:</strong> ${eventTypes.join(', ')}</div>` : ''}
            ${event.cost               ? `<div style="margin-bottom:6px;">💰 <strong>Cost:</strong> ${event.cost}</div>` : ''}
            ${event.bookingsrequired   ? `<div style="margin-bottom:6px;">📝 <strong>Bookings:</strong> ${event.bookingsrequired}</div>` : ''}
            ${event.location           ? `<div style="margin-bottom:6px;">📍 ${event.location}</div>` : ''}
        </div>
    `;
}

function addEventsToMap() {
    if (!eventsData?.length) return;
    eventsClusterGroup.clearLayers();
    eventsData.forEach(event => {
        if (event.latitude != null && event.longitude != null) {
            eventsClusterGroup.addLayer(createEventMarker(event));
        }
    });
}

function createEventClusterIcon(cluster) {
    const count = cluster.getChildCount();
    let size, fontSize, starSize;
    if      (count < 10)  { size = 45; fontSize = 13; starSize = 36; }
    else if (count < 50)  { size = 55; fontSize = 15; starSize = 46; }
    else if (count < 100) { size = 65; fontSize = 17; starSize = 56; }
    else                  { size = 75; fontSize = 19; starSize = 66; }
    return L.divIcon({
        html: `<div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 24 24" width="${starSize}" height="${starSize}" style="position:absolute;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.4));"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="#3b82f6" stroke="#1e40af" stroke-width="1.5"/></svg><div style="position:relative;z-index:1;font-weight:bold;color:white;font-size:${fontSize}px;text-shadow:0 1px 3px rgba(0,0,0,0.5);">${count}</div></div>`,
        className: 'custom-cluster-icon', iconSize: [size, size], iconAnchor: [size / 2, size / 2]
    });
}

async function loadEventsData() {
    try {
        const response = await fetch('/api/events');
        const result   = await response.json();
        if (!response.ok) throw new Error(result.error);
        eventsData = result.data;
        console.log(`✅ Loaded ${eventsData.length} events`);
        if (eventsData.length) {
            addEventsToMap();
        }
    } catch (err) {
        console.error('Failed to load events data:', err);
    }
}


// ===== SEARCH INDEX (filters/dropdowns — loads independently of viewport) =====

async function loadSearchIndex() {
    try {
        console.log('Loading search index...');
        const response = await fetch('/api/search-index');
        const result   = await response.json();
        if (!response.ok) throw new Error(result.error);

        searchIndex = result.data;
        console.log(`✅ Search index loaded: ${searchIndex.length} records`);

        // Extract filter options
        allSuburbs       = extractUniqueValues(searchIndex, 'suburb');
        allLGAs          = extractUniqueValues(searchIndex, 'lga');
        allTypes         = extractUniqueValues(searchIndex, 'type');
        allShadeOptions  = extractUniqueValues(searchIndex, 'shade');
        allFencingOptions = extractUniqueValues(searchIndex, 'fencing');
        allParkingOptions = extractUniqueValues(searchIndex, 'parking');
        allSeatingOptions = extractUniqueValues(searchIndex, 'seating');
        allFloorOptions  = extractUniqueValues(searchIndex, 'floor');
        allVerifiedOptions = extractUniqueValues(searchIndex, 'verified');
        allFoxOptions    = extractUniqueValues(searchIndex, 'flying_fox');

        const keywordSets = searchIndex
            .map(p => p.keywords).filter(Boolean)
            .flatMap(k => k.split(',').map(kw => kw.trim()));
        allKeywords = [...new Set(keywordSets)].sort();

        // Initialise search UI
        initialiseKeywordSearch();
        initialiseSuburbSearch();
        initialiseLGASearch();

        // Populate filter dropdowns
        populateDropdowns();
        populateEditFormDropdowns();
        dropdownsInitialized = true;
        searchIndexLoaded = true;

        // If viewport data already loaded (race condition), refresh markers now
        if (playgroundData?.length) filterMarkers();

    } catch (error) {
        console.error('Error loading search index:', error);
    }
}

// ===== VIEWPORT DATA LOADING =====

async function loadVisiblePlaygrounds() {
    if (isLoadingPlaygrounds) return;
    isLoadingPlaygrounds = true;

    try {
        const bounds = map.getBounds().pad(0.5);
        const params = new URLSearchParams({
            min_lat: bounds.getSouth(), max_lat: bounds.getNorth(),
            min_lng: bounds.getWest(),  max_lng: bounds.getEast()
        });

        const boundsKey = `${bounds.getSouth().toFixed(2)},${bounds.getWest().toFixed(2)},${bounds.getNorth().toFixed(2)},${bounds.getEast().toFixed(2)}`;
        if (loadedBounds.has(boundsKey)) {
            console.log('Already loaded this viewport');
            isLoadingPlaygrounds = false;
            return;
        }

        const response = await fetch(`/api/playgrounds?${params}`);
        const result   = await response.json();
        if (!response.ok) throw new Error(result.error);

        result.data.forEach(playground => {
            if (!allLoadedPlaygrounds.find(p => p.uid === playground.uid)) {
                allLoadedPlaygrounds.push(playground);
                playgroundLookup[playground.uid] = playground;
            }
        });

        playgroundData = allLoadedPlaygrounds;
        console.log(`✅ Loaded ${result.data.length} playgrounds for viewport (${allLoadedPlaygrounds.length} total cached)`);

        filterMarkers();

        if (playgroundsVisible && !map.hasLayer(markerClusterGroup)) map.addLayer(markerClusterGroup);

        loadedBounds.add(boundsKey);
        if (loadedBounds.size > 20) clearOldCache();

    } catch (error) {
        console.error('❌ Error loading playgrounds:', error);
    } finally {
        isLoadingPlaygrounds = false;
    }
}

function clearOldCache() {
    console.log('Clearing marker cache');
    loadedBounds.clear();
    allLoadedPlaygrounds = [];
    playgroundData = [];
    playgroundLookup = {};
    markerClusterGroup.clearLayers();
}

// ===== DROPDOWN POPULATION =====

function populateDropdowns() {
    const typesSorted    = sortWithCustomOrder([...allTypes],         ['Council Playground', 'Private Playground', 'School Playground']);
    const shadeSorted    = sortWithCustomOrder([...allShadeOptions],  ['Natural and Sail', 'Sail', 'Natural', 'No Shade']);
    const fencingSorted  = sortWithCustomOrder([...allFencingOptions],['Fully Fenced', 'Partially Fenced', 'Natural Fence', 'No Fence']);

    populateDropdownOptions('typeOptions',    typesSorted,      'type-checkbox',    updateTypeSelection, 'Council Playground');
    populateDropdownOptions('shadeOptions',   shadeSorted,      'shade-checkbox',   updateShadeSelection);
    populateDropdownOptions('fencingOptions', fencingSorted,    'fence-checkbox',   updateFencingSelection);
    populateDropdownOptions('parkingOptions', allParkingOptions,'parking-checkbox', updateParkingSelection);
}

function populateDropdownOptions(containerId, values, checkboxClass, onchangeFunction, defaultValue = null) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    values.forEach(value => {
        const label    = document.createElement('label'); label.className = 'dropdown-option';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.className = checkboxClass; checkbox.value = value;
        checkbox.onchange = onchangeFunction;
        if (value === defaultValue) checkbox.checked = true;
        const span = document.createElement('span'); span.textContent = value;
        label.appendChild(checkbox); label.appendChild(span);
        container.appendChild(label);
    });

    if (defaultValue) {
        const selectedSpan = document.getElementById(containerId.replace('Options', 'Selected'));
        if (selectedSpan) selectedSpan.textContent = defaultValue;
    }
}

// ===== DESKTOP SIDEBAR COLLAPSE =====

function toggleSidebarCollapse() {
    if (window.innerWidth > 768) {
        const sidebar = document.querySelector('.w-80.bg-white.shadow-lg.overflow-y-auto');
        if (sidebar) {
            sidebar.classList.toggle('collapsed');
            sessionStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
            setTimeout(() => map?.invalidateSize(true), 350);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    sessionStorage.removeItem('sidebarCollapsed');
    if (window.innerWidth > 768) {
        document.querySelector('.w-80.bg-white.shadow-lg.overflow-y-auto')?.classList.remove('collapsed');
    }
});

window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
        document.querySelector('.w-80.bg-white.shadow-lg.overflow-y-auto')?.classList.remove('collapsed');
    }
});

// ===== EDIT FORM DROPDOWNS =====

function populateEditFormDropdowns() {
    if (!searchIndex?.length) { console.warn('No search index to populate form dropdowns'); return; }

    const seatingSorted = sortWithCustomOrder([...allSeatingOptions], ['Picnic Tables and Benches', 'Picnic Tables', 'Benches', 'Limited', 'None']);
    const floorSorted   = sortWithCustomOrder([...allFloorOptions],   ['Softfall', 'Artificial Turf', 'Natural Turf', 'Mulch', 'Sand', 'Concrete', 'Other']);
    const typesSorted   = sortWithCustomOrder([...allTypes],          ['Council Playground', 'Private Playground', 'School Playground']);
    const shadeSorted   = sortWithCustomOrder([...allShadeOptions],   ['Natural and Sail', 'Sail', 'Natural', 'No Shade']);
    const fencingSorted = sortWithCustomOrder([...allFencingOptions], ['Fully Fenced', 'Partially Fenced', 'Natural Fence', 'No Fence']);
    const foxSorted     = sortWithCustomOrder([...allFoxOptions],     ['None', 'Small', 'Large']);

    populateFormDropdown('edit-type',      typesSorted);
    populateFormDropdown('edit-shade',     shadeSorted);
    populateFormDropdown('edit-fencing',   fencingSorted);
    populateFormDropdown('edit-parking',   allParkingOptions);
    populateFormDropdown('edit-seating',   seatingSorted);
    populateFormDropdown('edit-floor',     floorSorted);
    populateFormDropdown('edit-verified',  allVerifiedOptions);
    populateFormDropdown('edit-flying_fox',foxSorted);
}

function populateFormDropdown(selectId, options) {
    const el = document.getElementById(selectId);
    if (!el) return;
    while (el.options.length > 1) el.remove(1);
    options.forEach(value => {
        if (value) {
            const opt = document.createElement('option'); opt.value = value; opt.textContent = value;
            el.appendChild(opt);
        }
    });
}

// ===== EDIT MODAL =====

async function editPlayground(uniqueId) {
    const normalizedId = uniqueId?.toString().trim();
    let data = playgroundLookup[normalizedId];

    // If we only have the lightweight search-index record, fetch the full row
    if (!data || !data.hasOwnProperty('seating')) {
        const { data: fullData, error } = await supabaseClient
            .from('playgrounds_main').select('*').eq('uid', normalizedId).single();
        if (error) { console.error('Error loading playground:', error); alert('Failed to load playground details'); return; }
        data = fullData;
        playgroundLookup[normalizedId] = data;
    }

    currentEditingPlayground = { uid: normalizedId, data };
    populateEditForm(data);
    initialiseEditModalKeywords();
    populateEditModalKeywords(data);
    document.getElementById('editModal').style.display = 'block';
}

function populateEditForm(data) {
    ['name', 'keywords', 'comments', 'link'].forEach(field => {
        const el = document.getElementById(`edit-${field}`);
        if (el) el.value = data[field] || '';
    });

    ['type', 'shade', 'parking', 'fencing', 'seating', 'floor', 'verified', 'flying_fox'].forEach(field => {
        const el = document.getElementById(`edit-${field}`);
        if (el) el.value = data[field] || '';
    });

    [
        'toilet', 'bbq', 'bubbler', 'accessible', 'basketball', 'skate_park', 'scooter_track',
        'cricket_net', 'tennis_court', 'pump_track', 'activity_wall', 'talking_tube',
        'musical_play', 'sensory_play', 'sandpit', 'water_play'
    ].forEach(field => {
        const el = document.getElementById(`edit-${field}`);
        if (el) el.checked = data[field] === true;
    });

    [
        'baby_swing', 'belt_swing', 'basket_swing', 'dual_swing', 'hammock',
        'straight_slide', 'spiral_slide', 'tube_slide', 'double_slide', 'triple_slide',
        'stairs', 'metal_ladder', 'rope_ladder', 'rock_climbing', 'monkey_bars', 'other_climbing', 'rope_gym',
        'spinning_pole', 'spinning_bucket', 'merry_go_round', 'balance_beam', 'stepping_stones', 'spring_rocker', 'seesaw',
        'bridge', 'tunnel', 'trampoline', 'firemans_pole', 'hamster_wheel'
    ].forEach(field => {
        const el = document.getElementById(`edit-${field}`);
        if (el) el.value = data[field] || '';
    });
}

function setupModalEventListeners() {
    const modal    = document.getElementById('editModal');
    const closeBtn = document.getElementById('closeModalBtn');
    setupPhotoInput();

    function closeModal() {
        modal.style.display = 'none';
        const header = modal.querySelector('.modal-header h2');
        const desc   = modal.querySelector('.modal-header p');
        if (header) header.textContent = 'Suggest Edit';
        if (desc)   desc.textContent   = 'Help keep playground info up to date';
        const photoInput = document.getElementById('edit-photo');
        const previewImg = document.getElementById('preview-img');
        const warningDiv = document.getElementById('photo-size-warning');
        if (photoInput) photoInput.value = '';
        if (previewImg) { previewImg.src = ''; previewImg.style.display = 'none'; }
        if (warningDiv) warningDiv.style.display = 'none';
        editModalSelectedKeywords = [];
        updateEditModalKeywordsDisplay();
        if (tempLocationMarker) { map.removeLayer(tempLocationMarker); tempLocationMarker = null; }
    }

    if (closeBtn) closeBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); closeModal(); });
    window.addEventListener('click', e => { if (e.target === modal) closeModal(); });
}

// ===== ADD NEW PLAYGROUND =====

let isSelectingLocation = false;
let tempLocationMarker  = null;
let newPlaygroundCoords = null;

function initialiseAddNewPlayground() {
    const addBtn = document.getElementById('addNewPlaygroundBtn');
    if (addBtn) addBtn.addEventListener('click', toggleLocationSelection);
}

function toggleLocationSelection() {
    const addBtn       = document.getElementById('addNewPlaygroundBtn');
    const mapContainer = document.getElementById('map');
    isSelectingLocation = !isSelectingLocation;

    if (isSelectingLocation) {
        addBtn.textContent = '❌ Cancel Selection';
        addBtn.classList.add('active');
        mapContainer.classList.add('map-click-mode');
        map.on('click', handleMapClick);
        showNotification('Click anywhere on the map to select playground location', 'info');
    } else {
        deactivateLocationSelection();
    }
}

function handleMapClick(e) {
    if (!isSelectingLocation) return;
    const { lat, lng } = e.latlng;
    newPlaygroundCoords = { lat, lng };
    if (tempLocationMarker) map.removeLayer(tempLocationMarker);
    tempLocationMarker = L.marker([lat, lng], {
        icon: L.divIcon({ html: '<div class="temp-location-marker">📍</div>', className: 'temp-location-marker-container', iconSize: [32, 32], iconAnchor: [16, 32] })
    }).addTo(map);
    deactivateLocationSelection();
    openNewPlaygroundModal(lat, lng);
}

function deactivateLocationSelection() {
    const addBtn       = document.getElementById('addNewPlaygroundBtn');
    const mapContainer = document.getElementById('map');
    isSelectingLocation = false;
    addBtn.textContent = '➕ Record New Playground';
    addBtn.classList.remove('active');
    mapContainer.classList.remove('map-click-mode');
    map.off('click', handleMapClick);
}

function openNewPlaygroundModal(lat, lng) {
    const modal  = document.getElementById('editModal');
    const header = modal.querySelector('.modal-header h2');
    const desc   = modal.querySelector('.modal-header p');
    header.textContent = 'Add New Playground';
    desc.textContent   = `Location: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    currentEditingPlayground = { uid: null, isNew: true, lat, lng, data: {} };
    clearEditForm();
    modal.style.display = 'block';
    showNotification('Fill in the playground details below', 'success');
}

function clearEditForm() {
    const form = document.getElementById('editForm');
    if (!form) return;
    form.reset();
    form.querySelectorAll('input[type="number"]').forEach(el => el.value = '');
    form.querySelectorAll('input[type="checkbox"]').forEach(el => el.checked = false);
    form.querySelectorAll('select').forEach(el => el.selectedIndex = 0);
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    const colors = {
        success: { bg: 'var(--contrast-medium)', color: 'var(--contrast-dark)', border: 'var(--contrast-dark)' },
        error:   { bg: '#fecaca',                color: '#dc2626',              border: '#dc2626' },
        info:    { bg: 'var(--supplementary)',   color: 'var(--primary)',       border: 'var(--primary)' }
    };
    const c = colors[type] || colors.info;
    notification.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:12px 20px;background:${c.bg};color:${c.color};border:2px solid ${c.border};border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:10000;font-weight:500;max-width:90vw;text-align:center;`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => { notification.remove(); }, 3000);
}

// ===== KEYWORD SELECTION IN EDIT MODAL =====

let editModalSelectedKeywords = [];

function initialiseEditModalKeywords() {
    const input    = document.getElementById('edit-keywords');
    const dropdown = document.getElementById('editKeywordDropdown');
    if (!input || !dropdown) return;

    // Clone to remove old listeners
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    const el = document.getElementById('edit-keywords');

    el.addEventListener('input', e => {
        const term = e.target.value.toLowerCase().trim();
        if (!term) { dropdown.style.display = 'none'; return; }
        const matches = allKeywords.filter(k => k.toLowerCase().includes(term) && !editModalSelectedKeywords.includes(k));
        if (!matches.length) { dropdown.style.display = 'none'; return; }
        dropdown.innerHTML = '';
        matches.slice(0, 10).forEach(keyword => {
            const item = document.createElement('div'); item.className = 'keyword-dropdown-item'; item.textContent = keyword;
            item.addEventListener('click', () => { addEditModalKeyword(keyword); el.value = ''; dropdown.style.display = 'none'; });
            dropdown.appendChild(item);
        });
        dropdown.style.display = 'block';
    });

    document.addEventListener('click', e => { if (!el.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none'; });

    el.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const value = el.value.trim();
            if (value) { addEditModalKeyword(value); el.value = ''; dropdown.style.display = 'none'; }
        }
    });
}

function addEditModalKeyword(keyword) {
    if (!editModalSelectedKeywords.includes(keyword)) { editModalSelectedKeywords.push(keyword); updateEditModalKeywordsDisplay(); }
}

function removeEditModalKeyword(keyword) {
    editModalSelectedKeywords = editModalSelectedKeywords.filter(k => k !== keyword);
    updateEditModalKeywordsDisplay();
}

function updateEditModalKeywordsDisplay() {
    const container = document.getElementById('editSelectedKeywords');
    if (!container) return;
    container.innerHTML = '';
    editModalSelectedKeywords.forEach(keyword => {
        const tag       = document.createElement('div'); tag.className = 'keyword-tag';
        const text      = document.createElement('span'); text.textContent = keyword; text.className = 'keyword-tag-text';
        const removeBtn = document.createElement('button'); removeBtn.innerHTML = '×'; removeBtn.className = 'keyword-tag-remove';
        removeBtn.addEventListener('click', e => { e.preventDefault(); removeEditModalKeyword(keyword); });
        tag.appendChild(text); tag.appendChild(removeBtn);
        container.appendChild(tag);
    });
}

function populateEditModalKeywords(playground) {
    editModalSelectedKeywords = playground.keywords?.trim()
        ? playground.keywords.split(',').map(k => k.trim()).filter(Boolean)
        : [];
    updateEditModalKeywordsDisplay();
    const input = document.getElementById('edit-keywords');
    if (input) input.value = '';
}

// ===== PHOTO HANDLING =====

async function compressImage(file, maxSizeMB = 5) {
    return new Promise((resolve, reject) => {
        const maxBytes = maxSizeMB * 1024 * 1024;
        if (file.size <= maxBytes) { resolve(file); return; }

        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx    = canvas.getContext('2d');
                const { width, height } = img;

                const tryCompress = (scale, qual) => {
                    canvas.width  = width  * scale;
                    canvas.height = height * scale;
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    canvas.toBlob(blob => {
                        if (blob.size <= maxBytes || qual <= 0.3) {
                            resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
                        } else if (qual > 0.3) {
                            tryCompress(scale, qual - 0.1);
                        } else if (scale > 0.5) {
                            tryCompress(scale - 0.1, 0.7);
                        } else {
                            resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
                        }
                    }, 'image/jpeg', qual);
                };
                tryCompress(1.0, 0.7);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function checkFileSize(file) {
    const maxSize = 5 * 1024 * 1024;
    const sizeMB  = (file.size / (1024 * 1024)).toFixed(2);
    return file.size > maxSize
        ? { valid: false, message: `⚠️ File size (${sizeMB} MB) exceeds 5 MB limit. The image will be automatically compressed.` }
        : { valid: true,  message: null };
}

function setupPhotoInput() {
    const photoInput = document.getElementById('edit-photo');
    const previewImg = document.getElementById('preview-img');
    if (!photoInput) return;

    const warningDiv = document.createElement('div');
    warningDiv.id = 'photo-size-warning';
    warningDiv.style.cssText = 'color:#f59e0b;font-size:14px;margin-top:8px;display:none;';

    const isMobile = true; // always show mobile UI for best UX

    if (isMobile) {
        photoInput.style.display = 'none';

        const cameraInput  = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none', id: 'mobile-camera-input' });
        const galleryInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', style: 'display:none', id: 'mobile-gallery-input' });

        const btnStyle = 'flex:1;min-width:140px;padding:8px 16px;background:#e5e7eb;color:#374151;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:14px;';
        const cameraBtn  = Object.assign(document.createElement('button'), { type: 'button', innerHTML: 'Take Photo',   style: btnStyle });
        const galleryBtn = Object.assign(document.createElement('button'), { type: 'button', innerHTML: 'Choose File',  style: btnStyle });

        cameraBtn.onclick  = e => { e.preventDefault(); cameraInput.click(); };
        galleryBtn.onclick = e => { e.preventDefault(); galleryInput.click(); };

        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap;';
        btnContainer.appendChild(cameraBtn);
        btnContainer.appendChild(galleryBtn);

        const parent = photoInput.parentElement;
        parent.insertBefore(btnContainer, photoInput);
        parent.insertBefore(cameraInput,  photoInput);
        parent.insertBefore(galleryInput, photoInput);
        parent.appendChild(warningDiv);

        const handleFileSelect = e => {
            const file = e.target.files[0];
            if (!file) {
                if (previewImg) { previewImg.style.display = 'none'; previewImg.src = ''; }
                warningDiv.style.display = 'none';
                try { photoInput.value = ''; } catch {}
                return;
            }
            try { const dt = new DataTransfer(); dt.items.add(file); photoInput.files = dt.files; }
            catch { photoInput._selectedFile = file; }
            const check = checkFileSize(file);
            warningDiv.textContent = check.message || '';
            warningDiv.style.display = check.valid ? 'none' : 'block';
            if (previewImg) {
                const reader = new FileReader();
                reader.onload = ev => { previewImg.src = ev.target.result; previewImg.style.display = 'block'; };
                reader.readAsDataURL(file);
            }
        };

        cameraInput.addEventListener('change',  handleFileSelect);
        galleryInput.addEventListener('change', handleFileSelect);

    } else {
        photoInput.parentElement.appendChild(warningDiv);
        photoInput.accept = 'image/*';
        photoInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) { warningDiv.style.display = 'none'; if (previewImg) { previewImg.style.display = 'none'; previewImg.src = ''; } return; }
            const check = checkFileSize(file);
            warningDiv.textContent = check.message || '';
            warningDiv.style.display = check.valid ? 'none' : 'block';
            if (previewImg) {
                const reader = new FileReader();
                reader.onload = ev => { previewImg.src = ev.target.result; previewImg.style.display = 'block'; };
                reader.readAsDataURL(file);
            }
        });
    }
}

// Number +/- buttons
document.addEventListener('click', e => {
    if (e.target.classList.contains('number-increment') || e.target.classList.contains('number-decrement')) {
        const input = document.getElementById(e.target.dataset.target);
        if (input) {
            const min = parseInt(input.min) || 0;
            const max = parseInt(input.max) || Infinity;
            let val   = parseInt(input.value) || 0;
            val = e.target.classList.contains('number-increment') ? Math.min(val + 1, max) : Math.max(val - 1, min);
            input.value = val;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
});

// ===== FORM SUBMISSION =====

async function collectFormData() {
    const get     = id => document.getElementById(id)?.value || '';
    const checked = id => document.getElementById(id)?.checked || false;

    const keywordsInput = document.getElementById('edit-keywords');
    if (keywordsInput?.value.trim()) {
        const pending = keywordsInput.value.trim();
        if (!editModalSelectedKeywords.includes(pending)) editModalSelectedKeywords.push(pending);
    }

    const photoInput = document.getElementById('edit-photo');
    let photoPath = undefined; let hasNewPhoto = false;
    try {
        if (photoInput?.files?.[0]) {
            photoPath = await uploadPhotoToSupabase(photoInput.files[0]);
            hasNewPhoto = true;
        }
    } catch (photoError) {
        console.error('Photo upload failed:', photoError);
        if (!confirm(`Photo upload failed: ${photoError.message}\n\nSubmit without changing the photo?`)) {
            throw new Error('Submission cancelled by user');
        }
    }

    const formData = {
        playgroundId: currentEditingPlayground.uid,
        name: get('edit-name'), type: get('edit-type'), keywords: editModalSelectedKeywords.join(', '),
        comments: get('edit-comments'), shade: get('edit-shade'), parking: get('edit-parking'),
        fencing: get('edit-fencing'), seating: get('edit-seating'), floor: get('edit-floor'),
        toilet: checked('edit-toilet'), bbq: checked('edit-bbq'), bubbler: checked('edit-bubbler'),
        accessible: checked('edit-accessible'), basketball: checked('edit-basketball'),
        skatePark: checked('edit-skate_park'), pumpTrack: checked('edit-pump_track'),
        scooterTrack: checked('edit-scooter_track'), cricketNet: checked('edit-cricket_net'),
        tennisCourt: checked('edit-tennis_court'), activityWall: checked('edit-activity_wall'),
        talkingTube: checked('edit-talking_tube'), musicalPlay: checked('edit-musical_play'),
        sensoryPlay: checked('edit-sensory_play'), sandpit: checked('edit-sandpit'),
        waterPlay: checked('edit-water_play'),
        babySwing: get('edit-baby_swing'), beltSwing: get('edit-belt_swing'),
        basketSwing: get('edit-basket_swing'), dualSwing: get('edit-dual_swing'),
        hammock: get('edit-hammock'), doubleSlide: get('edit-double_slide'),
        tripleSlide: get('edit-triple_slide'), straightSlide: get('edit-straight_slide'),
        tubeSlide: get('edit-tube_slide'), spiralSlide: get('edit-spiral_slide'),
        stairs: get('edit-stairs'), metalLadder: get('edit-metal_ladder'),
        ropeLadder: get('edit-rope_ladder'), rockClimbing: get('edit-rock_climbing'),
        monkeyBars: get('edit-monkey_bars'), otherClimbing: get('edit-other_climbing'),
        ropeGym: get('edit-rope_gym'), spinningPole: get('edit-spinning_pole'),
        spinningBucket: get('edit-spinning_bucket'), merryGoRound: get('edit-merry_go_round'),
        balanceBeam: get('edit-balance_beam'), steppingStones: get('edit-stepping_stones'),
        springRocker: get('edit-spring_rocker'), seesaw: get('edit-seesaw'),
        flyingFox: get('edit-flying_fox'), bridge: get('edit-bridge'),
        tunnel: get('edit-tunnel'), trampoline: get('edit-trampoline'),
        firemansPole: get('edit-firemans_pole'), hamsterWheel: get('edit-hamster_wheel'),
        link: get('edit-link'), email: get('edit-email'), verified: get('edit-verified'),
        hasNewPhoto
    };
    if (hasNewPhoto) formData.photo = photoPath;
    return formData;
}

async function uploadPhotoToSupabase(file) {
    if (!file?.type.startsWith('image/')) throw new Error('File must be an image');

    const maxSize = 5 * 1024 * 1024;
    const uploadFile = file.size > maxSize ? await compressImage(file, 5) : file;
    if (uploadFile.size > maxSize) throw new Error('Unable to compress image below 5MB.');

    const fileName = `playground_${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${uploadFile.name.split('.').pop()}`;
    const { error } = await supabaseClient.storage.from('PhotosStaging').upload(fileName, uploadFile, { cacheControl: '3600', upsert: false });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    return fileName;
}

function buildPlaygroundPayload(formData, extras = {}) {
    const int = v => parseInt(v) || null;
    return {
        ...extras,
        name: formData.name || null, type: formData.type || null,
        keywords: formData.keywords || null, comments: formData.comments || null,
        shade: formData.shade || null, parking: formData.parking || null,
        fencing: formData.fencing || null, seating: formData.seating || null,
        floor: formData.floor || null,
        toilet: formData.toilet, bbq: formData.bbq, bubbler: formData.bubbler,
        accessible: formData.accessible, basketball: formData.basketball,
        pump_track: formData.pumpTrack, scooter_track: formData.scooterTrack,
        cricket_net: formData.cricketNet, tennis_court: formData.tennisCourt,
        skate_park: formData.skatePark, activity_wall: formData.activityWall,
        talking_tube: formData.talkingTube, musical_play: formData.musicalPlay,
        sensory_play: formData.sensoryPlay, sandpit: formData.sandpit,
        water_play: formData.waterPlay,
        baby_swing: int(formData.babySwing), belt_swing: int(formData.beltSwing),
        basket_swing: int(formData.basketSwing), dual_swing: int(formData.dualSwing),
        hammock: int(formData.hammock), double_slide: int(formData.doubleSlide),
        triple_slide: int(formData.tripleSlide), straight_slide: int(formData.straightSlide),
        tube_slide: int(formData.tubeSlide), spiral_slide: int(formData.spiralSlide),
        stairs: int(formData.stairs), metal_ladder: int(formData.metalLadder),
        rope_ladder: int(formData.ropeLadder), rock_climbing: int(formData.rockClimbing),
        monkey_bars: int(formData.monkeyBars), other_climbing: int(formData.otherClimbing),
        rope_gym: int(formData.ropeGym), spinning_pole: int(formData.spinningPole),
        spinning_bucket: int(formData.spinningBucket), merry_go_round: int(formData.merryGoRound),
        balance_beam: int(formData.balanceBeam), stepping_stones: int(formData.steppingStones),
        spring_rocker: int(formData.springRocker), seesaw: int(formData.seesaw),
        flying_fox: formData.flyingFox || null,
        bridge: int(formData.bridge), tunnel: int(formData.tunnel),
        trampoline: int(formData.trampoline), firemans_pole: int(formData.firemansPole),
        hamster_wheel: int(formData.hamsterWheel),
        photo: formData.photo || null, link: formData.link || null,
        verified: formData.verified || null,
        browser_fingerprint: generateFingerprint(), session_id: getOrCreateSessionId(),
        user_agent: navigator.userAgent,
        submission_metadata: {
            screen_resolution: `${screen.width}x${screen.height}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            language: navigator.language, referrer: document.referrer
        }
    };
}

async function postToEdgeFunction(table, data) {
    const response = await fetch(`${supabaseUrl}/functions/v1/get-ip-on-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
        body: JSON.stringify({ table, data })
    });
    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    return result.data;
}

async function submitEditToSupabase(formData) {
    try {
        if (currentEditingPlayground.isNew) {
            const payload = buildPlaygroundPayload(formData, {
                lat: currentEditingPlayground.lat, lng: currentEditingPlayground.lng,
                submitted_at: new Date().toISOString(),
                submitted_by_email: formData.email || 'anonymous@playground.com',
                status: 'pending'
            });
            const data = await postToEdgeFunction('playgrounds_new', payload);
            await sendNewPlaygroundEmail(data);
            if (tempLocationMarker) { map.removeLayer(tempLocationMarker); tempLocationMarker = null; }
            return { success: true, data };
        } else {
            const original = playgroundLookup[formData.playgroundId];
            const payload  = buildPlaygroundPayload(formData, {
                uid: formData.playgroundId,
                submitted_at: new Date().toISOString(),
                submitted_by_email: formData.email || 'anonymous@playground.com',
                status: 'pending'
            });
            if (!formData.hasNewPhoto) delete payload.photo;
            const changes = comparePlaygroundData(original, payload);
            const data    = await postToEdgeFunction('playgrounds_edits', payload);
            await sendEmailNotification(payload, changes, data.id);
            return { success: true, data };
        }
    } catch (error) {
        console.error('Error in submitEditToSupabase:', error);
        return { success: false, error: error.message };
    }
}

function showErrorMessage(errorText) {
    const errorMessage = document.getElementById('error-message');
    if (errorMessage) { errorMessage.textContent = `Error: ${errorText}`; errorMessage.style.display = 'block'; }
    else alert(`Error submitting edit: ${errorText}`);
    setTimeout(() => { if (errorMessage) errorMessage.style.display = 'none'; }, 5000);
}

function showSuccessMessage() {
    const successMessage = document.getElementById('success-message');
    const editForm       = document.getElementById('editForm');
    const modal          = document.getElementById('editModal');
    if (successMessage) successMessage.style.display = 'block';
    if (editForm) editForm.style.display = 'none';
    setTimeout(() => {
        if (modal)          modal.style.display = 'none';
        if (successMessage) successMessage.style.display = 'none';
        if (editForm) {
            editForm.style.display = 'block'; editForm.reset();
            const previewImg = document.getElementById('preview-img');
            if (previewImg) { previewImg.src = ''; previewImg.style.display = 'none'; }
        }
    }, 3000);
}

function setupFormSubmission() {
    const form = document.getElementById('editForm');
    if (!form) return;
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        const origText  = submitBtn.textContent;
        submitBtn.disabled = true; submitBtn.textContent = 'Uploading photo...';
        try {
            const formData = await collectFormData();
            submitBtn.textContent = 'Submitting...';
            const result = await submitEditToSupabase(formData);
            if (result.success) showSuccessMessage(); else showErrorMessage(result.error);
        } catch (error) {
            console.error('Error submitting edit:', error); showErrorMessage(error.message);
        } finally {
            submitBtn.disabled = false; submitBtn.textContent = origText;
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const photoInput = document.getElementById('edit-photo');
    const previewImg = document.getElementById('preview-img');
    if (photoInput && previewImg) {
        photoInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = ev => { previewImg.src = ev.target.result; previewImg.style.display = 'block'; };
                reader.readAsDataURL(file);
            } else { previewImg.style.display = 'none'; }
        });
    }
});

// ===== FINGERPRINTING / SESSION =====

function generateFingerprint() {
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');
    ctx.textBaseline = 'top'; ctx.font = '14px Arial'; ctx.fillText('fingerprint', 2, 2);
    return btoa(JSON.stringify({
        canvas: canvas.toDataURL(), screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, language: navigator.language,
        platform: navigator.platform, userAgent: navigator.userAgent
    })).substring(0, 32);
}

function getOrCreateSessionId() {
    let id = sessionStorage.getItem('playground_session');
    if (!id) { id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; sessionStorage.setItem('playground_session', id); }
    return id;
}

// ===== EMAIL NOTIFICATIONS =====

async function sendEmailNotification(editData, changes, editRecordId) {
    try {
        const { error } = await supabaseClient.functions.invoke('email-notification-edit', {
            body: { editId: editRecordId, playgroundUid: editData.uid, playgroundName: editData.name,
                    submittedBy: editData.submitted_by_email, submittedAt: editData.submitted_at, changes }
        });
        if (error) console.error('Email notification error:', error);
    } catch (error) { console.error('Failed to send email notification:', error); }
}

async function sendNewPlaygroundEmail(playgroundData) {
    try {
        const { error } = await supabaseClient.functions.invoke('email-notification-new', {
            body: { playgroundUid: playgroundData.uid, playgroundName: playgroundData.name,
                    lat: playgroundData.lat, lng: playgroundData.lng,
                    submittedBy: playgroundData.submitted_by_email, submittedAt: playgroundData.submitted_at,
                    allData: playgroundData }
        });
        if (error) console.error('Email notification error:', error);
    } catch (error) { console.error('Failed to send new playground email:', error); }
}

function comparePlaygroundData(original, edited) {
    const displayNames = {
        name: 'Name', type: 'Type', keywords: 'Keywords', comments: 'Comments',
        shade: 'Shade', parking: 'Parking', fencing: 'Fencing', seating: 'Seating', floor: 'Floor',
        toilet: 'Toilet', bbq: 'BBQ', bubbler: 'Bubbler', accessible: 'Accessible',
        basketball: 'Basketball', pump_track: 'Pump Track', scooter_track: 'Scooter Track',
        cricket_net: 'Cricket Net', tennis_court: 'Tennis Court', skate_park: 'Skate Park',
        activity_wall: 'Activity Wall', talking_tube: 'Talking Tube', musical_play: 'Musical Play',
        sensory_play: 'Sensory Play', sandpit: 'Sandpit', water_play: 'Water Play',
        baby_swing: 'Baby Swings', belt_swing: 'Belt Swings', basket_swing: 'Basket Swings',
        dual_swing: 'Dual Swings', hammock: 'Hammocks', double_slide: 'Double Slides',
        triple_slide: 'Triple Slides', straight_slide: 'Straight Slides', tube_slide: 'Tube Slides',
        spiral_slide: 'Spiral Slides', stairs: 'Stairs', metal_ladder: 'Metal Ladders',
        rope_ladder: 'Rope Ladders', rock_climbing: 'Rock Climbing', monkey_bars: 'Monkey Bars',
        other_climbing: 'Other Climbing', rope_gym: 'Rope Gym', spinning_pole: 'Spinning Poles',
        spinning_bucket: 'Spinning Buckets', merry_go_round: 'Merry Go Rounds',
        balance_beam: 'Balance Beams', stepping_stones: 'Stepping Stones',
        spring_rocker: 'Spring Rockers', seesaw: 'Seesaws', flying_fox: 'Flying Fox',
        bridge: 'Bridges', tunnel: 'Tunnels', trampoline: 'Trampolines',
        firemans_pole: 'Firemans Poles', hamster_wheel: 'Hamster Roller Wheels',
        photo: 'Photo', link: 'Link', verified: 'Verified'
    };

    const changes = [];
    for (const field of Object.keys(displayNames)) {
        if (field === 'photo' && !edited.hasOwnProperty('photo')) continue;
        const orig = normalizeValue(original[field]);
        const edit = normalizeValue(edited[field]);
        if (orig !== edit) {
            changes.push({ field: displayNames[field], oldValue: formatValue(original[field]), newValue: formatValue(edited[field]) });
        }
    }
    return changes;
}

function normalizeValue(value) {
    if (value === null || value === undefined || value === '' || value === 0) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string')  return value.trim().toLowerCase();
    return value;
}

function formatValue(value) {
    if (value === null || value === undefined || value === '') return '<em>empty</em>';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
}

// ===== SEARCH CONTROL =====

function addSearchControl() {
    if (document.getElementById('search-container')) return;
    if (!searchIndex?.length) { setTimeout(addSearchControl, 1000); return; }

    const mapContainer    = document.getElementById('map');
    if (!mapContainer) return;

    const searchContainer = document.createElement('div');
    searchContainer.id    = 'search-container';
    searchContainer.innerHTML = `
        <div class="dropdown-wrapper">
            <input type="text" id="searchInput" class="form-input small" placeholder="Search location or playground...">
            <div id="suggestions" class="dropdown-menu hidden"></div>
        </div>
        <button id="searchBtn" class="search-button">Search</button>
    `;
    mapContainer.appendChild(searchContainer);

    setTimeout(() => {
        const layersControl = document.querySelector('.leaflet-control-layers');
        if (layersControl) searchContainer.appendChild(layersControl);
    }, 100);

    const searchInput = document.getElementById('searchInput');
    const searchBtn   = document.getElementById('searchBtn');
    if (searchInput) searchInput.addEventListener('input', handleSuggestions);
    if (searchBtn)   searchBtn.addEventListener('click',   performSearch);
    if (searchInput) searchInput.addEventListener('keypress', e => { if (e.key === 'Enter') performSearch(); });
}

function handleSuggestions() {
    const searchInput = document.getElementById('searchInput');
    const query       = searchInput.value.trim().toLowerCase();
    const suggestions = document.getElementById('suggestions');
    suggestions.innerHTML = '';

    if (!query || !searchIndex?.length) { suggestions.classList.add('hidden'); return; }

    const matches = searchIndex.filter(pg => pg.name?.toLowerCase().includes(query)).slice(0, 6);
    if (!matches.length) { suggestions.classList.add('hidden'); return; }

    matches.forEach(match => {
        const item = document.createElement('div'); item.className = 'dropdown-option'; item.textContent = match.name;
        item.addEventListener('click', () => {
            searchInput.value = match.name;
            suggestions.innerHTML = ''; suggestions.classList.add('hidden');
            const coords = getPlaygroundCoordinates(match);
            if (coords) { map.setView([coords.lat, coords.lng], 16); addSearchResultMarker(coords.lat, coords.lng, match.name, true); }
        });
        suggestions.appendChild(item);
    });
    suggestions.classList.remove('hidden');
}

document.addEventListener('click', e => {
    if (!e.target.closest('#search-container')) {
        const s = document.getElementById('suggestions');
        if (s) { s.innerHTML = ''; s.classList.add('hidden'); }
    }
});

async function performSearch() {
    const searchInput = document.getElementById('searchInput');
    const query       = searchInput.value.trim();
    if (!query) return;

    const searchBtn = document.getElementById('searchBtn');
    const origText  = searchBtn.innerHTML;
    searchBtn.innerHTML = '⏳'; searchBtn.disabled = true;

    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=au`);
        const results  = await response.json();

        if (results?.length) {
            const { lat, lon } = results[0];
            map.setView([parseFloat(lat), parseFloat(lon)], 14);
            addSearchResultMarker(parseFloat(lat), parseFloat(lon), results[0].display_name, false);
            searchInput.value = '';
        } else {
            const match = searchIndex?.find(p => p.name?.toLowerCase().includes(query.toLowerCase()));
            if (match) {
                map.setView([match.lat, match.lng], 16);
                addSearchResultMarker(match.lat, match.lng, match.name, true);
                searchInput.value = '';
            } else {
                alert('Location or playground not found. Try a different search term.');
            }
        }
    } catch (error) {
        console.error('Search error:', error); alert('Search failed. Please try again.');
    }

    searchBtn.innerHTML = origText; searchBtn.disabled = false;
}

let searchMarker = null;
function addSearchResultMarker(lat, lng, displayName, isPlayground) {
    if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
    searchMarker = L.marker([lat, lng], {
        icon: L.divIcon({
            html: `<div style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;font-size:24px;">${isPlayground ? '🔍' : '📍'}</div>`,
            className: 'search-result-marker', iconSize: [40, 40], iconAnchor: [20, 20]
        }),
        interactive: false
    }).addTo(map);
    setTimeout(() => { if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; } }, 8000);
}

// ===== FERRY TRACKING =====

function makeFerryIcon(vesselName) {
    const color       = vesselName === 'GOOTCHA' ? '#88cafc' : '#e2793b';
    return L.divIcon({
        className: '',
        html: `<div style="width:38px;height:38px;background:${color};border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 0 10px ${color}99;">⛴</div>`,
        iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -22]
    });
}

async function loadFerryProto() {
    if (ferryProtoLoaded) return;
    const root = protobuf.parse(FERRY_PROTO_SCHEMA).root;
    FeedMessageType = root.lookupType('FeedMessage');
    ferryProtoLoaded = true;
}

async function fetchTripUpdates() {
    try {
        await loadFerryProto();
        const res = await fetch(FERRY_TRIP_UPDATES_URL);
        if (!res.ok) return {};
        const buf  = await res.arrayBuffer();
        const feed = FeedMessageType.decode(new Uint8Array(buf));
        const map  = {};
        for (const entity of feed.entity) {
            const tu = entity.trip_update;
            if (!tu?.trip) continue;
            if (tu.trip.trip_id) map[tu.trip.trip_id] = tu.stop_time_update || [];
        }
        return map;
    } catch { return {}; }
}

function formatArrivalTime(unixSecs) {
    if (!unixSecs) return null;
    return new Date(Number(unixSecs) * 1000).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

async function fetchAndDisplayFerries() {
    try {
        await loadFerryProto();
        const [posRes, tripUpdates] = await Promise.all([fetch(FERRY_GTFS_URL), fetchTripUpdates()]);
        if (!posRes.ok) throw new Error(`HTTP ${posRes.status}`);

        const feed = FeedMessageType.decode(new Uint8Array(await posRes.arrayBuffer()));

        for (const entity of feed.entity) {
            const vp = entity.vehicle;
            if (!vp) continue;
            const label = (vp.vehicle?.label || '').toUpperCase().trim();
            if (!FERRY_TARGETS.includes(label)) continue;

            const lat = vp.position?.latitude;
            const lon = vp.position?.longitude;
            if (!lat || !lon) continue;

            const ts         = vp.timestamp;
            const routeId    = vp.trip?.route_id || vp.trip?.routeId || '—';
            const tripId     = vp.trip?.trip_id  || vp.trip?.tripId  || null;
            const stopId     = vp.stop_id || vp.stopId || null;
            const statusCode = vp.current_status ?? vp.currentStatus ?? null;

            const displayName = FERRY_DISPLAY_NAMES[label] || label;
            const vesselName  = FERRY_VESSEL_NAMES[label]  || label;
            const updatedTime = ts
                ? new Date(Number(ts) * 1000).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '—';

            let stopLine = '';
            if (stopId !== null) {
                const statusText = VEHICLE_STATUS_TEXT[statusCode] ?? 'Near stop';
                stopLine = `<b>${statusText}:</b> ${ferryStopNames[stopId] || stopId}<br>`;
            }

            let arrivalLine = '';
            if (tripId && tripUpdates[tripId]?.length) {
                const now  = Math.floor(Date.now() / 1000);
                const next = tripUpdates[tripId].find(stu => stu.arrival?.time && Number(stu.arrival.time) >= now - 60);
                if (next) {
                    const timeStr    = formatArrivalTime(next.arrival?.time) || formatArrivalTime(next.departure?.time) || '—';
                    const rawStopId  = next.stop_id || next.stopId || '—';
                    arrivalLine = `<b>Next arrival:</b> ${ferryStopNames[rawStopId] || rawStopId} @ ${timeStr}<br>`;
                }
            }

            const iconColor = label === 'GOOTCHA' ? '#88cafc' : '#e2793b';
            const popupHtml = `
                <div style="font-family:sans-serif;min-width:175px;">
                    <div style="font-weight:700;font-size:1rem;margin-bottom:6px;color:${iconColor};">⛴ ${displayName}</div>
                    <div style="font-size:0.8rem;color:#444;line-height:1.7;">
                        <b>Vessel:</b> ${vesselName}<br><b>Route:</b> ${routeId}<br>${stopLine}${arrivalLine}<b>Updated:</b> ${updatedTime}
                    </div>
                </div>`;

            if (ferryMarkers[label]) {
                ferryMarkers[label].setLatLng([lat, lon]).setPopupContent(popupHtml);
            } else {
                ferryMarkers[label] = L.marker([lat, lon], { icon: makeFerryIcon(label) })
                    .bindPopup(popupHtml).addTo(ferryLayerGroup);
            }
        }

        for (const name of FERRY_TARGETS) {
            const inFeed = feed.entity.some(e =>
                (e.vehicle?.vehicle?.label || '').toUpperCase().trim() === name && e.vehicle?.position?.latitude
            );
            if (!inFeed && ferryMarkers[name]) { ferryLayerGroup.removeLayer(ferryMarkers[name]); delete ferryMarkers[name]; }
        }
    } catch (err) {
        console.warn('Ferry GTFS-RT fetch failed:', err.message);
    }
}

function initialiseFerryLayer() {
    ferryLayerGroup = L.layerGroup();
    loadTransitStopNames('Ferry').then(lookup => { ferryStopNames = lookup; });
}

function startFerryTracking() { fetchAndDisplayFerries(); ferryRefreshInterval = setInterval(fetchAndDisplayFerries, FERRY_REFRESH_MS); }
function stopFerryTracking()  { if (ferryRefreshInterval) { clearInterval(ferryRefreshInterval); ferryRefreshInterval = null; } }

function toggleFerries() {
    const btn = document.getElementById('toggleFerriesBtn');
    if (!ferryVisible) {
        map.addLayer(ferryLayerGroup); ferryVisible = true;
        startFerryTracking(); btn?.classList.remove('ferries-hidden');
    } else {
        map.removeLayer(ferryLayerGroup); ferryVisible = false;
        stopFerryTracking(); btn?.classList.add('ferries-hidden');
    }
}

// ===== TOGGLE BUTTONS =====

function createToggleButtons() {
    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'toggleButtonContainer';

    function updatePosition() {
        const isMobile = window.innerWidth <= 768;
        buttonContainer.style.cssText = `
            position: fixed;
            top: ${isMobile ? '140px' : '80px'};
            right: 20px;
            z-index: 999;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
    }
    updatePosition();
    window.addEventListener('resize', updatePosition);

    buttonContainer.innerHTML = `
        <button id="togglePlaygroundsBtn" class="toggle-events-btn">
            <span class="events-icon">🛝</span>
            <span class="events-text">Playgrounds</span>
        </button>

        <button id="toggleEventsBtn" class="toggle-events-btn events-hidden">
            <span class="events-icon">⭐</span>
            <span class="events-text">Events</span>
        </button>

        <button id="toggleLibrariesBtn" class="toggle-events-btn libraries-hidden">
            <span class="events-icon">📚</span>
            <span class="events-text">Libraries</span>
        </button>

        <button id="toggleFerriesBtn" class="toggle-events-btn ferries-hidden">
            <span class="events-icon">⛴</span>
            <span class="events-text">CityDogs</span>
        </button>
    `;

    document.body.appendChild(buttonContainer);
}

function initializeToggleButtons() {
    // Playgrounds — starts ON, no hidden class
    const playgroundsBtn = document.getElementById('togglePlaygroundsBtn');
    if (playgroundsBtn) {
        playgroundsBtn.addEventListener('click', togglePlaygrounds);
    }

    // Events — starts OFF
    const eventsBtn = document.getElementById('toggleEventsBtn');
    if (eventsBtn) {
        eventsBtn.classList.add('events-hidden');
        // layer NOT added (off by default)
        eventsBtn.addEventListener('click', toggleEvents);
    }

    // Libraries — starts OFF
    const librariesBtn = document.getElementById('toggleLibrariesBtn');
    if (librariesBtn) {
        librariesBtn.classList.add('libraries-hidden');
        // layer NOT added
        librariesBtn.addEventListener('click', toggleLibraries);
    }

    // Ferries — starts OFF
    const ferriesBtn = document.getElementById('toggleFerriesBtn');
    if (ferriesBtn) {
        ferriesBtn.classList.add('ferries-hidden');
        ferriesBtn.addEventListener('click', toggleFerries);
    }
}

// ===== MOBILE DRAWER =====

function initialiseMobileDrawer() {
    if (window.innerWidth > 768) return;

    const sidebar = document.querySelector('.w-80');
    const handle  = document.getElementById('drawerHandle');
    if (!sidebar || !handle) return;

    sidebar.classList.add('drawer-collapsed');
    let currentState = 'collapsed';

    handle.addEventListener('click', () => {
        sidebar.classList.remove('drawer-collapsed', 'drawer-partial', 'drawer-full');
        if      (currentState === 'collapsed') { sidebar.classList.add('drawer-partial');  currentState = 'partial'; }
        else if (currentState === 'partial')   { sidebar.classList.add('drawer-full');     currentState = 'full'; }
        else                                   { sidebar.classList.add('drawer-collapsed');currentState = 'collapsed'; }
    });

    let touchStartY = 0; let isDragging = false; let initialState = '';

    handle.addEventListener('touchstart', e => { isDragging = true; touchStartY = e.touches[0].clientY; initialState = currentState; });

    document.addEventListener('touchmove', e => {
        if (!isDragging) return;
        const deltaY = e.touches[0].clientY - touchStartY;
        sidebar.classList.remove('drawer-collapsed', 'drawer-partial', 'drawer-full');
        if      (deltaY > 100  && initialState === 'full')      { sidebar.classList.add('drawer-partial');   currentState = 'partial';   isDragging = false; }
        else if (deltaY > 100  && initialState === 'partial')   { sidebar.classList.add('drawer-collapsed'); currentState = 'collapsed'; isDragging = false; }
        else if (deltaY < -100 && initialState === 'collapsed') { sidebar.classList.add('drawer-partial');   currentState = 'partial';   isDragging = false; }
        else if (deltaY < -100 && initialState === 'partial')   { sidebar.classList.add('drawer-full');      currentState = 'full';      isDragging = false; }
        else sidebar.classList.add(currentState);
    });

    document.addEventListener('touchend', () => { isDragging = false; });
}

// ===== BACKWARD COMPATIBILITY =====

function getMarkerColor(classification) { return getMarkerSizeConfig(classification).fillColor; }

// ===== APP ENTRY =====

function initialiseApp() {
    initialiseClusterGroup();
    initialiseFerryLayer();
    initialiseMap();

    // Load search index in parallel with geolocation
    loadSearchIndex().then(() => { addSearchControl(); });

    createToggleButtons();
    initializeToggleButtons();

    // Start events/libraries loading but don't show layers yet
    loadEventsData();
    loadLibrariesData();

    setupEventListeners();
    initialiseMobileDrawer();

    let moveTimeout;
    map.on('moveend', () => {
        if (!initialLoadComplete) return;
        clearTimeout(moveTimeout);
        moveTimeout = setTimeout(() => {
            loadVisiblePlaygrounds();
            updateTopicCount();
        }, 300);
    });

    map.on('zoomend', updateTopicCount);
    map.on('moveend', updateTopicCount);
}


document.addEventListener('DOMContentLoaded', initialiseApp);
