// ===== GLOBAL VARIABLES =====
let playgroundData = null;
let markerClusterGroup;
let currentEditingPlayground = null;
let map;
let playgroundLookup = {};
let allKeywords = [];
let selectedKeywords = [];
let allSuburbs = [];
let selectedSuburbs = [];
let allLGAs = [];
let selectedLGAs = [];

// ===== SUPABASE CLIENT =====
const supabaseUrl = 'https://mrcodrddkxvoszuwdaks.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yY29kcmRka3h2b3N6dXdkYWtzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAzNTc0NzUsImV4cCI6MjA3NTkzMzQ3NX0.GOKyB7-vdg968lE2jC5PxrOdVKp7IOis6QtyG2FNptQ';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// ===== CONFIGURATION OBJECTS =====
const sizeConfigs = {
    marker: {
        'Super': { radius: 20, fillColor: '#8b5cf6', borderColor: '#ffffff' },
        'Large': { radius: 16, fillColor: '#dc2626', borderColor: '#ffffff' },
        'Medium': { radius: 13, fillColor: '#ea580c', borderColor: '#ffffff' },
        'Small': { radius: 11, fillColor: '#faaa3c', borderColor: '#ffffff' },
        'Tiny': { radius: 8, fillColor: '#eab308', borderColor: '#ffffff' },
        'Unverified': { radius: 8, fillColor: '#6b7280', borderColor: '#202020' },
        'Exists: Not Digitally Classifiable': { radius: 8, fillColor: '#16a34a', borderColor: '#202020' },
        'Under Construction': {radius: 8, fillColor: '#facc15', borderColor: '#ffffff', emoji: '🚧'},
        'Unsure If Exists': { radius: 8, fillColor: '#dc2626', borderColor: '#202020' }
    },
    cluster: {
        colors: {
            'Super': { bg: '#8b5cf6', border: '#7c3aed' },
            'Large': { bg: '#dc2626', border: '#b91c1c' },
            'Medium': { bg: '#ea580c', border: '#c2410c' },
            'Small': { bg: '#faaa3c', border: '#ea580c' },
            'Tiny': { bg: '#eab308', border: '#ca8a04' },
            'Unverified': { bg: '#374151', border: '#1f2937' },
            'Exists: Not Digitally Classifiable': { bg: '#16a34a', border: '#1f2937' },
            'Under Construction': { bg: '#eab308', border: '#1f2937' },
            'Unsure If Exists': { bg: '#dc2626', border: '#1f2937' }
        },
        hierarchy: ['Super', 'Large', 'Medium', 'Small', 'Tiny', 'Unverified', 'Exists: Not Digitally Classifiable', 'Under Construction', 'Unsure If Exists']
    }
};

const sizeSliderConfig = {
    order: ['Unverified', 'Unsure If Exists', 'Under Construction', 'Exists: Not Digitally Classifiable', 'Tiny', 'Small', 'Medium', 'Large', 'Super'],
    labels: {
        'Unverified': 'Unverified',
        'Unsure If Exists': 'Unsure',
        'Under Construction': 'Rebuild',
        'Exists: Not Digitally Classifiable': 'Unclassified',
        'Tiny': 'Tiny',
        'Small': 'Small', 
        'Medium': 'Medium',
        'Large': 'Large',
        'Super': 'Super'
    }
};

const baseLayers = {
    "Greyscale": L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }),
    "Dark": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
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

function generateUniqueId(props) {
    return props.uid || props.id || Math.random().toString(36).substr(2, 9);
}

function createElement(tag, className, innerHTML, attributes = {}) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (innerHTML) element.innerHTML = innerHTML;
    Object.entries(attributes).forEach(([key, value]) => {
        element.setAttribute(key, value);
    });
    return element;
}

// Custom sort function to order items based on preferred order
function sortWithCustomOrder(items, preferredOrder) {
    return items.sort((a, b) => {
        const indexA = preferredOrder.indexOf(a);
        const indexB = preferredOrder.indexOf(b);
        
        // If both are in preferred order, sort by their position
        if (indexA !== -1 && indexB !== -1) {
            return indexA - indexB;
        }
        
        // If only A is in preferred order, it comes first
        if (indexA !== -1) return -1;
        
        // If only B is in preferred order, it comes first
        if (indexB !== -1) return 1;
        
        // If neither are in preferred order, sort alphabetically
        return a.localeCompare(b);
    });
}

// Enlarge a photo 
function enlargePhoto(img) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = 0;
    overlay.style.left = 0;
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.8)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.cursor = 'zoom-out';
    overlay.style.zIndex = 9999;

    // Create enlarged image
    const enlargedImg = document.createElement('img');
    enlargedImg.src = img.src;
    enlargedImg.style.maxWidth = '90%';
    enlargedImg.style.maxHeight = '90%';
    enlargedImg.style.borderRadius = '6px';
    enlargedImg.style.boxShadow = '0 0 20px rgba(0,0,0,0.5)';

    overlay.appendChild(enlargedImg);
    document.body.appendChild(overlay);

    // Remove overlay on click
    overlay.onclick = () => {
        document.body.removeChild(overlay);
    };
}

// ===== MAP INITIALIZATION =====
function initializeMap() {
  // init map immediately (fallback view)
  try {
    map = L.map('map').setView([-32.75, 151.57], 12);
  } catch (err) {
    console.error('Leaflet map init failed:', err);
    return;
  }

  // add base layers & controls immediately
  if (baseLayers && baseLayers["Greyscale"]) baseLayers["Greyscale"].addTo(map);
  L.control.layers(baseLayers || {}).addTo(map);

  // ensure map container is ready before trying to pan
  map.whenReady(() => {
    // check secure context / geolocation availability first
    const secure = (location.protocol === 'https:' || location.hostname === 'localhost');
    if (!('geolocation' in navigator)) {
      console.warn('Geolocation not supported.');
      return;
    }
    if (!secure) {
      console.warn('Geolocation requires HTTPS or localhost. Skipping auto-locate.');
      return;
    }

    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          // animate to user's location; no marker added
          try {
            map.setView([lat, lng], 14, { animate: true });
          } catch (e2) {
            // fallback if setView with options fails
            map.setView([lat, lng], 14);
          }
        },
        (err) => {
          console.warn('Geolocation error (auto-pan):', err && err.message ? err.message : err);
          // do nothing — keep default view
        },
        { enableHighAccuracy: false, timeout: 7000, maximumAge: 60000 }
      );
    } catch (err) {
      console.warn('navigator.geolocation threw:', err);
    }
  });
}

function initializeClusterGroup() {
    markerClusterGroup = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: createClusterIcon
    });
}

// ===== CLUSTER FUNCTIONALITY =====
function createClusterIcon(cluster) {
    const count = cluster.getChildCount();
    const markers = cluster.getAllChildMarkers();
    const dominantSize = getDominantRating(markers);
    const config = getClusterSizeConfig(dominantSize, count);
    
    return L.divIcon({
        html: `<div class="cluster-marker" style="
            background: ${config.backgroundColor};
            border: 3px solid ${config.borderColor};
            width: ${config.size}px;
            height: ${config.size}px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            color: white;
            font-size: ${config.fontSize}px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            transition: all 0.2s ease;
        ">${count}</div>`,
        className: 'custom-cluster-icon',
        iconSize: [config.size, config.size],
        iconAnchor: [config.size/2, config.size/2]
    });
}

function getDominantRating(markers) {
    const ratingHierarchy = sizeConfigs.cluster.hierarchy;
    let highestRating = null;
    let highestRatingIndex = ratingHierarchy.length;
    
    markers.forEach(marker => {
        const rating = marker.playgroundData.classification || marker.playgroundData.size;
        const ratingIndex = ratingHierarchy.indexOf(rating);
        
        if (ratingIndex !== -1 && ratingIndex < highestRatingIndex) {
            highestRatingIndex = ratingIndex;
            highestRating = rating;
        }
    });
    
    return highestRating || (markers[0].playgroundData.classification || markers[0].playgroundData.size);
}

function getClusterSizeConfig(dominantSize, count) {
    const colorConfig = sizeConfigs.cluster.colors[dominantSize] || sizeConfigs.cluster.colors['Unverified'];
    
    let size, fontSize;
    if (count < 10) { size = 35; fontSize = 12; }
    else if (count < 50) { size = 45; fontSize = 14; }
    else if (count < 100) { size = 55; fontSize = 16; }
    else { size = 65; fontSize = 18; }
    
    return {
        backgroundColor: colorConfig.bg,
        borderColor: colorConfig.border,
        size: size,
        fontSize: fontSize
    };
}

// ===== MARKER FUNCTIONALITY =====
function createMarker(playground) {
    playgroundLookup[playground.uid] = playground;
    const sizeConfig = getMarkerSizeConfig(playground.classification);

    let marker;

    if (playground.classification === 'Under Construction') {
        // 🚧 Custom emoji marker
        marker = L.marker([playground.lat, playground.lng], {
            icon: L.divIcon({
                className: 'emoji-marker',
                html: `<div style="font-size: ${sizeConfig.radius * 3}px;">🚧</div>`,
                iconSize: [sizeConfig.radius * 2, sizeConfig.radius * 2],
                iconAnchor: [sizeConfig.radius, sizeConfig.radius],
            })
        });
    } else {
        // 🟣 Normal circle marker
        marker = L.circleMarker([playground.lat, playground.lng], {
            radius: sizeConfig.radius,
            fillColor: sizeConfig.fillColor,
            color: sizeConfig.borderColor,
            weight: 3,
            opacity: 1,
            fillOpacity: 0.9
        });
    }

    // Bind popup and tooltip (works for both types)
    const coordinates = [playground.lng, playground.lat];
    marker.bindPopup(createPopupContent(playground, coordinates));
    marker.bindTooltip(playground.name || 'Unnamed Playground', {
        permanent: false,
        direction: 'top',
        offset: [0, -10],
        className: 'playground-tooltip'
    });

    marker.playgroundData = playground;
    return marker;
}

