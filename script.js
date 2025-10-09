// ===== GLOBAL VARIABLES =====
let playgroundData = null;
let markerClusterGroup;
let currentEditingPlayground = null;
let map;
const playgroundLookup = {};
let allKeywords = [];
let selectedKeywords = [];

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
    return props.fid || props.id || Math.random().toString(36).substr(2, 9);
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
        const rating = marker.playgroundData.Classification || marker.playgroundData.size;
        const ratingIndex = ratingHierarchy.indexOf(rating);
        
        if (ratingIndex !== -1 && ratingIndex < highestRatingIndex) {
            highestRatingIndex = ratingIndex;
            highestRating = rating;
        }
    });
    
    return highestRating || (markers[0].playgroundData.Classification || markers[0].playgroundData.size);
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
    const sizeConfig = getMarkerSizeConfig(playground.Classification);

    let marker;

    if (playground.Classification === 'Under Construction') {
        // 🚧 Custom emoji marker
        marker = L.marker([playground.lat, playground.lng], {
            icon: L.divIcon({
                className: 'emoji-marker',
                html: '🚧',
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
    marker.bindTooltip(playground.Name || 'Unnamed Playground', {
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

function addMarkersToMap() {
    if (!playgroundData?.features) {
        console.error('No playground data available');
        return;
    }

    markerClusterGroup.clearLayers();

    playgroundData.features.forEach(playground => {
        const [lng, lat] = playground.geometry.coordinates;
        const props = playground.properties;
        
        const playgroundObj = { ...props, lat, lng };
        const id = generateUniqueId(props);
        playgroundLookup[id] = playgroundObj;

        const marker = createMarker(playgroundObj);
        markerClusterGroup.addLayer(marker);
    });

    map.addLayer(markerClusterGroup);
}

// ===== POPUP FUNCTIONALITY =====
function createPopupContent(props, coordinates) {
    const uniqueId = generateUniqueId(props);
    
    return `
        <div style="font-family: system-ui, -apple-system, sans-serif; min-width: 300px; padding: 12px;">
            ${createPopupHeader({...props, coordinates})}
            ${generateCompactFeaturesList(props)}
            ${createPopupFooter(props, uniqueId)}
        </div>
    `;
}

function createPopupHeader(props) {
    const linkIcon = props.Link ? 
        `🔗` : 
        '';
    
    const mapsIcon = props.coordinates && props.coordinates.length >= 2 ? 
        `<a href="https://www.google.com/maps?q=${props.coordinates[1]},${props.coordinates[0]}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; margin-left: 4px;">📍</a>` : 
        '';
    
    const title = props.Link ? 
        `<a href="${props.Link}" target="_blank" rel="noopener noreferrer" style="text-decoration: none;">${props.Name} ${linkIcon}</a>` : 
        props.Name;
        
    return `
        <div style="margin-bottom: 8px;">
            <h3 style="font-weight: bold; font-size: var(--font-size-lg); margin: 0;">${title}${mapsIcon}</h3>
            <div style="font-style: italic; margin-top: 2px;">${props.Keywords || ''}</div>
        </div>
    `;
}

function createPopupFooter(props, uniqueId) {
    const photo = props.Photo ? `
        <div style="margin-bottom: 4px;">
            <img 
                src="${props.Photo}" 
                style="max-width: 100%; height: auto; border-radius: 4px; cursor: zoom-in;" 
                alt="Playground photo"
                onclick="enlargePhoto(this)"
            >
        </div>` : '';

    const comments = props.Comments ? `<div style="font-style: italic; margin-bottom: 8px;">${props.Comments}</div>` : '';
    
    return `
        <div style="margin-top: 12px; padding-top: 8px; border-top: 2px dotted var(--text-light);">
            ${photo}
            ${comments}
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="color: var(--text-tertiary);">
                    Verified: ${props.Last_Visit_Date ? new Date(props.Last_Visit_Date).toLocaleDateString('en-GB') : 'Unknown'}, ${props.Verified || 'Unknown'}
                </div>
                <button onclick="editPlayground('${uniqueId}')" 
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
    const hasEquipment = equipmentSections.length > 0 || hasValue(props.Accessible);
    
    if (sections.some(s => s) && hasEquipment) {
        sections.push('<div style="border-bottom: 2px dotted var(--text-light); margin-bottom: 8px;"></div>');
    }
    
    if (hasValue(props.Accessible)) {
        sections.push('<div style="margin-bottom: 6px;">♿ Accessible Infrastructure</div>');
    }
    
    sections.push(equipmentSections.join(''));
    
    const activities = createActivitiesSection(props);
    if ((hasEquipment || hasValue(props.Accessible)) && activities) {
        sections.push('<div style="border-bottom: 2px dotted var(--text-light); margin-bottom: 8px; margin-top: 8px;"></div>');
    }
    sections.push(activities);
    
    return sections.filter(Boolean).join('');
}

function createFacilitiesSection(props) {
    const facilities = [];
    if (hasValue(props.Toilet)) facilities.push('🚻 Toilets');
    if (hasValue(props.BBQ)) facilities.push('🔥 BBQ');
    if (hasValue(props.Bubbler)) facilities.push('💧 Bubbler');
    
    return facilities.length > 0 ? `<div style="margin-bottom: 6px;">${facilities.join(', ')}</div>` : '';
}

function createSecondaryFacilitiesSection(props) {
    const facilities = [];
    
    if (hasValue(props.Fencing)) {
        const fenceIcon = (props.Fencing === 'No Fence' || props.Fencing === 'Other') ? '🔓' : '🔒';
        facilities.push(`${fenceIcon} ${props.Fencing}`);
    }
    
    if (hasValue(props.Shade)) {
        const shadeIcon = props.Shade === 'No Shade' ? '☀️' : '🌳';
        facilities.push(`${shadeIcon} ${props.Shade}`);
    }
    
    if (hasValue(props.Parking)) facilities.push(`🚗 ${props.Parking}`);
    
    return facilities.length > 0 ? `<div style="margin-bottom: 8px;">${facilities.join(', ')}</div>` : '';
}

function createSeatingSection(props) {
    return hasValue(props.Seating) ? `<div style="margin-bottom: 8px;">🪑 ${props.Seating}</div>` : '';
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
        { key: 'Baby_Swing', name: 'Baby' },
        { key: 'Belt_Swing', name: 'Belt' },
        { key: 'Basket_Swing', name: 'Basket' },
        { key: 'Dual_Swing', name: 'Dual' },
        { key: 'Hammock', name: 'Hammock' }
    ];
    
    let babySwings = 0;
    swingTypes.forEach(({ key, name }) => {
        const count = parseIntSafe(props[key]);
        if (count) {
            swings.push(name);
            totalSwings += count;
            if (key === 'Baby_Swing') babySwings = count;
        }
    });
    
    if (swings.length === 0) return '';
    
    const maxEmojis = Math.min(totalSwings, 8);
    const babyEmojiCount = Math.min(babySwings, maxEmojis);
    const cartwheelEmojiCount = Math.max(0, maxEmojis - babyEmojiCount);
    
    const swingEmojis = '👶'.repeat(babyEmojiCount) + '🤸‍♀️'.repeat(cartwheelEmojiCount);
    const swingDetails = swings.join(', ');
    
    return createHoverableSection('Swings', props.fid, swingEmojis, swingDetails);
}

function createSlidesSection(props) {
    const slides = [];
    let totalSlides = 0;
    
    const slideTypes = [
        { key: 'Straight_Slide', name: 'Straight' },
        { key: 'Spiral_Curved_Slide', name: 'Spiral/Curved' },
        { key: 'Tube_Slide', name: 'Tube' },
        { key: 'Double_Slide', name: 'Double' },
        { key: 'Triple_Slide', name: 'Triple' }
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

    return createHoverableSection('Slides', props.fid, slideEmojis, slideDetails);
}

function createClimbingSection(props) {
    const climbing = [];
    let totalClimbing = 0;
    
    const climbingTypes = [
        { key: 'Stairs', name: 'Stairs' },
        { key: 'Metal_Ladder', name: 'Metal Ladder' },
        { key: 'Rope_Ladder', name: 'Rope/Chain' },
        { key: 'Rock_Climbing', name: 'Rock' },
        { key: 'Monkey_Bars', name: 'Monkey Bars' },
        { key: 'Rope_Gym', name: 'Rope Gym' },
        { key: 'Other_Climbing', name: 'Other' }
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
    return createHoverableSection('Climbing', props.fid, climbingEmojis, climbingDetails);
}

function createBalanceSection(props) {
    const balance = [];
    let totalBalance = 0;
    
    const balanceTypes = [
        { key: 'Spinning_Pole', name: 'Spinning Pole' },
        { key: 'Spinning_Bucket', name: 'Spinning Bucket' },
        { key: 'Merry_Go_Round', name: 'Merry Go Round' },
        { key: 'Balance_Beam', name: 'Balance Beam' },
        { key: 'Stepping_Stones', name: 'Stepping Stones' },
        { key: 'Spring_Rocker', name: 'Spring Rocker' },
        { key: 'Seesaw', name: 'Seesaw' }
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
    return createHoverableSection('Balance', props.fid, balanceEmojis, balanceDetails);
}

function createOtherEquipmentSection(props) {
    const otherEquip = [];
    let totalOtherEquip = 0;
    
    const equipmentTypes = [
        { key: 'Flying_Fox', name: 'Flying Fox', useHasValue: true },
        { key: 'Firemans_Pole', name: 'Firemans Pole' },
        { key: 'Bridge', name: 'Bridge' },
        { key: 'Tunnel', name: 'Tunnel' },
        { key: 'Trampoline', name: 'Trampoline' },
        { key: 'Hamster_Roller_Wheel', name: 'Hamster or Roller Wheel' }
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
    return createHoverableSection('Other', props.fid, otherEquipEmojis, otherEquipDetails);
}

function createActivitiesSection(props) {
    const activities = [];
    
    const activityTypes = [
        { key: 'Musical_Play', emoji: '🎵', name: 'Musical Play' },
        { key: 'Talking_Tube', emoji: '📞', name: 'Talking Tube' },
        { key: 'Activity_Wall', emoji: '🧩', name: 'Activity Wall' },
        { key: 'Sensory_Play', emoji: '🤏', name: 'Sensory Play' },
        { key: 'Sandpit', emoji: '🏖️', name: 'Sandpit' },
        { key: 'Water_Play', emoji: '💦', name: 'Water Play' },
        { key: 'Basketball', emoji: '🏀', name: 'Basketball' },
        { key: 'Tennis_Court', emoji: '🎾', name: 'Tennis' },
        { key: 'Skate_Park', emoji: '🛹', name: 'Skate Park' },
        { key: 'Scooter_Track', emoji: '🛴', name: 'Scooter Track' },
        { key: 'Pedal_Rail', emoji: '🚂', name: 'Pedal Rail' },
        { key: 'Cricket_Chute', emoji: '🏏', name: 'Cricket' }
    ];
    
    activityTypes.forEach(({ key, emoji, name }) => {
        if (hasValue(props[key])) {
            activities.push(`${emoji} ${name}`);
        }
    });
    
    return activities.length > 0 ? `<div style="margin-bottom: 6px;">${activities.join(', ')}</div>` : '';
}

function createHoverableSection(category, fid, emojis, details) {
    const categoryLower = category.toLowerCase().replace(/\s+/g, '-');
    return `
        <div style="margin-bottom: 4px;">
            <span id="${categoryLower}-word-${fid}" style="color: var(--text-primary) cursor: help;" 
                onmouseenter="highlightSection('${categoryLower}', '${fid}')" 
                onmouseleave="unhighlightSection('${categoryLower}', '${fid}')"
                ontouchstart="highlightSection('${categoryLower}', '${fid}')" 
                ontouchend="setTimeout(() => unhighlightSection('${categoryLower}', '${fid}'), 2000)">
                ${category}
            </span> 
            <span id="${categoryLower}-emoji-${fid}" style="cursor: help;"
                onmouseenter="highlightSection('${categoryLower}', '${fid}')" 
                onmouseleave="unhighlightSection('${categoryLower}', '${fid}')"
                ontouchstart="highlightSection('${categoryLower}', '${fid}')" 
                ontouchend="setTimeout(() => unhighlightSection('${categoryLower}', '${fid}'), 2000)">
                ${emojis}
            </span> 
            <span id="${categoryLower}-details-${fid}" style="color: var(--primary); margin-left: 8px; display: none;">${details}</span>
        </div>
    `;
}

// ===== HOVER EFFECTS =====
function highlightSection(category, fid) {
    const elements = ['word', 'emoji'].map(type => 
        document.getElementById(`${category}-${type}-${fid}`)
    );
    const detailsElement = document.getElementById(`${category}-details-${fid}`);
    
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

function unhighlightSection(category, fid) {
    const elements = ['word', 'emoji'].map(type => 
        document.getElementById(`${category}-${type}-${fid}`)
    );
    const detailsElement = document.getElementById(`${category}-details-${fid}`);
    
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
function toggleAllSuburbs() {
    toggleAllItems('allSuburbs', '.suburb-checkbox', updateSuburbSelection);
}

function toggleAllLGAs() {
    toggleAllItems('allLGAs', '.lga-checkbox', updateLGASelection);
}

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

function updateSuburbSelection() {
    updateSelection('.suburb-checkbox', 'allSuburbs', 'suburbSelected', 'All suburbs', filterMarkers);
}

function updateLGASelection() {
    updateSelection('.lga-checkbox', 'allLGAs', 'lgaSelected', 'All LGAs', filterMarkers);
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
function getSelectedSuburbs() {
    return getSelectedValues('.suburb-checkbox');
}

function getSelectedLGAs() {
    return getSelectedValues('.lga-checkbox');
}

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
        const response = await fetch("http://localhost:8000/TestPlaygrounds.geojson");
        if (response.ok) {
            const fetchedData = await response.json();
            if (fetchedData?.type === "FeatureCollection") {
                playgroundData = fetchedData;
                console.log("Using fetched GeoJSON:", playgroundData);
            } else {
                console.warn("Invalid GeoJSON format");
            }
        } else {
            console.warn("Failed to fetch GeoJSON:", response.status);
        }
    } catch (err) {
        console.warn("Failed to fetch GeoJSON, using inline data.", err);
    }

    if (playgroundData) {
        addMarkersToMap();
        populateDropdowns(playgroundData);
        filterMarkers();
    } else {
        console.error("No playground data available to display");
    }
}

function populateDropdowns(geojsonData) {
    if (!geojsonData?.features) {
        console.warn('No geojsonData provided to populateDropdowns');
        return;
    }

    const suburbs = extractUniqueValues(geojsonData, 'Suburb');
    const lgas = extractUniqueValues(geojsonData, 'LGA');
    const types = extractUniqueValues(geojsonData, 'Type');
    const shade = extractUniqueValues(geojsonData, 'Shade');
    const fencing = extractUniqueValues(geojsonData, 'Fencing');
    const parking = extractUniqueValues(geojsonData, 'Parking');

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

    populateDropdownOptions('suburbOptions', suburbs, 'suburb-checkbox', updateSuburbSelection);
    populateDropdownOptions('lgaOptions', lgas, 'lga-checkbox', updateLGASelection);
    populateDropdownOptions('typeOptions', typesSorted, 'type-checkbox', updateTypeSelection, 'Council Playground');
    populateDropdownOptions('shadeOptions', shadeSorted, 'shade-checkbox', updateShadeSelection);
    populateDropdownOptions('fencingOptions', fencingSorted, 'fence-checkbox', updateFencingSelection);
    populateDropdownOptions('parkingOptions', parking, 'parking-checkbox', updateParkingSelection);
}

function extractUniqueValues(geojsonData, propertyName) {
    return [...new Set(
        geojsonData.features
            .map(feature => feature.properties[propertyName])
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
    if (!playgroundData?.features) return;

    const filters = getActiveFilters();
    markerClusterGroup.clearLayers();
    
    playgroundData.features.forEach(playground => {
        if (shouldShowPlayground(playground, filters)) {
            const [lng, lat] = playground.geometry.coordinates;
            const playgroundObj = { ...playground.properties, lat, lng };
            const marker = createMarker(playgroundObj);
            markerClusterGroup.addLayer(marker);
        }
    });
    
    // Update count based on what's visible in current view
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
        selectedSuburbs: getSelectedSuburbs(),
        selectedLGAs: getSelectedLGAs(),
        selectedTypes: getSelectedTypes()
    };
}

function shouldShowPlayground(playground, filters) {
    const props = playground.properties;
    
    // Facility filters
    if (filters.hasTrampoline && Number(props.Trampoline) <= 0) return false;
    if (filters.hasSkatePark && props.Skate_Park !== 'Yes') return false;
    if (filters.hasLargeFlyingFox && props.Flying_Fox !== 'Large') return false;
    if (filters.hasSandpit && props.Sandpit !== 'Yes') return false;
    if (filters.hasScootTrack && props.Scooter_Track !== 'Yes') return false;
    if (filters.hasWaterPlay && props.Water_Play !== 'Yes') return false;
    if (filters.hasAccessibleFeatures && props.Accessible !== 'Yes') return false;
    if (filters.hasToilet && props.Toilet !== 'Yes') return false;
    if (filters.hasBBQ && props.BBQ !== 'Yes') return false;
    if (filters.hasBubbler && props.Bubbler !== 'Yes') return false;
    
    // Size filter using slider - determine classification: use Classification field, or 'Unverified' if null
    let classification = props.Classification;
    if (!classification || classification === null) {
        classification = 'Unverified';
    }

    if (!isSizeIncluded(classification)) return false;
    
    // Location filters
    if (filters.selectedSuburbs.length > 0 && !filters.selectedSuburbs.includes(props.Suburb)) return false;
    if (filters.selectedLGAs.length > 0 && !filters.selectedLGAs.includes(props.LGA)) return false;
    if (filters.selectedTypes.length > 0 && !filters.selectedTypes.includes(props.Type)) return false;
    if (filters.selectedShade.length > 0 && !filters.selectedShade.includes(props.Shade)) return false;
    if (filters.selectedFencing.length > 0 && !filters.selectedFencing.includes(props.Fencing)) return false;
    if (filters.selectedParking.length > 0 && !filters.selectedParking.includes(props.Parking)) return false;
    
    // Keyword filter
    if (!playgroundMatchesKeywords(playground)) return false;
    
    return true;
}


// ===== KEYWORD SEARCH FUNCTIONALITY =====
// Extract and store all unique keywords from the GeoJSON data
function extractAllKeywords(geojsonData) {
    const keywordSet = new Set();
    
    if (!geojsonData?.features) return [];
    
    geojsonData.features.forEach(feature => {
        const keywords = feature.properties.Keywords;
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

// Initialize keyword search functionality
function initializeKeywordSearch() {
    const input = document.getElementById('keywordSearchInput');
    const dropdown = document.getElementById('keywordDropdown');
    
    if (!input || !dropdown) return;
    
    allKeywords = extractAllKeywords(playgroundData);
    
    input.addEventListener('input', function() {
        const searchTerm = this.value.trim().toLowerCase();
        
        if (searchTerm === '') {
            dropdown.classList.add('hidden');
            return;
        }
        
        const matchingKeywords = allKeywords.filter(keyword => 
            keyword.toLowerCase().includes(searchTerm)
        );
        
        if (matchingKeywords.length > 0) {
            displayKeywordDropdown(matchingKeywords);
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

// Display filtered keywords in dropdown (REFACTORED)
function displayKeywordDropdown(keywords) {
    const dropdown = document.getElementById('keywordDropdown');
    
    dropdown.innerHTML = '';
    dropdown.classList.remove('hidden');
    
    keywords.forEach(keyword => {
        const option = document.createElement('div');
        option.className = 'dropdown-option'; // UPDATED: Use CSS class
        option.textContent = keyword;
        
        option.addEventListener('click', function() {
            selectKeyword(keyword);
        });
        
        dropdown.appendChild(option);
    });
}

// Select a keyword (add to selected list)
function selectKeyword(keyword) {
    if (selectedKeywords.includes(keyword)) {
        return;
    }
    
    selectedKeywords.push(keyword);
    updateSelectedKeywordsDisplay();
    
    const input = document.getElementById('keywordSearchInput');
    const dropdown = document.getElementById('keywordDropdown');
    if (input) input.value = '';
    if (dropdown) dropdown.classList.add('hidden');
    
    filterMarkers();
}

// Remove a keyword from selection
function removeKeyword(keyword) {
    selectedKeywords = selectedKeywords.filter(k => k !== keyword);
    updateSelectedKeywordsDisplay();
    filterMarkers();
}

// Clear all selected keywords
function clearAllKeywords() {
    selectedKeywords = [];
    updateSelectedKeywordsDisplay();
    filterMarkers();
}

// Update the display of selected keywords
function updateSelectedKeywordsDisplay() {
    const container = document.getElementById('selectedKeywords');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (selectedKeywords.length === 0) {
        const placeholder = document.createElement('span');
        placeholder.className = 'keyword-placeholder'; // UPDATED: Use CSS class
        placeholder.textContent = 'No keywords selected';
        container.appendChild(placeholder);
        return;
    }
    
    selectedKeywords.forEach(keyword => {
        const tag = document.createElement('div');
        tag.className = 'keyword-tag'; // UPDATED: Use CSS class
        
        const text = document.createElement('span');
        text.textContent = keyword;
        text.className = 'keyword-tag-text'; // UPDATED: Use CSS class
        
        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '×';
        removeBtn.className = 'keyword-tag-remove'; // UPDATED: Use CSS class
        removeBtn.addEventListener('click', () => removeKeyword(keyword));
        
        tag.appendChild(text);
        tag.appendChild(removeBtn);
        container.appendChild(tag);
    });
}

// Check if a playground matches selected keywords
function playgroundMatchesKeywords(playground) {
    if (selectedKeywords.length === 0) return true;
    
    const playgroundKeywords = playground.properties.Keywords;
    if (!playgroundKeywords || playgroundKeywords.trim() === '') return false;
    
    const playgroundKeywordList = playgroundKeywords
        .split(',')
        .map(k => k.trim().toLowerCase());
    
    return selectedKeywords.some(selectedKeyword => 
        playgroundKeywordList.includes(selectedKeyword.toLowerCase())
    );
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
function editPlayground(uniqueId) {
    const playgroundData = playgroundLookup[uniqueId];
    
    if (!playgroundData) {
        console.error('Could not find playground data for ID:', uniqueId);
        return;
    }

    currentEditingPlayground = { fid: uniqueId, data: playgroundData };
    const modal = document.getElementById('editModal');
    
    populateEditForm(playgroundData);
    modal.style.display = 'block';
}

function populateEditForm(playgroundData) {
    // Text inputs
    const textFields = [
        'name', 'keywords', 'comments', 'type', 'shade', 'parking', 
        'fencing', 'seating', 'floor', 'link', 'photo'
    ];
    
    textFields.forEach(field => {
        const element = document.getElementById(`edit-${field}`);
        const key = field.charAt(0).toUpperCase() + field.slice(1);
        if (element) element.value = playgroundData[key] || '';
    });
    
    // Checkboxes
    const checkboxFields = [
        'toilet', 'bbq', 'bubbler', 'accessible', 'basketball', 'skate-park',
        'scooter-track', 'cricket-chute', 'tennis-court', 'pedal-rail',
        'activity-wall', 'talking-tube', 'musical-play', 'sensory-play',
        'sandpit', 'water-play', 'rope-gym'
    ];
    
    checkboxFields.forEach(field => {
        const element = document.getElementById(`edit-${field}`);
        const key = field.replace(/-/g, '_').replace(/^(.)/, (_, c) => c.toUpperCase());
        if (element) element.checked = playgroundData[key] === 'Yes';
    });
    
    // Number inputs
    const numberFields = [
        'baby-swing', 'belt-swing', 'basket-swing', 'dual-swing', 'hammock',
        'double-slide', 'straight-slide', 'tube-slide', 'spiral-slide',
        'stairs-climbing', 'metal-climbing', 'rope-climbing', 'rock-climbing',
        'monkey-climbing', 'other-climbing', 'spinning-pole', 'spinning-bucket',
        'merry-go-round', 'balance-beam', 'stepping-stones', 'spring-rocker',
        'seesaw', 'bridge', 'tunnel', 'trampoline', 'firemans-pole', 'hamster-roller-wheel'
    ];
    
    numberFields.forEach(field => {
        const element = document.getElementById(`edit-${field}`);
        const key = field.replace(/-/g, '_').replace(/^(.)/, (_, c) => c.toUpperCase());
        if (element) element.value = playgroundData[key] || '';
    });
}

function setupModalEventListeners() {
    const modal = document.getElementById('editModal');
    const closeBtn = document.getElementById('closeModalBtn');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
    
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
}

function setupFormSubmission() {
    const form = document.getElementById('editForm');
    if (!form) return;
    
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const formData = collectFormData();
        console.log('Edit submission:', formData);
        
        showSuccessMessage();
    });
}

function collectFormData() {
    const getValue = (id) => document.getElementById(id)?.value || '';
    const getChecked = (id) => document.getElementById(id)?.checked || false;
    
    return {
        playgroundId: currentEditingPlayground.fid,
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
        pedalRail: getChecked('edit-pedal-rail'),
        scooterTrack: getChecked('edit-scooter-track'),
        cricketChute: getChecked('edit-cricket-chute'),
        tennisCourt: getChecked('edit-tennis-court'),
        activityWall: getChecked('edit-activity-wall'),
        talkingTube: getChecked('edit-talking-tube'),
        musicalPlay: getChecked('edit-musical-play'),
        sensoryPlay: getChecked('edit-sensory-play'),
        sandpit: getChecked('edit-sandpit'),
        waterPlay: getChecked('edit-water-play'),
        // Equipment counts
        babySwing: getValue('edit-baby-swing'),
        beltSwing: getValue('edit-belt-swing'),
        basketSwing: getValue('edit-basket-swing'),
        dualSwing: getValue('edit-dual-swing'),
        hammock: getValue('edit-hammock'),
        doubleSlide: getValue('edit-double-slide'),
        straightSlide: getValue('edit-straight-slide'),
        tubeSlide: getValue('edit-tube-slide'),
        spiralSlide: getValue('edit-spiral-slide'),
        stairsClimbing: getValue('edit-stairs-climbing'),
        metalClimbing: getValue('edit-metal-climbing'),
        ropeClimbing: getValue('edit-rope-climbing'),
        rockClimbing: getValue('edit-rock-climbing'),
        monkeyClimbing: getValue('edit-monkey-climbing'),
        otherClimbing: getValue('edit-other-climbing'),
        ropeGym: getValue('edit-rope-gym'),
        spinningPole: getValue('edit-spinning-pole'),
        spinningBucket: getValue('edit-spinning-bucket'),
        merryGoRound: getValue('edit-merry-go-round'),
        balanceBeam: getValue('edit-balance-beam'),
        steppingStones: getValue('edit-stepping-stones'),
        springRocker: getValue('edit-spring-rocker'),
        seesaw: getValue('edit-seesaw'),
        bridge: getValue('edit-bridge'),
        tunnel: getValue('edit-tunnel'),
        trampoline: getValue('edit-trampoline'),
        firemansPole: getValue('edit-firemans-pole'),
        hamsterRollerWheel: getValue('edit-hamster-roller-wheel'),
        // Media and contact
        photo: getValue('edit-photo'),
        link: getValue('edit-link'),
        additionalComments: getValue('edit-additional-comments'),
        email: getValue('edit-email')
    };
}

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
    const suburbBtn = document.getElementById('suburbDropdownBtn');
    const lgaBtn = document.getElementById('lgaDropdownBtn');
    const typeBtn = document.getElementById('typeDropdownBtn');
    const shadeBtn = document.getElementById('shadeDropdownBtn');
    const fencingBtn = document.getElementById('fencingDropdownBtn');
    const parkingBtn = document.getElementById('parkingDropdownBtn'); 
    
    if (suburbBtn) {
        suburbBtn.addEventListener('click', () => 
            toggleDropdown('suburbDropdownMenu', 'lgaDropdownMenu', 'typeDropdownMenu'));
    }
    
    if (lgaBtn) {
        lgaBtn.addEventListener('click', () => 
            toggleDropdown('lgaDropdownMenu', 'suburbDropdownMenu', 'typeDropdownMenu'));
    }

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
}

function handleOutsideClick(event) {
    const dropdownConfigs = [
        { btn: 'suburbDropdownBtn', menu: 'suburbDropdownMenu' },
        { btn: 'lgaDropdownBtn', menu: 'lgaDropdownMenu' },
        { btn: 'typeDropdownBtn', menu: 'typeDropdownMenu' }
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

    if (!query || !playgroundData || !playgroundData.features) return;

    const matches = playgroundData.features
        .filter(f => f.properties.Name && f.properties.Name.toLowerCase().includes(query))
        .slice(0, 6); // limit suggestions to 6

    if (matches.length === 0) {
        suggestionsContainer.style.display = 'none';
        return;
    }

    matches.forEach(match => {
        const name = match.properties.Name;
        const suggestionItem = document.createElement('div');
        suggestionItem.className = 'dropdown-option';
        suggestionItem.textContent = name;
        
        suggestionItem.addEventListener('click', () => {
            searchInput.value = name;
            suggestionsContainer.innerHTML = '';
            suggestionsContainer.style.display = 'none';
            performSearch();
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
        // First, search locations via Nominatim
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=au`);
        const results = await response.json();
        
        if (results && results.length > 0) {
            // Found a location match
            const result = results[0];
            const lat = parseFloat(result.lat);
            const lng = parseFloat(result.lon);
            
            map.setView([lat, lng], 14);
            addSearchResultMarker(lat, lng, result.display_name, false);
            searchInput.value = '';
        } else {
            // No location match, fallback to playground search
            const playgroundMatch = searchPlaygrounds(query);
            
            if (playgroundMatch) {
                const coords = playgroundMatch.geometry.coordinates;
                const lat = coords[1];
                const lng = coords[0];
                
                map.setView([lat, lng], 16);
                addSearchResultMarker(lat, lng, playgroundMatch.properties.Name, true);
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

// Search through playground names in GeoJSON data
function searchPlaygrounds(query) {
    if (!playgroundData || !playgroundData.features) {
        return null;
    }
    
    const lowerQuery = query.toLowerCase();
    
    // Find playgrounds that match the search query
    const match = playgroundData.features.find(feature => {
        const name = feature.properties.Name;
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
    loadPlaygroundData();
    setupEventListeners();
    initializeMobileDrawer();
    
    // Add search control with a delay to ensure map is fully loaded
    setTimeout(() => {
        console.log('About to call addSearchControl');
        addSearchControl();
        initializeKeywordSearch(); 
    }, 2000);

    // Update count when map moves/zooms
    map.on('moveend zoomend', updateVisiblePlaygroundCount);
    
    console.log('initializeApp completed');
}

// ===== BACKWARD COMPATIBILITY =====
function getMarkerColor(classification) {
    return getMarkerSizeConfig(classification).fillColor;
}

function onEachFeature(feature, layer) {
    const id = generateUniqueId(feature.properties);
    playgroundLookup[id] = feature.properties;
    layer.bindPopup(createPopupContent(feature.properties, feature.geometry.coordinates));
}

// ===== APP STARTUP =====
document.addEventListener('DOMContentLoaded', initializeApp);