function getMarkerSizeConfig(size) {
    return sizeConfigs.marker[size] || sizeConfigs.marker['Unverified'];
}

function getPlaygroundCoordinates(playground) {
    // If geom exists, parse it
    if (playground.geom) {
        try {
            const geometry = typeof playground.geom === 'string' ? JSON.parse(playground.geom) : playground.geom;
            if (geometry.coordinates && geometry.coordinates.length >= 2) {
                return { lat: geometry.coordinates[1], lng: geometry.coordinates[0] };
            }
        } catch (e) {
            console.warn("Failed to parse geom for playground:", playground.name || playground.name);
        }
    }

    // Fallback to lat/lng fields
    if (playground.lat != null && playground.lng != null) {
        return { lat: playground.lat, lng: playground.lng };
    }

    // If neither exists, return null
    return null;
}

function addMarkersToMap() {
    console.log("Sample playground data:", playgroundData[0]);
    console.log("addMarkersToMap called");
    console.log("Map object exists:", !!map);
    console.log("Map is initialized:", map && map._loaded);
    
    if (!playgroundData || playgroundData.length === 0) {
        console.error('No playground data available');
        return;
    }

    markerClusterGroup.clearLayers();

    let successCount = 0;
    let failCount = 0;

    playgroundData.forEach((playground) => {
        const lat = playground.lat;
        const lng = playground.lng;

        if (lat == null || lng == null) {
            console.error("Missing coordinates for playground:", playground.name);
            failCount++;
            return;
        }

        const marker = createMarker(playground);
        console.log("Created marker at:", lat, lng); // Add this
        markerClusterGroup.addLayer(marker);
        successCount++;
    });

    console.log(`Markers created - Success: ${successCount}, Failed: ${failCount}`);
    console.log("markerClusterGroup layer count:", markerClusterGroup.getLayers().length);
    
    // Check if markerClusterGroup was already added to map
    console.log("markerClusterGroup already on map:", map.hasLayer(markerClusterGroup));
    
    if (!map.hasLayer(markerClusterGroup)) {
        map.addLayer(markerClusterGroup);
        console.log("Cluster group added to map");
    }
    
    if (markerClusterGroup.getLayers().length > 0) {
        const bounds = markerClusterGroup.getBounds();
        console.log("Marker bounds:", bounds);
        console.log("Fitting bounds to:", bounds.toBBoxString());
        map.fitBounds(bounds);
    }
}

// ===== POPUP FUNCTIONALITY =====
function createPopupContent(props, coordinates) {
    const uniqueId = generateUniqueId(props);
    
    // Use props.lng and props.lat instead of coordinates parameter
    return `
        <div style="font-family: system-ui, -apple-system, sans-serif; min-width: 300px; padding: 12px;">
            ${createPopupHeader({...props, lng: props.lng, lat: props.lat})}
            ${generateCompactFeaturesList(props)}
            ${createPopupFooter(props, uniqueId)}
        </div>
    `;
}

function createPopupHeader(props) {
    const linkIcon = props.link ? '🔗' : '';
    
    // Use props.lat and props.lng directly
    const mapsIcon = props.lat && props.lng ? 
        `<a href="https://www.google.com/maps?q=${props.lat},${props.lng}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; margin-left: 4px;">📍</a>` : 
        '';
    
    const title = props.link ? 
        `<a href="${props.link}" target="_blank" rel="noopener noreferrer" style="text-decoration: none;">${props.name} ${linkIcon}</a>` : 
        props.name;
        
    return `
        <div style="margin-bottom: 8px;">
            <h3 style="font-weight: bold; font-size: var(--font-size-lg); margin: 0;">${title}${mapsIcon}</h3>
            <div style="font-style: italic; margin-top: 2px;">${props.keywords || ''}</div>
        </div>
    `;
}

function createPopupFooter(props, uniqueId) {
    const photo = props.photo ? `
        <div style="margin-bottom: 4px;">
            <img
                src="${props.photo}"
                style="max-width: 100%; height: auto; border-radius: 4px; cursor: zoom-in;"
                alt="Playground photo"
                onclick="enlargePhoto(this)"
            >
        </div>` : '';

    const comments = props.comments ? `<div style="font-style: italic; margin-bottom: 8px;">${props.comments}</div>` : '';
    
    // Use the uniqueId parameter instead of props.uid
    const playgroundId = uniqueId || props.uid || props.id;
   
    return `
        <div style="margin-top: 12px; padding-top: 8px; border-top: 2px dotted var(--text-light);">
            ${photo}
            ${comments}
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="color: var(--text-tertiary);">
                    Verified: ${props.last_visit_date ? new Date(props.last_visit_date).toLocaleDateString('en-GB') : 'Unknown'}, ${props.verified || 'Unknown'}
                </div>
                <button onclick="editPlayground('${playgroundId}')"
                        style="background: var(--primary); border: none; border-radius: 4px; padding: 4px 12px; color: white; cursor: pointer; font-weight: 500;">
                    Edit Details
                </button>
            </div>
        </div>
    `;
}

// ===== FEATURES LIST GENERATION =====
function generateCompactFeaturesList(props) {
    const sections = [];
    
    sections.push(createFacilitiesSection(props));
    sections.push(createSecondaryFacilitiesSection(props));
    sections.push(createSeatingSection(props));
    
    const equipmentSections = createEquipmentSections(props);
    const hasEquipment = equipmentSections.length > 0 || hasValue(props.accessible);
    
    if (sections.some(s => s) && hasEquipment) {
        sections.push('<div style="border-bottom: 2px dotted var(--text-light); margin-bottom: 8px;"></div>');
    }
    
    if (hasValue(props.accessible)) {
        sections.push('<div style="margin-bottom: 6px;">♿ Accessible Infrastructure</div>');
    }
    
    sections.push(equipmentSections.join(''));
    
    const activities = createActivitiesSection(props);
    if ((hasEquipment || hasValue(props.accessible)) && activities) {
        sections.push('<div style="border-bottom: 2px dotted var(--text-light); margin-bottom: 8px; margin-top: 8px;"></div>');
    }
    sections.push(activities);
    
    return sections.filter(Boolean).join('');
}

function createFacilitiesSection(props) {
    const facilities = [];
    if (hasValue(props.toilet)) facilities.push('🚻 Toilets');
    if (hasValue(props.bbq)) facilities.push('🔥 BBQ');
    if (hasValue(props.bubbler)) facilities.push('💧 Bubbler');
    
    return facilities.length > 0 ? `<div style="margin-bottom: 6px;">${facilities.join(', ')}</div>` : '';
}

function createSecondaryFacilitiesSection(props) {
    const facilities = [];
    
    if (hasValue(props.fencing)) {
        const fenceIcon = (props.fencing === 'No Fence' || props.fencing === 'Other') ? '🔓' : '🔒';
        facilities.push(`${fenceIcon} ${props.fencing}`);
    }
    
    if (hasValue(props.shade)) {
        const shadeIcon = props.shade === 'No Shade' ? '☀️' : '🌳';
        facilities.push(`${shadeIcon} ${props.shade}`);
    }
    
    if (hasValue(props.parking)) facilities.push(`🚗 ${props.parking}`);
    
    return facilities.length > 0 ? `<div style="margin-bottom: 8px;">${facilities.join(', ')}</div>` : '';
}

function createSeatingSection(props) {
    return hasValue(props.seating) ? `<div style="margin-bottom: 8px;">🪑 ${props.seating}</div>` : '';
}

function createEquipmentSections(props) {
    const sections = [];
    
    sections.push(createSwingsSection(props));
    sections.push(createSlidesSection(props));
    sections.push(createClimbingSection(props));
    sections.push(createBalanceSection(props));
    sections.push(createOtherEquipmentSection(props));
    
    return sections.filter(Boolean);
}

function createSwingsSection(props) {
    const swings = [];
    let totalSwings = 0;
    
    const swingTypes = [
        { key: 'baby_swing', name: 'Baby' },
        { key: 'belt_swing', name: 'Belt' },
        { key: 'basket_swing', name: 'Basket' },
        { key: 'dual_swing', name: 'Dual' },
        { key: 'hammock', name: 'Hammock' }
    ];
    
    let babySwings = 0;
    swingTypes.forEach(({ key, name }) => {
        const count = parseIntSafe(props[key]);
        if (count) {
            swings.push(name);
            totalSwings += count;
            if (key === 'baby_swing') babySwings = count;
        }
    });
    
    if (swings.length === 0) return '';
    
    const maxEmojis = Math.min(totalSwings, 8);
    const babyEmojiCount = Math.min(babySwings, maxEmojis);
    const cartwheelEmojiCount = Math.max(0, maxEmojis - babyEmojiCount);
    
    const swingEmojis = '👶'.repeat(babyEmojiCount) + '🤸‍♀️'.repeat(cartwheelEmojiCount);
    const swingDetails = swings.join(', ');
    
    return createHoverableSection('Swings', props.uid, swingEmojis, swingDetails);
}

function createSlidesSection(props) {
    const slides = [];
    let totalSlides = 0;
    
    const slideTypes = [
        { key: 'straight_slide', name: 'Straight' },
        { key: 'spiral_slide', name: 'Spiral/Curved' },
        { key: 'tube_slide', name: 'Tube' },
        { key: 'double_slide', name: 'Double' },
        { key: 'triple_slide', name: 'Triple' }
    ];
    
    slideTypes.forEach(({ key, name }) => {
        const count = parseIntSafe(props[key]);
        if (count) {
            slides.push(name);
            totalSlides += count;
        }
    });
    
    if (slides.length === 0) return '';

    const maxEmojis = Math.min(totalSlides, 10);
    const slideEmojis = '🛝'.repeat(maxEmojis);
    const slideDetails = slides.join(', ');

    return createHoverableSection('Slides', props.uid, slideEmojis, slideDetails);
}

function createClimbingSection(props) {
    const climbing = [];
    let totalClimbing = 0;
    
    const climbingTypes = [
        { key: 'stairs', name: 'Stairs' },
        { key: 'metal_ladder', name: 'Metal Ladder' },
        { key: 'rope_ladder', name: 'Rope/Chain' },
        { key: 'rock_climbing', name: 'Rock' },
        { key: 'monkey_bars', name: 'Monkey Bars' },
        { key: 'rope_gym', name: 'Rope Gym' },
        { key: 'other_climbing', name: 'Other' }
    ];
    
    climbingTypes.forEach(({ key, name }) => {
        const count = parseIntSafe(props[key]);
        if (count) {
            climbing.push(name);
            totalClimbing += count;
        }
    });
    
    if (climbing.length === 0) return '';
    
    const maxEmojis = Math.min(totalClimbing, 10);
    const climbingEmojis = '🧗'.repeat(maxEmojis);
    const climbingDetails = climbing.join(', ');
    return createHoverableSection('Climbing', props.uid, climbingEmojis, climbingDetails);
}

function createBalanceSection(props) {
    const balance = [];
    let totalBalance = 0;
    
    const balanceTypes = [
        { key: 'spinning_pole', name: 'Spinning Pole' },
        { key: 'spinning_bucket', name: 'Spinning Bucket' },
        { key: 'merry_go_round', name: 'Merry Go Round' },
        { key: 'balance_beam', name: 'Balance Beam' },
        { key: 'stepping_stones', name: 'Stepping Stones' },
        { key: 'spring_rocker', name: 'Spring Rocker' },
        { key: 'seesaw', name: 'Seesaw' }
    ];
    
    balanceTypes.forEach(({ key, name }) => {
        const count = parseIntSafe(props[key]);
        if (count) {
            balance.push(name);
            totalBalance += count;
        }
    });
    
    if (balance.length === 0) return '';

    const maxEmojis = Math.min(totalBalance, 10);
    const balanceEmojis = '⚖️'.repeat(maxEmojis);
    const balanceDetails = balance.join(', ');
    return createHoverableSection('Balance', props.uid, balanceEmojis, balanceDetails);
}

function createOtherEquipmentSection(props) {
    const otherEquip = [];
    let totalOtherEquip = 0;
    
    const equipmentTypes = [
        { key: 'flying_fox', name: 'Flying Fox', useHasValue: true },
        { key: 'firemans_pole', name: 'Firemans Pole' },
        { key: 'bridge', name: 'Bridge' },
        { key: 'tunnel', name: 'Tunnel' },
        { key: 'trampoline', name: 'Trampoline' },
        { key: 'hamster_wheel', name: 'Hamster or Roller Wheel' }
    ];
    
    equipmentTypes.forEach(({ key, name, useHasValue }) => {
        const count = useHasValue ? (hasValue(props[key]) ? 1 : 0) : parseIntSafe(props[key]);
        if (count) {
            otherEquip.push(name);
            totalOtherEquip += count;
        }
    });
    
    if (otherEquip.length === 0) return '';
    
    const maxEmojis = Math.min(totalOtherEquip, 10);
    const otherEquipEmojis = '🎠'.repeat(maxEmojis);
    const otherEquipDetails = otherEquip.join(', ');
    return createHoverableSection('Other', props.uid, otherEquipEmojis, otherEquipDetails);
}

function createActivitiesSection(props) {
    const activities = [];
    
    const activityTypes = [
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
        { key: 'cricket_chute', emoji: '🏏', name: 'Cricket' }
    ];
    
    activityTypes.forEach(({ key, emoji, name }) => {
        if (hasValue(props[key])) {
            activities.push(`${emoji} ${name}`);
        }
    });
    
    return activities.length > 0 ? `<div style="margin-bottom: 6px;">${activities.join(', ')}</div>` : '';
}

function createHoverableSection(category, uid, emojis, details) {
    const categoryLower = category.toLowerCase().replace(/\s+/g, '-');
    return `
        <div style="margin-bottom: 4px;">
            <span id="${categoryLower}-word-${uid}" style="color: var(--text-primary) cursor: help;" 
                onmouseenter="highlightSection('${categoryLower}', '${uid}')" 
                onmouseleave="unhighlightSection('${categoryLower}', '${uid}')"
                ontouchstart="highlightSection('${categoryLower}', '${uid}')" 
                ontouchend="setTimeout(() => unhighlightSection('${categoryLower}', '${uid}'), 2000)">
                ${category}
            </span> 
            <span id="${categoryLower}-emoji-${uid}" style="cursor: help;"
                onmouseenter="highlightSection('${categoryLower}', '${uid}')" 
                onmouseleave="unhighlightSection('${categoryLower}', '${uid}')"
                ontouchstart="highlightSection('${categoryLower}', '${uid}')" 
                ontouchend="setTimeout(() => unhighlightSection('${categoryLower}', '${uid}'), 2000)">
                ${emojis}
            </span> 
            <span id="${categoryLower}-details-${uid}" style="color: var(--primary); margin-left: 8px; display: none;">${details}</span>
        </div>
    `;
}

// ===== HOVER EFFECTS =====
function highlightSection(category, uid) {
    const elements = ['word', 'emoji'].map(type => 
        document.getElementById(`${category}-${type}-${uid}`)
    );
    const detailsElement = document.getElementById(`${category}-details-${uid}`);
    
    elements.forEach(element => {
        if (element) {
            element.style.backgroundColor = 'var(--contrast-light)';
            element.style.padding = '2px 4px';
            element.style.borderRadius = '3px';
        }
    });
    
    if (detailsElement) {
        detailsElement.style.display = 'inline';
    }
}

function unhighlightSection(category, uid) {
    const elements = ['word', 'emoji'].map(type => 
        document.getElementById(`${category}-${type}-${uid}`)
    );
    const detailsElement = document.getElementById(`${category}-details-${uid}`);
    
    elements.forEach(element => {
        if (element) {
            element.style.backgroundColor = '';
            element.style.padding = '';
            element.style.borderRadius = '';
        }
    });
    
    if (detailsElement) {
        detailsElement.style.display = 'none';
    }
}

// ===== DROPDOWN FUNCTIONALITY =====
function toggleDropdown(menuId) {
    const menu = document.getElementById(menuId);
    if (!menu) return;
    
    // Close all other dropdowns
    document.querySelectorAll('.dropdown-menu').forEach(dropdown => {
        if (dropdown.id !== menuId) {
            dropdown.classList.add('hidden');
        }
    });
    
    // Toggle this dropdown
    menu.classList.toggle('hidden');
}

function toggleAllItems(allCheckboxId, itemCheckboxClass, updateFunction) {
    const allCheckbox = document.getElementById(allCheckboxId);
    const itemCheckboxes = document.querySelectorAll(itemCheckboxClass);
    
    itemCheckboxes.forEach(checkbox => {
        checkbox.checked = allCheckbox.checked;
    });
    
    updateFunction();
}

function updateSelection(itemCheckboxClass, allCheckboxId, selectedSpanId, allText, updateFunction) {
    const itemCheckboxes = document.querySelectorAll(itemCheckboxClass);
    const allCheckbox = document.getElementById(allCheckboxId);
    const selectedItems = Array.from(itemCheckboxes).filter(cb => cb.checked);
    const selectedSpan = document.getElementById(selectedSpanId);

    if (selectedItems.length === 0) {
        allCheckbox.indeterminate = false;
        allCheckbox.checked = false;
        selectedSpan.textContent = allText;
    } else if (selectedItems.length === itemCheckboxes.length) {
        allCheckbox.indeterminate = false;
        allCheckbox.checked = true;
        selectedSpan.textContent = allText;
    } else {
        allCheckbox.indeterminate = true;
        allCheckbox.checked = false;
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
    const checkboxes = document.querySelectorAll(`${checkboxClass}:checked`);
    return Array.from(checkboxes).map(cb => cb.value);
}


// Specific dropdown functions
function toggleAllTypes() {
    toggleAllItems('allTypes', '.type-checkbox', updateTypeSelection);
}

function toggleAllShade() {
    toggleAllItems('allshades', '.shade-checkbox', updateShadeSelection);
}

function toggleAllFencing() {
    toggleAllItems('allfencing', '.fence-checkbox', updateFencingSelection);
}

function toggleAllParking() {
    toggleAllItems('allparking', '.parking-checkbox', updateParkingSelection);
}

function updateTypeSelection() {
    updateSelection('.type-checkbox', 'allTypes', 'typeSelected', 'All types', filterMarkers);
}

function updateShadeSelection() {
    updateSelection('.shade-checkbox', 'allshades', 'shadeSelected', 'Any shade', filterMarkers);
}

function updateFencingSelection() {
    updateSelection('.fence-checkbox', 'allfencing', 'fenceSelected', 'Any fencing', filterMarkers);
}

function updateParkingSelection() {
    updateSelection('.parking-checkbox', 'allparking', 'parkingSelected', 'Any parking', filterMarkers);
}

// ===== KEYWORD SEARCH - Get Selected Suburbs/LGAs/Types =====
function getSelectedTypes() {
    return getSelectedValues('.type-checkbox');
}

function getSelectedShade() {
    return getSelectedValues('.shade-checkbox');
}

function getSelectedFencing() {
    return getSelectedValues('.fence-checkbox');
}

function getSelectedParking() {
    return getSelectedValues('.parking-checkbox');
}

// ===== DATA LOADING AND PROCESSING =====
async function loadPlaygroundData() {
    try {
        const { data, error } = await supabase
            .rpc('get_playgrounds_with_coords');

        if (error) throw error;

        playgroundData = data;
       
        console.log("Loaded playground data:", playgroundData.length);

    } catch (err) {
        console.error("Failed to load playground data:", err);
        throw err;
    }

    if (playgroundData && playgroundData.length > 0) {
        addMarkersToMap();
        populateDropdowns(playgroundData); // For map filters
        populateEditFormDropdowns(); // For edit form
        filterMarkers();
    }
}

function populateDropdowns(data) {
    if (!data || data.length === 0) {
        console.warn('No data provided to populateDropdowns');
        return;
    }

    const types = extractUniqueValues(data, 'type');
    const shade = extractUniqueValues(data, 'shade');
    const fencing = extractUniqueValues(data, 'fencing');
    const parking = extractUniqueValues(data, 'parking');

    // Sort playground type with custom order
    const typesSorted = sortWithCustomOrder(types, [
        'Council Playground',
        'Private Playground', 
        'School Playground'
    ]);   

    // Sort shade with custom order
    const shadeSorted = sortWithCustomOrder(shade, [
        'Natural and Sail',
        'Sail', 
        'Natural',
        'No Shade'
    ]);    

    // Sort fencing with custom order
    const fencingSorted = sortWithCustomOrder(fencing, [
        'Fully Fenced',
        'Partially Fenced', 
        'Natural Fence',
        'No Fence'
    ]);    

    populateDropdownOptions('typeOptions', typesSorted, 'type-checkbox', updateTypeSelection, 'Council Playground');
    populateDropdownOptions('shadeOptions', shadeSorted, 'shade-checkbox', updateShadeSelection);
    populateDropdownOptions('fencingOptions', fencingSorted, 'fence-checkbox', updateFencingSelection);
    populateDropdownOptions('parkingOptions', parking, 'parking-checkbox', updateParkingSelection);
}

function extractUniqueValues(data, propertyName) {
    return [...new Set(
        data
            .map(playground => playground[propertyName])
            .filter(value => value)
    )].sort();
}

function populateDropdownOptions(containerId, values, checkboxClass, onchangeFunction, defaultValue = null) {

    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    values.forEach(value => {
        const label = document.createElement('label');
        label.className = 'dropdown-option'; // UPDATED: Use CSS class

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = checkboxClass;
        checkbox.value = value;
        checkbox.onchange = onchangeFunction;

        if (value === defaultValue) {
            checkbox.checked = true;
        }

        const span = document.createElement('span');
        span.textContent = value;

        label.appendChild(checkbox);
        label.appendChild(span);
        container.appendChild(label);
    });

    if (defaultValue) {
        const selectedSpan = document.getElementById(containerId.replace('Options', 'Selected'));
        if (selectedSpan) selectedSpan.textContent = defaultValue;
    }
}

// ==== DESKTOP SIDEBAR COLLAPSE FUNCTIONALITY =====
/// Desktop sidebar collapse functionality
function toggleSidebarCollapse() {
  if (window.innerWidth > 768) {
    const sidebar = document.querySelector('.w-80.bg-white.shadow-lg.overflow-y-auto');
    if (sidebar) {
      sidebar.classList.toggle('collapsed');
      
      // Save state to session
      const isCollapsed = sidebar.classList.contains('collapsed');
      sessionStorage.setItem('sidebarCollapsed', isCollapsed);
      
      // Trigger map resize after animation completes
      setTimeout(function() {
        if (typeof map !== 'undefined' && map && map.invalidateSize) {
          map.invalidateSize(true); // true forces a hard reset
        }
      }, 350); // Match the CSS transition time
    }
  }
}

// Clear any saved collapsed state and ensure sidebar is open on load
document.addEventListener('DOMContentLoaded', function() {
  // Clear the saved state so sidebar always starts open
  sessionStorage.removeItem('sidebarCollapsed');
  
  if (window.innerWidth > 768) {
    const sidebar = document.querySelector('.w-80.bg-white.shadow-lg.overflow-y-auto');
    if (sidebar) {
      // Ensure sidebar is NOT collapsed on load
      sidebar.classList.remove('collapsed');
    }
  }
});

// Ensure collapse only works on desktop
window.addEventListener('resize', function() {
  const sidebar = document.querySelector('.w-80.bg-white.shadow-lg.overflow-y-auto');
  if (window.innerWidth <= 768 && sidebar) {
    sidebar.classList.remove('collapsed');
  }
});


// ===== SIZE SLIDER FUNCTIONALITY =====
function initializeSizeSlider() {
    const slider = document.getElementById('sizeSlider');
    if (!slider) return;

    const startMinIndex = sizeSliderConfig.order.indexOf('Tiny');   // index of "Tiny"
    const startMaxIndex = sizeSliderConfig.order.indexOf('Super');  // index of "Super"

    noUiSlider.create(slider, {
        start: [startMinIndex, startMaxIndex], // default to Tiny → Super
        connect: true,
        range: {
            min: 0,
            max: sizeSliderConfig.order.length - 1
        },
        step: 1
    });

    slider.noUiSlider.on('update', function(values) {
        const minIndex = Math.round(values[0]);
        const maxIndex = Math.round(values[1]);

        const minSize = sizeSliderConfig.order[minIndex];
        const maxSize = sizeSliderConfig.order[maxIndex];

        document.getElementById('sizeSliderMinLabel').textContent = sizeSliderConfig.labels[minSize];
        document.getElementById('sizeSliderMaxLabel').textContent = sizeSliderConfig.labels[maxSize];

        filterMarkers();
    });
}

function getSelectedSizesFromSlider() {
    const slider = document.getElementById('sizeSlider');
    if (!slider || !slider.noUiSlider) return [...sizeSliderConfig.order];

    const values = slider.noUiSlider.get();
    const minIndex = Math.round(parseFloat(values[0]));
    const maxIndex = Math.round(parseFloat(values[1]));
    
    const selected = sizeSliderConfig.order.slice(minIndex, maxIndex + 1);
    
    return selected;
}

function isSizeIncluded(classification) {
    const selectedSizes = getSelectedSizesFromSlider();
    
    // Normalize any missing classification
    let normalizedClassification = classification;
    if (!normalizedClassification || !sizeSliderConfig.order.includes(normalizedClassification)) {
        normalizedClassification = 'Unverified';
    }

    const included = selectedSizes.includes(normalizedClassification);

    return included;
}

// ===== FILTERING FUNCTIONALITY =====
function filterMarkers() {
    if (!playgroundData || playgroundData.length === 0) return;

    const filters = getActiveFilters();
    markerClusterGroup.clearLayers();
    
    playgroundData.forEach(playground => {
        if (shouldShowPlayground(playground, filters)) {
            // Just use lat/lng directly - no need to parse geometry
            const marker = createMarker(playground); 
            markerClusterGroup.addLayer(marker);
        }
    });
    
    updateVisiblePlaygroundCount();
}

function updatePlaygroundCount(count) {
    // Select all elements with class 'playgroundCount'
    const countElements = document.querySelectorAll('.playgroundCount');
    countElements.forEach(element => {
        element.textContent = `${count} playground${count !== 1 ? 's' : ''}`;
    });
}

// Move this function to global scope
function updateVisiblePlaygroundCount() {
    const bounds = map.getBounds();
    let visibleCount = 0;
    
    // Count markers that are both filtered AND in view
    markerClusterGroup.eachLayer(marker => {
        if (bounds.contains(marker.getLatLng())) {
            visibleCount++;
        }
    });
    
    updatePlaygroundCount(visibleCount);
}

function getActiveFilters() {
    return {
        hasTrampoline: document.getElementById('filterHasTrampoline')?.checked || false,
        hasSkatePark: document.getElementById('filterHasSkatePark')?.checked || false,
        hasLargeFlyingFox: document.getElementById('filterHasLargeFlyingFox')?.checked || false,
        hasSandpit: document.getElementById('filterHasSandpit')?.checked || false,
        hasScootTrack: document.getElementById('filterHasScootTrack')?.checked || false,
        hasWaterPlay: document.getElementById('filterHasWaterPlay')?.checked || false,
        selectedShade: getSelectedShade(),
        selectedParking: getSelectedParking(),
        selectedFencing: getSelectedFencing(),
        hasAccessibleFeatures: document.getElementById('filterHasAccessibleFeatures')?.checked || false,
        hasToilet: document.getElementById('filterHasToilet')?.checked || false,
        hasBBQ: document.getElementById('filterHasBBQ')?.checked || false,
        hasBubbler: document.getElementById('filterHasBubbler')?.checked || false,
        selectedSuburbs: selectedSuburbs,
        selectedLGAs: selectedLGAs,  
        selectedTypes: getSelectedTypes()
    };
}

function shouldShowPlayground(playground, filters) {
    // Facility filters
    if (filters.hasTrampoline && Number(playground.trampoline) <= 0) return false;
    if (filters.hasSkatePark && playground.skate_park !== true) return false;
    if (filters.hasLargeFlyingFox && playground.flying_fox !== 'Large') return false;
    if (filters.hasSandpit && playground.sandpit !== true) return false;
    if (filters.hasScootTrack && playground.scooter_track !== true) return false;
    if (filters.hasWaterPlay && playground.water_play !== true) return false;
    if (filters.hasAccessibleFeatures && playground.accessible !== true) return false;
    if (filters.hasToilet && playground.toilet !== true) return false;
    if (filters.hasBBQ && playground.bbq !== true) return false;
    if (filters.hasBubbler && playground.bubbler !== true) return false;
    
    // Size filter using slider - determine classification: use Classification field, or 'Unverified' if null
    let classification = playground.classification;
    if (!classification || classification === null) {
        classification = 'Unverified';
    }

    if (!isSizeIncluded(classification)) return false;
    
    // Location filters
    if (filters.selectedSuburbs.length > 0 && !filters.selectedSuburbs.includes(playground.suburb)) return false;
    if (filters.selectedLGAs.length > 0 && !filters.selectedLGAs.includes(playground.lga)) return false;
    if (filters.selectedTypes.length > 0 && !filters.selectedTypes.includes(playground.type)) return false;
    if (filters.selectedShade.length > 0 && !filters.selectedShade.includes(playground.shade)) return false;
    if (filters.selectedFencing.length > 0 && !filters.selectedFencing.includes(playground.fencing)) return false;
    if (filters.selectedParking.length > 0 && !filters.selectedParking.includes(playground.parking)) return false;
    
    // Keyword filter
    if (!playgroundMatchesKeywords(playground)) return false;
    
    return true;
}

// ===== MULTI-SELECT SEARCH FUNCTIONALITY =====
function extractUniqueValues(data, propertyName) {
    return [...new Set(
        data
            .map(playground => playground[propertyName])
            .filter(value => value)
    )].sort();
}

function initializeMultiSelectSearch(inputId, dropdownId, allItemsArray, selectedItemsArray, itemType) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    
    if (!input || !dropdown) return;
    
    input.addEventListener('input', function() {
        const searchTerm = this.value.trim().toLowerCase();
        
        if (searchTerm === '') {
            dropdown.classList.add('hidden');
            return;
        }
        
        const matchingItems = allItemsArray.filter(item => 
            item.toLowerCase().includes(searchTerm)
        );
        
        if (matchingItems.length > 0) {
            displayItemDropdown(dropdown, matchingItems, selectedItemsArray, itemType);
        } else {
            dropdown.classList.add('hidden');
        }
    });
    
    document.addEventListener('click', function(event) {
        if (!input.contains(event.target) && !dropdown.contains(event.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

function displayItemDropdown(dropdown, items, selectedItemsArray, itemType) {
    dropdown.innerHTML = '';
    dropdown.classList.remove('hidden');
    
    items.forEach(item => {
        const option = document.createElement('div');
        option.className = 'dropdown-option';
        option.textContent = item;
        
        option.addEventListener('click', function() {
            selectItem(item, selectedItemsArray, itemType);
        });
        
        dropdown.appendChild(option);
    });
}

function selectItem(item, selectedItemsArray, itemType) {
    if (selectedItemsArray.includes(item)) {
        return;
    }
    
    selectedItemsArray.push(item);
    updateSelectedItemsDisplay(selectedItemsArray, itemType);
    
    const inputId = `${itemType}SearchInput`;
    const dropdownId = `${itemType}Dropdown`;
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    
    if (input) input.value = '';
    if (dropdown) dropdown.classList.add('hidden');
    
    filterMarkers();
}

function removeItem(item, selectedItemsArray, itemType) {
    const index = selectedItemsArray.indexOf(item);
    if (index > -1) {
        selectedItemsArray.splice(index, 1);
    }
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
    
    container.innerHTML = '';
    
    if (selectedItemsArray.length === 0) {
        const placeholder = document.createElement('span');
        placeholder.className = 'keyword-placeholder';
        placeholder.textContent = `No ${itemType}s selected`;
        container.appendChild(placeholder);
        return;
    }
    
    selectedItemsArray.forEach(item => {
        const tag = document.createElement('div');
        tag.className = 'keyword-tag';
        
        const text = document.createElement('span');
        text.textContent = item;
        text.className = 'keyword-tag-text';
        
        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '×';
        removeBtn.className = 'keyword-tag-remove';
        removeBtn.addEventListener('click', () => removeItem(item, selectedItemsArray, itemType));
        
        tag.appendChild(text);
        tag.appendChild(removeBtn);
        container.appendChild(tag);
    });
}

function initializeSuburbSearch() {
    allSuburbs = extractUniqueValues(playgroundData, 'suburb'); // Changed from extractUniqueValuesForSearch
    initializeMultiSelectSearch('suburbSearchInput', 'suburbDropdown', allSuburbs, selectedSuburbs, 'suburb');
}

function clearAllSuburbs() {
    clearAllItems(selectedSuburbs, 'suburb');
}

function initializeLGASearch() {
    allLGAs = extractUniqueValues(playgroundData, 'lga'); // Changed from extractUniqueValuesForSearch
    initializeMultiSelectSearch('lgaSearchInput', 'lgaDropdown', allLGAs, selectedLGAs, 'lga');
}

function clearAllLGAs() {
    clearAllItems(selectedLGAs, 'lga');
}


// ===== KEYWORD SEARCH FUNCTIONALITY =====
// Needs special function as this is comma separated values inside a cell 
function extractAllKeywords(data) {
    const keywordSet = new Set();
    
    if (!data || data.length === 0) return [];
    
    data.forEach(playground => {
        const keywords = playground.keywords;
        if (keywords && keywords.trim() !== '') {
            keywords.split(',').forEach(keyword => {
                const trimmed = keyword.trim();
                if (trimmed) {
                    keywordSet.add(trimmed);
                }
            });
        }
    });
    
    return Array.from(keywordSet).sort((a, b) => 
        a.toLowerCase().localeCompare(b.toLowerCase())
    );
}

function initializeKeywordSearch() {
    allKeywords = extractAllKeywords(playgroundData);
    initializeMultiSelectSearch('keywordSearchInput', 'keywordDropdown', allKeywords, selectedKeywords, 'keyword');
}

function clearAllKeywords() {
    clearAllItems(selectedKeywords, 'keyword');
}

function playgroundMatchesKeywords(playground) {
    if (selectedKeywords.length === 0) return true;
    
    const playgroundKeywords = playground.keywords;
    if (!playgroundKeywords || playgroundKeywords.trim() === '') return false;
    
    const playgroundKeywordList = playgroundKeywords
        .split(',')
        .map(k => k.trim().toLowerCase());
    
    return selectedKeywords.some(selectedKeyword => 
        playgroundKeywordList.includes(selectedKeyword.toLowerCase())
    );
}

// Show the other buttons once something is selected
function updateSelectedItemsDisplay(selectedItemsArray, itemType) {
    const containerId = `selected${itemType.charAt(0).toUpperCase() + itemType.slice(1)}s`;
    const container = document.getElementById(containerId);
    if (!container) return;

    // Find the closest .mt-2 wrapper (the section that should show/hide)
    const wrapper = container.closest('.mt-2');
    container.innerHTML = '';

    if (selectedItemsArray.length === 0) {
        const placeholder = document.createElement('span');
        placeholder.className = 'keyword-placeholder';
        placeholder.textContent = `No ${itemType}s selected`;
        container.appendChild(placeholder);

        // Hide the wrapper if it exists
        if (wrapper) wrapper.style.display = 'none';
        return;
    }

    // Otherwise, create tags for each selected item
    selectedItemsArray.forEach(item => {
        const tag = document.createElement('div');
        tag.className = 'keyword-tag';
        
        const text = document.createElement('span');
        text.textContent = item;
        text.className = 'keyword-tag-text';
        
        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '×';
        removeBtn.className = 'keyword-tag-remove';
        removeBtn.addEventListener('click', () => removeItem(item, selectedItemsArray, itemType));
        
        tag.appendChild(text);
        tag.appendChild(removeBtn);
        container.appendChild(tag);
    });

    // Show the wrapper when items exist
    if (wrapper) wrapper.style.display = 'block';
}


// ===== MOBILE DRAWER FUNCTIONALITY =====
function initializeMobileDrawer() {
  if (window.innerWidth > 768) return; // Only on mobile

  const sidebar = document.querySelector('.w-80');
  const handle = document.getElementById('drawerHandle');
  
  if (!sidebar || !handle) return;

  // Start in partial state
  sidebar.classList.add('drawer-collapsed');
  let currentState = 'collapsed';

  // Click to cycle states
  handle.addEventListener('click', () => {
    sidebar.classList.remove('drawer-collapsed', 'drawer-partial', 'drawer-full');
    
    if (currentState === 'collapsed') {
      sidebar.classList.add('drawer-partial');
      currentState = 'partial';
    } else if (currentState === 'partial') {
      sidebar.classList.add('drawer-full');
      currentState = 'full';
    } else {
      sidebar.classList.add('drawer-collapsed');
      currentState = 'collapsed';
    }
  });

  // Touch drag handling
  let touchStartY = 0;
  let isDragging = false;
  let initialState = '';

  handle.addEventListener('touchstart', (e) => {
    isDragging = true;
    touchStartY = e.touches[0].clientY;
    initialState = currentState;
  });

  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    
    const touchCurrentY = e.touches[0].clientY;
    const deltaY = touchCurrentY - touchStartY;
    
    sidebar.classList.remove('drawer-collapsed', 'drawer-partial', 'drawer-full');
    
    if (deltaY > 100 && initialState === 'full') {
      sidebar.classList.add('drawer-partial');
      currentState = 'partial';
      isDragging = false;
    } else if (deltaY > 100 && initialState === 'partial') {
      sidebar.classList.add('drawer-collapsed');
      currentState = 'collapsed';
      isDragging = false;
    } else if (deltaY < -100 && initialState === 'collapsed') {
      sidebar.classList.add('drawer-partial');
      currentState = 'partial';
      isDragging = false;
    } else if (deltaY < -100 && initialState === 'partial') {
      sidebar.classList.add('drawer-full');
      currentState = 'full';
      isDragging = false;
    } else {
      sidebar.classList.add(currentState);
    }
  });

  document.addEventListener('touchend', () => {
    isDragging = false;
  });
console.log('Drawer initialized');
}



// ===== MODAL AND EDIT FUNCTIONALITY =====

// ===== POPULATE EDIT FORM DROPDOWNS FROM DATABASE =====

// Call this function when loading playground data
function populateEditFormDropdowns() {
    if (!playgroundData || playgroundData.length === 0) {
        console.warn('No playground data available to populate form dropdowns');
        return;
    }

    // Extract unique values from the database
    const types = extractUniqueValues(playgroundData, 'type');
    const shadeOptions = extractUniqueValues(playgroundData, 'shade');
    const fencingOptions = extractUniqueValues(playgroundData, 'fencing');
    const parkingOptions = extractUniqueValues(playgroundData, 'parking');
    const seatingOptions = extractUniqueValues(playgroundData, 'seating');
    const floorOptions = extractUniqueValues(playgroundData, 'floor');

    // Sort with custom order (optional)
    const typesSorted = sortWithCustomOrder(types, [
        'Council Playground',
        'Private Playground', 
        'School Playground'
    ]);   

    const shadeSorted = sortWithCustomOrder(shadeOptions, [
        'Natural and Sail',
        'Sail', 
        'Natural',
        'No Shade'
    ]);    

    const fencingSorted = sortWithCustomOrder(fencingOptions, [
        'Fully Fenced',
        'Partially Fenced', 
        'Natural Fence',
        'No Fence'
    ]);

    // Populate the form dropdowns
    populateFormDropdown('edit-type', typesSorted);
    populateFormDropdown('edit-shade', shadeSorted);
    populateFormDropdown('edit-fencing', fencingSorted);
    populateFormDropdown('edit-parking', parkingOptions);
    populateFormDropdown('edit-seating', seatingOptions);
    populateFormDropdown('edit-floor', floorOptions);

    console.log('Edit form dropdowns populated from database');
}

// Helper function to populate a single dropdown
function populateFormDropdown(selectId, options) {
    const selectElement = document.getElementById(selectId);
    
    if (!selectElement) {
        console.warn(`Dropdown element not found: ${selectId}`);
        return;
    }

    // Clear existing options except the first (placeholder)
    while (selectElement.options.length > 1) {
        selectElement.remove(1);
    }

    // Add options from database
    options.forEach(value => {
        if (value) { // Skip null/undefined values
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            selectElement.appendChild(option);
        }
    });
}

// Helper function to sort with custom order (reuse your existing one)
function sortWithCustomOrder(items, customOrder) {
    return items.sort((a, b) => {
        const indexA = customOrder.indexOf(a);
        const indexB = customOrder.indexOf(b);
        
        // If both are in custom order, sort by their position
        if (indexA !== -1 && indexB !== -1) {
            return indexA - indexB;
        }
        
        // If only A is in custom order, it comes first
        if (indexA !== -1) return -1;
        
        // If only B is in custom order, it comes first
        if (indexB !== -1) return 1;
        
        // If neither is in custom order, sort alphabetically
        return a.localeCompare(b);
    });
}


function editPlayground(uniqueId) {
    const normalizedId = uniqueId ? uniqueId.toString().trim() : null;
    const playgroundData = playgroundLookup[normalizedId];
    
    currentEditingPlayground = { uid: normalizedId, data: playgroundData };
    
    const modal = document.getElementById('editModal');

    populateEditForm(playgroundData); 
    
    // Ensure the modal is visible (assuming modal CSS has high z-index and fixed positioning)
    modal.style.display = 'block'; 
}

// populateEditForm to work with dropdowns
function populateEditForm(playgroundData) {
    console.log("Populating form with data:", playgroundData);
    
    // Text inputs - direct mapping
    const textFields = ['name', 'keywords', 'comments', 'link'];
    
    textFields.forEach(field => {
        const element = document.getElementById(`edit-${field}`);
        if (element) element.value = playgroundData[field] || '';
    });
    
    // Dropdown fields - direct mapping
    const dropdownFields = ['type', 'shade', 'parking', 'fencing', 'seating', 'floor'];
    
    dropdownFields.forEach(field => {
        const element = document.getElementById(`edit-${field}`);
        if (element) element.value = playgroundData[field] || '';
    });
    
    // Checkboxes - direct mapping
    const checkboxFields = [
        'toilet', 'bbq', 'bubbler', 'accessible', 'basketball', 
        'skate_park', 'scooter_track', 'cricket_chute', 'tennis_court', 
        'pump_track', 'activity_wall', 'talking_tube', 'musical_play', 
        'sensory_play', 'sandpit', 'water_play'
    ];
    
    checkboxFields.forEach(field => {
        const element = document.getElementById(`edit-${field}`);
        if (element) {
            element.checked = playgroundData[field] === true;
            console.log(`${field}: Value = ${playgroundData[field]}, Checked = ${element.checked}`);
        }
    });
    
    // Number inputs - direct mapping (all fields now match!)
    const numberFields = [
        // Swings
        'baby_swing', 'belt_swing', 'basket_swing', 'dual_swing', 'hammock',
        // Slides
        'straight_slide', 'spiral_slide', 'tube_slide', 'double_slide', 'triple_slide',
        // Climbing (now all match DB fields!)
        'stairs', 'metal_ladder', 'rope_ladder', 'rock_climbing', 
        'monkey_bars', 'other_climbing', 'rope_gym',
        // Balance
        'spinning_pole', 'spinning_bucket', 'merry_go_round', 'balance_beam', 
        'stepping_stones', 'spring_rocker', 'seesaw',
        // Other
        'bridge', 'tunnel', 'trampoline', 'firemans_pole', 'hamster_wheel'
    ];
    
    numberFields.forEach(field => {
        const element = document.getElementById(`edit-${field}`);
        if (element) {
            element.value = playgroundData[field] || '';
            console.log(`${field}: Value = ${playgroundData[field]}`);
        }
    });
}

function setupModalEventListeners() {
    const modal = document.getElementById('editModal');
    const closeBtn = document.getElementById('closeModalBtn');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent any default behavior
            e.stopPropagation(); // Stop event from bubbling
            modal.style.display = 'none';
            console.log('Close button clicked'); // Debug log
        });
    } else {
        console.log('Close button not found!'); // Debug log
    }
    
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
}

// ===== SUBMIT EDIT TO SUPABASE STAGING =====
// Updated setupFormSubmission to save to Supabase
function setupFormSubmission() {
    const form = document.getElementById('editForm');
    if (!form) return;
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitButton = form.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.textContent;
        
        // Show loading state
        submitButton.disabled = true;
        submitButton.textContent = 'Submitting...';
        
        try {
            const formData = collectFormData();
            console.log('Submitting edit:', formData);
            
            // Submit to Supabase
            const result = await submitEditToSupabase(formData);
            
            if (result.success) {
                showSuccessMessage();
            } else {
                showErrorMessage(result.error);
            }
            
        } catch (error) {
            console.error('Error submitting edit:', error);
            showErrorMessage(error.message);
        } finally {
            // Reset button
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
        }
    });
}

// Submit edit suggestion to Supabase staging table
async function submitEditToSupabase(formData) {
    try {
        // Get the original playground data for comparison
        const originalData = playgroundLookup[formData.playgroundId];
        
        // Prepare data for staging table - matching your actual schema
        const editSuggestion = {
            uid: formData.playgroundId, // Keep original playground uid
            submitted_at: new Date().toISOString(),
            submitted_by_email: formData.email || 'anonymous@playground.com',
            status: 'pending', // pending, approved, rejected
            
            // Text fields
            name: formData.name || null,
            type: formData.type || null,
            keywords: formData.keywords || null,
            comments: formData.comments || null,
            shade: formData.shade || null,
            parking: formData.parking || null,
            fencing: formData.fencing || null,
            seating: formData.seating || null,
            floor: formData.floor || null,
            
            // Boolean fields (as actual booleans, not 'Yes'/'No')
            toilet: formData.toilet,
            bbq: formData.bbq,
            bubbler: formData.bubbler,
            accessible: formData.accessible,
            basketball: formData.basketball,
            pump_track: formData.pumpTrack,
            scooter_track: formData.scooterTrack,
            cricket_chute: formData.cricketChute,
            tennis_court: formData.tennisCourt,
            skate_park: formData.skatePark,
            activity_wall: formData.activityWall,
            talking_tube: formData.talkingTube,
            musical_play: formData.musicalPlay,
            sensory_play: formData.sensoryPlay,
            sandpit: formData.sandpit,
            water_play: formData.waterPlay,
            
            // Numeric fields
            baby_swing: parseInt(formData.babySwing) || null,
            belt_swing: parseInt(formData.beltSwing) || null,
            basket_swing: parseInt(formData.basketSwing) || null,
            dual_swing: parseInt(formData.dualSwing) || null,
            hammock: parseInt(formData.hammock) || null,
            double_slide: parseInt(formData.doubleSlide) || null,
            triple_slide: parseInt(formData.tripleSlide) || null,
            straight_slide: parseInt(formData.straightSlide) || null,
            tube_slide: parseInt(formData.tubeSlide) || null,
            spiral_slide: parseInt(formData.spiralSlide) || null,
            stairs: parseInt(formData.stairs) || null,
            metal_ladder: parseInt(formData.metalLadder) || null,
            rope_ladder: parseInt(formData.ropeLadder) || null,
            rock_climbing: parseInt(formData.rockClimbing) || null,
            monkey_bars: parseInt(formData.monkeyBars) || null,
            other_climbing: parseInt(formData.otherClimbing) || null,
            rope_gym: parseInt(formData.ropeGym) || null,
            spinning_pole: parseInt(formData.spinningPole) || null,
            spinning_bucket: parseInt(formData.spinningBucket) || null,
            merry_go_round: parseInt(formData.merryGoRound) || null,
            balance_beam: parseInt(formData.balanceBeam) || null,
            stepping_stones: parseInt(formData.steppingStones) || null,
            spring_rocker: parseInt(formData.springRocker) || null,
            seesaw: parseInt(formData.seesaw) || null,
            bridge: parseInt(formData.bridge) || null,
            tunnel: parseInt(formData.tunnel) || null,
            trampoline: parseInt(formData.trampoline) || null,
            firemans_pole: parseInt(formData.firemansPole) || null,
            hamster_wheel: parseInt(formData.hamsterWheel) || null,
            
            // Media
            photo: formData.photo || null,
            link: formData.link || null,
        };

        // Calculate what changed
        const changes = comparePlaygroundData(originalData, editSuggestion);

        // Insert into staging table
        const { data, error } = await supabase
            .from('playgrounds_edit_suggestions')
            .insert([editSuggestion])
            .select();

        if (error) {
            console.error('Supabase error:', error);
            return { success: false, error: error.message };
        }

        console.log('Edit suggestion submitted successfully:', data);
        
        // Trigger email notification with changes
        await sendEmailNotification(editSuggestion, changes);

        return { success: true, data: data };

    } catch (error) {
        console.error('Error in submitEditToSupabase:', error);
        return { success: false, error: error.message };
    }
}

// Compare original and edited playground data - SIMPLIFIED
function comparePlaygroundData(original, edited) {
    const changes = [];
    
    // Display names for the email (human-readable versions)
    const displayNames = {
        name: 'Name',
        type: 'Type',
        keywords: 'Keywords',
        comments: 'Comments',
        shade: 'Shade',
        parking: 'Parking',
        fencing: 'Fencing',
        seating: 'Seating',
        floor: 'Floor',
        toilet: 'Toilet',
        bbq: 'BBQ',
        bubbler: 'Bubbler',
        accessible: 'Accessible',
        basketball: 'Basketball',
        pump_track: 'Pump Track',
        scooter_track: 'Scooter Track',
        cricket_chute: 'Cricket Chute',
        tennis_court: 'Tennis Court',
        skate_park: 'Skate Park',
        activity_wall: 'Activity Wall',
        talking_tube: 'Talking Tube',
        musical_play: 'Musical Play',
        sensory_play: 'Sensory Play',
        sandpit: 'Sandpit',
        water_play: 'Water Play',
        baby_swing: 'Baby Swings',
        belt_swing: 'Belt Swings',
        basket_swing: 'Basket Swings',
        dual_swing: 'Dual Swings',
        hammock: 'Hammocks',
        double_slide: 'Double Slides',
        triple_slide: 'Triple Slides',
        straight_slide: 'Straight Slides',
        tube_slide: 'Tube Slides',
        spiral_slide: 'Spiral Slides',
        stairs: 'Stairs',
        metal_ladder: 'Metal Ladders',
        rope_ladder: 'Rope Ladders',
        rock_climbing: 'Rock Climbing',
        monkey_bars: 'Monkey Bars',
        other_climbing: 'Other Climbing',
        rope_gym: 'Rope Gym',
        spinning_pole: 'Spinning Poles',
        spinning_bucket: 'Spinning Buckets',
        merry_go_round: 'Merry Go Rounds',
        balance_beam: 'Balance Beams',
        stepping_stones: 'Stepping Stones',
        spring_rocker: 'Spring Rockers',
        seesaw: 'Seesaws',
        bridge: 'Bridges',
        tunnel: 'Tunnels',
        trampoline: 'Trampolines',
        firemans_pole: 'Firemans Poles',
        hamster_wheel: 'Hamster Roller Wheels',
        photo: 'Photo',
        link: 'Link'
    };
    
    // Compare each field - now both objects use the same field names!
    for (const field of Object.keys(displayNames)) {
        const originalValue = original[field];
        const editedValue = edited[field];
        
        // Normalize values for comparison
        const normalizedOriginal = normalizeValue(originalValue);
        const normalizedEdited = normalizeValue(editedValue);
        
        // Check if values are different
        if (normalizedOriginal !== normalizedEdited) {
            changes.push({
                field: displayNames[field],
                oldValue: formatValue(originalValue),
                newValue: formatValue(editedValue)
            });
        }
    }
    
    return changes;
}

// Normalize values for comparison (handle null, undefined, empty strings, 0)
function normalizeValue(value) {
    if (value === null || value === undefined || value === '' || value === 0) {
        return null;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        return value.trim().toLowerCase();
    }
    return value;
}

// Format value for display in email
function formatValue(value) {
    if (value === null || value === undefined || value === '') {
        return '<em>empty</em>';
    }
    if (typeof value === 'boolean') {
        return value ? 'Yes' : 'No';
    }
    return String(value);
}

// Normalize values for comparison (handle null, undefined, empty strings, 0)
function normalizeValue(value) {
    if (value === null || value === undefined || value === '' || value === 0) {
        return null;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        return value.trim().toLowerCase();
    }
    return value;
}

// Format value for display in email
function formatValue(value) {
    if (value === null || value === undefined || value === '') {
        return '<em>empty</em>';
    }
    if (typeof value === 'boolean') {
        return value ? 'Yes' : 'No';
    }
    return String(value);
}

// Send email notification (using Supabase Edge Function)
async function sendEmailNotification(editData, changes) {
    try {
        // Call your Supabase Edge Function to send email
        const { data, error } = await supabase.functions.invoke('email-notification-edit', {
            body: {
                playgrounduid: editData.uid,
                playgroundName: editData.name,
                submittedBy: editData.submitted_by_email,
                submittedAt: editData.submitted_at,
                changes: changes // Pass the changes array
            }
        });

        if (error) {
            console.error('Email notification error:', error);
            console.error('Error details:', error.message, error.context);
        } else {
            console.log('Email notification sent successfully:', data);
        }
    } catch (error) {
        console.error('Failed to send email notification:', error);
        console.error('Error type:', error.constructor.name);
        // Don't fail the whole submission if email fails
    }
}

// Updated collectFormData to include skate park
function collectFormData() {
    const getValue = (id) => document.getElementById(id)?.value || '';
    const getChecked = (id) => document.getElementById(id)?.checked || false;
    
    return {
        playgroundId: currentEditingPlayground.uid,
        // Basic info
        name: getValue('edit-name'),
        type: getValue('edit-type'),
        keywords: getValue('edit-keywords'),
        comments: getValue('edit-comments'),
        // Facilities
        shade: getValue('edit-shade'),
        parking: getValue('edit-parking'),
        fencing: getValue('edit-fencing'),
        seating: getValue('edit-seating'),
        floor: getValue('edit-floor'),
        toilet: getChecked('edit-toilet'),
        bbq: getChecked('edit-bbq'),
        bubbler: getChecked('edit-bubbler'),
        accessible: getChecked('edit-accessible'),
        // Activities
        basketball: getChecked('edit-basketball'),
        skatePark: getChecked('edit-skate_park'),
        pumpTrack: getChecked('edit-pump_track'),
        scooterTrack: getChecked('edit-scooter_track'),
        cricketChute: getChecked('edit-cricket_chute'),
        tennisCourt: getChecked('edit-tennis_court'),
        activityWall: getChecked('edit-activity_wall'),
        talkingTube: getChecked('edit-talking_tube'),
        musicalPlay: getChecked('edit-musical_play'),
        sensoryPlay: getChecked('edit-sensory_play'),
        sandpit: getChecked('edit-sandpit'),
        waterPlay: getChecked('edit-water_play'),
        ropeGym: getChecked('edit-rope_gym'),
        // Equipment counts
        babySwing: getValue('edit-baby_swing'),
        beltSwing: getValue('edit-belt_swing'),
        basketSwing: getValue('edit-basket_swing'),
        dualSwing: getValue('edit-dual_swing'),
        hammock: getValue('edit-hammock'),
        doubleSlide: getValue('edit-double_slide'),
        straightSlide: getValue('edit-straight_slide'),
        tubeSlide: getValue('edit-tube_slide'),
        spiralSlide: getValue('edit-spiral_slide'),
        stairs: getValue('edit-stairs'),
        metalLadder: getValue('edit-metal_ladder'),
        ropeLadder: getValue('edit-rope_ladder'),
        rockClimbing: getValue('edit-rock_climbing'),
        monkeyBars: getValue('edit-monkey_bars'),
        otherClimbing: getValue('edit-other_climbing'),
        spinningPole: getValue('edit-spinning_pole'),
        spinningBucket: getValue('edit-spinning_bucket'),
        merryGoRound: getValue('edit-merry_go_round'),
        balanceBeam: getValue('edit-balance_beam'),
        steppingStones: getValue('edit-stepping_stones'),
        springRocker: getValue('edit-spring_rocker'),
        seesaw: getValue('edit-seesaw'),
        bridge: getValue('edit-bridge'),
        tunnel: getValue('edit-tunnel'),
        trampoline: getValue('edit-trampoline'),
        firemansPole: getValue('edit-firemans_pole'),
        hamsterWheel: getValue('edit-hamster_wheel'),
        // Media and contact
        photo: getValue('edit-photo'),
        link: getValue('edit-link'),
        email: getValue('edit-email')
    };
}

// Show error message
function showErrorMessage(errorText) {
    const errorMessage = document.getElementById('error-message');
    const editForm = document.getElementById('editForm');
    
    if (errorMessage) {
        errorMessage.textContent = `Error: ${errorText}`;
        errorMessage.style.display = 'block';
    } else {
        alert(`Error submitting edit: ${errorText}`);
    }
    
    setTimeout(() => {
        if (errorMessage) errorMessage.style.display = 'none';
    }, 5000);
}

// Keep your existing showSuccessMessage function
function showSuccessMessage() {
    const successMessage = document.getElementById('success-message');
    const editForm = document.getElementById('editForm');
    const modal = document.getElementById('editModal');
    
    if (successMessage) successMessage.style.display = 'block';
    if (editForm) editForm.style.display = 'none';
    
    setTimeout(() => {
        if (modal) modal.style.display = 'none';
        if (successMessage) successMessage.style.display = 'none';
        if (editForm) {
            editForm.style.display = 'block';
            editForm.reset();
        }
    }, 3000);
}

function setupDrawerHandleText() {
    const drawer = document.querySelector('.w-80.bg-white.shadow-lg');
    const drawerHandleText = document.querySelector('.drawer-handle-text');
    const playgroundCountMobile = document.getElementById('playgroundCountMobile');
    
    if (!drawer || !drawerHandleText) return;
    
    // Function to update text based on drawer state
    function updateDrawerText() {
        const isFullyExpanded = drawer.classList.contains('drawer-full');
        const playgroundCount = playgroundCountMobile ? playgroundCountMobile.textContent : '33 playgrounds';
        
        if (isFullyExpanded) {
            drawerHandleText.innerHTML = `<span class="playgroundCount">${playgroundCount}</span> • Tap to minimise`;
        } else {
            drawerHandleText.innerHTML = `<span class="playgroundCount">${playgroundCount}</span> • Tap to expand`;
        }
    }
    
    // Call initially
    updateDrawerText();
    
    // Update text whenever drawer state changes
    const observer = new MutationObserver(updateDrawerText);
    observer.observe(drawer, { attributes: true, attributeFilter: ['class'] });
}

// ===== UI HELPER FUNCTIONS =====
function toggleFooter() {
    const footer = document.getElementById('footer');
    const footerToggle = document.getElementById('footerToggle');
    
    if (!footer || !footerToggle) return;
    
    footer.classList.toggle('open');
    footerToggle.style.display = footer.classList.contains('open') ? 'none' : 'block';
}

function setupEventListeners() {
    // Dropdown toggles
    const typeBtn = document.getElementById('typeDropdownBtn');
    const shadeBtn = document.getElementById('shadeDropdownBtn');
    const fencingBtn = document.getElementById('fencingDropdownBtn');
    const parkingBtn = document.getElementById('parkingDropdownBtn'); 

    if (typeBtn) {
        typeBtn.addEventListener('click', () => 
            toggleDropdown('typeDropdownMenu', 'lgaDropdownMenu', 'suburbDropdownMenu'));
    }

    if (shadeBtn) {
        shadeBtn.addEventListener('click', () => toggleDropdown('shadeDropdownMenu'));
    }

    if (fencingBtn) {
        fencingBtn.addEventListener('click', () => toggleDropdown('fencingDropdownMenu'));
    }

    if (parkingBtn) {
        parkingBtn.addEventListener('click', () => toggleDropdown('parkingDropdownMenu'));
    }

    // Filter event listeners (excluding the old size filter checkboxes)
    const filterIds = [
        'filterHasTrampoline', 'filterHasSkatePark', 'filterHasLargeFlyingFox', 'filterHasSandpit', 'filterHasScootTrack', 'filterHasWaterPlay', 'filterHasAccessibleFeatures', 'filterHasToilet', 'filterHasBBQ', 'filterHasBubbler'
    ];

    filterIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.addEventListener('change', filterMarkers);
    });
    
    // Initialize size slider
    initializeSizeSlider();
    
    // Footer toggle
    const footerToggle = document.getElementById('footerToggle');
    if (footerToggle) footerToggle.addEventListener('click', toggleFooter);
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', handleOutsideClick);
    
    // Modal and form setup
    setupModalEventListeners();
    setupFormSubmission();

    // Drawer handle text
    setupDrawerHandleText();
}

function handleOutsideClick(event) {
    const dropdownConfigs = [
        { btn: 'typeDropdownBtn', menu: 'typeDropdownMenu' },
        { btn: 'shadeDropdownBtn', menu: 'shadeDropdownMenu' },
        { btn: 'fencingDropdownBtn', menu: 'fencingDropdownMenu' },
        { btn: 'parkingDropdownBtn', menu: 'parkingDropdownMenu' }
    ];
    
    dropdownConfigs.forEach(({ btn, menu }) => {
        const button = document.getElementById(btn);
        const dropdown = document.getElementById(menu);
        
        if (button && dropdown && 
            !button.contains(event.target) && 
            !dropdown.contains(event.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

// ===== SEARCH FUNCTIONALITY =====
function addSearchControl() {
    const mapContainer = document.getElementById('map');
    
    if (!mapContainer) {
        console.error('Map container not found! Cannot add search.');
        return;
    }
    
    const searchContainer = document.createElement('div');
    searchContainer.id = 'search-container';
    
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
        if (layersControl && searchContainer) {
            console.log('Moving layers control into search container');
            searchContainer.appendChild(layersControl);
        }
    }, 100);
    
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    
    if (searchInput && searchBtn) {
        searchBtn.addEventListener('click', () => {
            performSearch();
        });
        if (searchInput) {
            searchInput.addEventListener('input', handleSuggestions);
        }
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
        console.log('Search event listeners added successfully');
    } else {
        console.error('Could not find search input or button after creation');
    }
}

function handleSuggestions() {
    const query = searchInput.value.trim().toLowerCase();
    const suggestionsContainer = document.getElementById('suggestions');
    suggestionsContainer.innerHTML = '';

    if (!query || !playgroundData || playgroundData.length === 0) {
        suggestionsContainer.style.display = 'none';
        return;
    }

    const matches = playgroundData
        .filter(pg => pg.name && pg.name.toLowerCase().includes(query))
        .slice(0, 6); // limit to 6 suggestions

    if (matches.length === 0) {
        suggestionsContainer.style.display = 'none';
        return;
    }

    matches.forEach(match => {
        const suggestionItem = document.createElement('div');
        suggestionItem.className = 'dropdown-option';
        suggestionItem.textContent = match.name;

        suggestionItem.addEventListener('click', () => {
            searchInput.value = match.name;
            suggestionsContainer.innerHTML = '';
            suggestionsContainer.style.display = 'none';
            // Pan to playground
            map.setView([match.lat, match.lng], 16);
            addSearchResultMarker(match.lat, match.lng, match.name, true);
        });

        suggestionsContainer.appendChild(suggestionItem);
    });

    suggestionsContainer.style.display = 'block';
}
// Hide suggestions when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-container')) {
        const suggestionsContainer = document.getElementById('suggestions');
        if (suggestionsContainer) {
            suggestionsContainer.innerHTML = '';
            suggestionsContainer.style.display = 'none';
        }
    }
});

// Search functionality - searches both playgrounds and locations
async function performSearch() {
    const searchInput = document.getElementById('searchInput');
    const query = searchInput.value.trim();
    
    if (!query) return;
    
    const searchBtn = document.getElementById('searchBtn');
    const originalText = searchBtn.innerHTML;
    searchBtn.innerHTML = '⏳';
    searchBtn.disabled = true;
    
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=au`);
        const results = await response.json();
        
        if (results && results.length > 0) {
            const result = results[0];
            const lat = parseFloat(result.lat);
            const lng = parseFloat(result.lon);
            
            map.setView([lat, lng], 14);
            addSearchResultMarker(lat, lng, result.display_name, false);
            searchInput.value = '';
        } else {
            const playgroundMatch = searchPlaygrounds(query);
            
            if (playgroundMatch) {
                // Use lat/lng directly from playground object
                map.setView([playgroundMatch.lat, playgroundMatch.lng], 16);
                addSearchResultMarker(playgroundMatch.lat, playgroundMatch.lng, playgroundMatch.name, true);
                searchInput.value = '';
            } else {
                alert('Location or playground not found. Try a different search term.');
            }
        }
    } catch (error) {
        console.error('Search error:', error);
        alert('Search failed. Please try again.');
    }
    
    searchBtn.innerHTML = originalText;
    searchBtn.disabled = false;
}

// Search through playground names in data
function searchPlaygrounds(query) {
    if (!playgroundData || playgroundData.length === 0) {
        return null;
    }
    
    const lowerQuery = query.toLowerCase();
    
    const match = playgroundData.find(playground => {
        const name = playground.name;
        return name && name.toLowerCase().includes(lowerQuery);
    });
    
    return match || null;
}

// Add a temporary marker for search results
let searchMarker = null;
function addSearchResultMarker(lat, lng, displayName, isPlayground) {
    // Remove any existing search marker
    if (searchMarker) {
        map.removeLayer(searchMarker);
        searchMarker = null;
    }
    
    // Choose icon based on search type
    const iconHtml = isPlayground ? '🔍' : '📍';
    const label = isPlayground ? 'Playground Found!' : 'Search Result';
    
    searchMarker = L.marker([lat, lng], {
        icon: L.divIcon({
            html: `
                <div style="
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 40px;
                    height: 40px;
                    font-size: 24px;
                    line-height: 1;
                    pointer-events: none;
                ">
                    ${iconHtml}
                </div>
            `,
            className: 'search-result-marker',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        }),
        interactive: false // This prevents Leaflet from adding event listeners
    });
    
    searchMarker.addTo(map);
    
    // Remove after 8 seconds
    setTimeout(() => {
        if (searchMarker) {
            map.removeLayer(searchMarker);
            searchMarker = null;
        }
    }, 8000);
}

// ===== INITIALIZATION =====
function initializeApp() {
    console.log('initializeApp started');
    
    initializeMap();
    initializeClusterGroup();
    
    // Load data first, THEN initialize search after data is loaded
    loadPlaygroundData().then(() => {
        console.log('Data loaded, initializing searches');
        initializeKeywordSearch();
        initializeSuburbSearch();
        initializeLGASearch();
        addSearchControl();
    });
    
    setupEventListeners();
    initializeMobileDrawer();

    // Update count when map moves/zooms
    map.on('moveend zoomend', updateVisiblePlaygroundCount);
    
    console.log('initializeApp completed');
}

// ===== BACKWARD COMPATIBILITY =====
function getMarkerColor(classification) {
    return getMarkerSizeConfig(classification).fillColor;
}

// ===== APP STARTUP =====
document.addEventListener('DOMContentLoaded', initializeApp);