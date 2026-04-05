// ===================================================================
// childcare-layer.js
// Childcare centres (ACECQA QLD) layer for Playground Finder map
// Depends on: script.js (supabaseClient, map, switchFilterTab,
//             activeFilterTab, updateTopicCount)
// ===================================================================

// ── Constants ────────────────────────────────────────────────────────────────

const QA_LABELS = [
    { short: 'QA1', full: 'Educational Program & Practice' },
    { short: 'QA2', full: "Children's Health & Safety" },
    { short: 'QA3', full: 'Physical Environment' },
    { short: 'QA4', full: 'Staffing Arrangements' },
    { short: 'QA5', full: 'Relationships with Children' },
    { short: 'QA6', full: 'Collaborative Partnerships with Families' },
    { short: 'QA7', full: 'Governance & Leadership' },
];

const QA_FIELDS = [
    'quality_area_1_rating', 'quality_area_2_rating', 'quality_area_3_rating',
    'quality_area_4_rating', 'quality_area_5_rating', 'quality_area_6_rating',
    'quality_area_7_rating',
];

const CHILDCARE_SERVICE_LABELS = {
    long_day_care:                           'Long Day Care',
    preschool_kindergarten_part_of_school:   'Preschool / Kindergarten (Part of School)',
    preschool_kindergarten_stand_alone:      'Preschool / Kindergarten (Stand Alone)',
    outside_school_hours_care_after_school:  'After School Care',
    outside_school_hours_care_before_school: 'Before School Care',
    outside_school_hours_care_vacation_care: 'Vacation Care',
};

const CHILDCARE_SERVICE_ICONS = {
    long_day_care:                           '🏫',
    preschool_kindergarten_part_of_school:   '🎓',
    preschool_kindergarten_stand_alone:      '🎓',
    outside_school_hours_care_after_school:  '🌇',
    outside_school_hours_care_before_school: '🌅',
    outside_school_hours_care_vacation_care: '☀️',
};

// ── State ─────────────────────────────────────────────────────────────────────

let childcareLayerGroup   = null;
let childcareVisible      = false;
let childcareAllLoaded    = [];
let childcareLoadedBounds = new Set();
let childcareIsLoading    = false;
let childcareScoreSlider  = null;
let childcareServiceFilters = new Set();   // empty Set = "show all"

// ── Score helpers ─────────────────────────────────────────────────────────────

function getChildcareColor(score) {
    if (score === 0 || score === null || score === undefined) return '#6b7280'; // grey
    if (score <=  7) return '#dc2626'; // red
    if (score <= 13) return '#ea580c'; // orange
    if (score <= 18) return '#eab308'; // yellow
    return '#16a34a';                  // green
}

function isYes(val) {
    const v = (val || '').toString().trim().toLowerCase();
    return v === 'yes' || v === '1' || v === 'true';
}

// ── Triangle marker ────────────────────────────────────────────────────────────

function createChildcareIcon(color) {
    return L.divIcon({
        html: `<div style="width:22px;height:22px;">
                 <svg viewBox="0 0 22 22" width="22" height="22"
                      style="filter:drop-shadow(0 2px 3px rgba(0,0,0,0.35));">
                   <polygon points="11,2 21,20 1,20"
                            fill="${color}" stroke="#ffffff" stroke-width="1.8"/>
                 </svg>
               </div>`,
        className:  'childcare-triangle-marker',
        iconSize:   [22, 22],
        iconAnchor: [11, 20],   // tip of triangle sits on the location
    });
}

// ── Popup content ─────────────────────────────────────────────────────────────

function createChildcarePopup(centre) {
    const id      = (centre.service_approval_number || '').replace(/[^a-zA-Z0-9]/g, '_');
    const score   = centre.score ?? 0;
    const color   = getChildcareColor(score);
    const address = [centre.service_address, centre.suburb, centre.postcode]
                        .filter(Boolean).join(', ');

    const mapsLink = (centre.latitude && centre.longitude)
        ? `<a href="https://www.google.com/maps?q=${centre.latitude},${centre.longitude}"
              target="_blank" rel="noopener noreferrer"
              style="text-decoration:none;margin-left:4px;" title="Open in Google Maps">📍</a>`
        : '';

    const title = centre.url
        ? `<a href="${centre.url}" target="_blank" rel="noopener noreferrer"
              style="text-decoration:none;color:inherit;">${centre.service_name || 'Childcare Centre'} 🔗</a>`
        : (centre.service_name || 'Childcare Centre');

    // QA breakdown rows (shown in hover tooltip)
    const qaRows = QA_LABELS.map(({ short, full }, i) => {
        const rating = centre[QA_FIELDS[i]] || '—';
        // Pick a subtle indicator colour per rating
        const ratingColor =
            rating === 'Excellent'                   ? '#16a34a' :
            rating === 'Exceeding NQS'               ? '#65a30d' :
            rating === 'Meeting NQS'                 ? '#0284c7' :
            rating === 'Working Towards NQS'         ? '#ea580c' :
            rating === 'Significant Improvement Required' ? '#dc2626' : '#6b7280';

        return `<div style="display:flex;justify-content:space-between;align-items:baseline;
                            padding:3px 0;border-bottom:1px solid #f3f4f6;font-size:0.73rem;gap:8px;">
                  <span style="color:#374151;white-space:nowrap;font-weight:600;">${short}</span>
                  <span style="color:${ratingColor};text-align:right;">${rating}</span>
                </div>`;
    }).join('');

    // Services offered
    const serviceItems = Object.entries(CHILDCARE_SERVICE_LABELS)
        .filter(([key]) => isYes(centre[key]))
        .map(([key, label]) =>
            `<div style="padding:2px 0;font-size:0.82rem;">
               ${CHILDCARE_SERVICE_ICONS[key]} ${label}
             </div>`)
        .join('');

    return `
<div style="font-family:system-ui,-apple-system,sans-serif;min-width:290px;max-width:340px;padding:12px;">

  <!-- Header -->
  <div style="margin-bottom:10px;">
    <h3 style="font-weight:700;font-size:1rem;margin:0 0 4px;line-height:1.3;">${title}${mapsLink}</h3>
    <div style="color:#6b7280;font-size:0.82rem;font-style:italic;">${address}</div>
    ${centre.number_of_approved_places
        ? `<div style="margin-top:4px;font-size:0.82rem;">👶 <strong>${centre.number_of_approved_places}</strong> approved places</div>`
        : ''}
  </div>

  <!-- Score (hover to expand QA breakdown) -->
  <div style="margin-bottom:10px;position:relative;">
    <span style="font-size:0.82rem;color:#6b7280;">NQS Score: </span>
    <span id="childcare-score-${id}"
          style="font-weight:700;color:${color};font-size:1.05rem;
                 cursor:help;border-bottom:2px dotted ${color};padding-bottom:1px;"
          onmouseenter="document.getElementById('childcare-qa-${id}').style.display='block'"
          onmouseleave="document.getElementById('childcare-qa-${id}').style.display='none'"
          title="Hover to see Quality Area breakdown"
    >${score}/21</span>

    <!-- QA tooltip card -->
    <div id="childcare-qa-${id}"
         style="display:none;position:absolute;top:calc(100% + 4px);left:0;
                background:#fff;border:1px solid #e5e7eb;border-radius:8px;
                padding:10px 12px;z-index:9999;min-width:270px;
                box-shadow:0 6px 20px rgba(0,0,0,0.15);">
      <div style="font-size:0.72rem;font-weight:700;color:#6b7280;
                  margin-bottom:6px;letter-spacing:0.06em;text-transform:uppercase;">
        Quality Area Ratings
      </div>
      ${qaRows}
    </div>
  </div>

  ${centre.overall_rating
    ? `<div style="margin-bottom:8px;font-size:0.82rem;">
         ⭐ <strong>Overall:</strong> ${centre.overall_rating}
       </div>` : ''}

  <!-- Services -->
  ${serviceItems
    ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dotted #e5e7eb;">
         <div style="font-size:0.72rem;font-weight:700;color:#6b7280;
                     margin-bottom:5px;letter-spacing:0.06em;text-transform:uppercase;">
           Services Offered
         </div>
         ${serviceItems}
       </div>` : ''}

</div>`;
}

// ── Marker factory ─────────────────────────────────────────────────────────────

function createChildcareMarker(centre) {
    const marker = L.marker(
        [centre.latitude, centre.longitude],
        { icon: createChildcareIcon(getChildcareColor(centre.score)) }
    );
    marker.bindPopup(createChildcarePopup(centre), { maxWidth: 350 });
    if (window.innerWidth > 768) {
        marker.bindTooltip(centre.service_name || 'Childcare Centre', {
            permanent: false, direction: 'top', offset: [0, -18],
            className: 'playground-tooltip',
        });
    }
    marker.childcareData = centre;
    return marker;
}

// ── Filtering ─────────────────────────────────────────────────────────────────

function getChildcareScoreRange() {
    if (!childcareScoreSlider?.noUiSlider) return [0, 28];
    const vals = childcareScoreSlider.noUiSlider.get();
    return [Math.round(parseFloat(vals[0])), Math.round(parseFloat(vals[1]))];
}

function filterChildcareMarkers() {
    if (!childcareLayerGroup || !map) return;
    childcareLayerGroup.clearLayers();

    const bounds = map.getBounds();
    const [minScore, maxScore] = getChildcareScoreRange();

    childcareAllLoaded.forEach(centre => {
        if (!centre.latitude || !centre.longitude) return;
        if (!bounds.contains([centre.latitude, centre.longitude])) return;

        // Score filter
        const score = centre.score ?? 0;
        if (score < minScore || score > maxScore) return;

        // Service type filter — if any checkboxes are ticked, centre must have ≥1
        if (childcareServiceFilters.size > 0) {
            const matches = [...childcareServiceFilters].some(key => isYes(centre[key]));
            if (!matches) return;
        }

        childcareLayerGroup.addLayer(createChildcareMarker(centre));
    });

    updateChildcareCount();
}

function updateChildcareCount() {
    if (activeFilterTab !== 'childcare') return;
    const bounds = map.getBounds();
    let count = 0;
    childcareLayerGroup?.eachLayer(m => {
        if (bounds.contains(m.getLatLng())) count++;
    });
    document.querySelectorAll('.playgroundCount').forEach(el => {
        el.textContent = `${count} centre${count !== 1 ? 's' : ''}`;
    });
}

// ── Viewport loading ──────────────────────────────────────────────────────────

async function loadChildcareForViewport() {
    if (childcareIsLoading || !map) return;
    childcareIsLoading = true;

    try {
        const bounds    = map.getBounds().pad(0.15);
        const boundsKey = [
            bounds.getSouth().toFixed(2), bounds.getWest().toFixed(2),
            bounds.getNorth().toFixed(2), bounds.getEast().toFixed(2),
        ].join(',');

        if (childcareLoadedBounds.has(boundsKey)) {
            filterChildcareMarkers();
            return;
        }

        const COLUMNS = [
            'service_approval_number', 'service_name',
            'service_address', 'suburb', 'postcode',
            'latitude', 'longitude',
            'score', 'number_of_approved_places', 'overall_rating',
            ...QA_FIELDS,
            ...Object.keys(CHILDCARE_SERVICE_LABELS),
            'url',
        ].join(',');

        const { data, error } = await supabaseClient
            .from('childcare_qld_with_url')
            .select(COLUMNS)
            .not('latitude', 'is', null)
            .not('longitude', 'is', null)
            .gte('latitude',  bounds.getSouth())
            .lte('latitude',  bounds.getNorth())
            .gte('longitude', bounds.getWest())
            .lte('longitude', bounds.getEast());

        if (error) throw new Error(error.message);

        // Merge into cache (deduplicate by service_approval_number)
        const existingIds = new Set(childcareAllLoaded.map(c => c.service_approval_number));
        data.forEach(c => {
            if (!existingIds.has(c.service_approval_number)) childcareAllLoaded.push(c);
        });

        childcareLoadedBounds.add(boundsKey);
        // Prevent unbounded cache growth
        if (childcareLoadedBounds.size > 25) {
            childcareLoadedBounds.clear();
            childcareAllLoaded = [...data];
        }

        console.log(`✅ Childcare: ${data.length} new, ${childcareAllLoaded.length} total cached`);
        filterChildcareMarkers();

    } catch (err) {
        console.error('❌ Childcare load error:', err);
    } finally {
        childcareIsLoading = false;
    }
}

// ── Toggle layer (right-hand button) ──────────────────────────────────────────

function toggleChildcare() {
    const btn = document.getElementById('toggleChildcareBtn');
    if (childcareVisible) {
        map.removeLayer(childcareLayerGroup);
        childcareVisible = false;
        btn?.classList.add('childcare-hidden');
    } else {
        map.addLayer(childcareLayerGroup);
        childcareVisible = true;
        btn?.classList.remove('childcare-hidden');
        loadChildcareForViewport();          // trigger first load
        switchFilterTab('childcare');        // flip sidebar tab
    }
    updateTopicCount();
}

// ── Score slider ──────────────────────────────────────────────────────────────

function initialiseChildcareScoreSlider() {
    const el = document.getElementById('childcareScoreSlider');
    if (!el || !window.noUiSlider) return;

    el.classList.add('size-slider-track');
    noUiSlider.create(el, {
        start:   [0, 21],
        connect: true,
        range:   { min: 0, max: 21 },
        step:    1,
    });
    childcareScoreSlider = el;

    el.noUiSlider.on('update', (values) => {
        const min = Math.round(parseFloat(values[0]));
        const max = Math.round(parseFloat(values[1]));

        const minLbl = document.getElementById('childcareScoreMinLabel');
        const maxLbl = document.getElementById('childcareScoreMaxLabel');
        if (minLbl) minLbl.textContent = min;
        if (maxLbl) maxLbl.textContent = max;

        const handles = el.querySelectorAll('.noUi-handle');
        if (handles[0]) handles[0].style.background = getChildcareColor(min);
        if (handles[1]) handles[1].style.background = getChildcareColor(max);

        if (childcareVisible) filterChildcareMarkers();
    });

    // Set initial handle colours
    const handles = el.querySelectorAll('.noUi-handle');
    if (handles[0]) handles[0].style.background = '#6b7280';
    if (handles[1]) handles[1].style.background = '#16a34a';
}

// ── Service filter checkboxes ──────────────────────────────────────────────────

function initialiseChildcareServiceFilters() {
    document.querySelectorAll('.childcare-service-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            childcareServiceFilters.clear();
            document.querySelectorAll('.childcare-service-cb:checked').forEach(checked => {
                childcareServiceFilters.add(checked.value);
            });
            if (childcareVisible) filterChildcareMarkers();
        });
    });
}

// ── Patch updateTopicCount to handle childcare tab ────────────────────────────

(function patchUpdateTopicCount() {
    const _orig = window.updateTopicCount;
    window.updateTopicCount = function () {
        if (typeof activeFilterTab !== 'undefined' && activeFilterTab === 'childcare') {
            updateChildcareCount();
        } else {
            _orig?.call(this);
        }
    };
})();

// ── Initialise everything ─────────────────────────────────────────────────────

function initChildcareLayer() {
    // Plain layer group — no clustering (triangles are visually distinct)
    childcareLayerGroup = L.layerGroup();
    // Do NOT add to map yet — layer starts OFF

    // Append toggle button to the existing right-hand button container
    const container = document.getElementById('toggleButtonContainer');
    if (container) {
        const btn = document.createElement('button');
        btn.id        = 'toggleChildcareBtn';
        btn.className = 'toggle-events-btn childcare-hidden';
        btn.innerHTML = `<span class="events-icon">🏫</span>
                         <span class="events-text">Childcare</span>`;
        btn.addEventListener('click', toggleChildcare);
        container.appendChild(btn);
    }

    // Reload on map pan / zoom
    map.on('moveend', () => {
        if (childcareVisible) loadChildcareForViewport();
        if (activeFilterTab === 'childcare') updateChildcareCount();
    });
    map.on('zoomend', () => {
        if (childcareVisible) filterChildcareMarkers();
        if (activeFilterTab === 'childcare') updateChildcareCount();
    });

    initialiseChildcareScoreSlider();
    initialiseChildcareServiceFilters();
}

// ── Boot: wait for main app to create `map` and `#toggleButtonContainer` ─────

document.addEventListener('DOMContentLoaded', () => {
    const ready = setInterval(() => {
        if (window.map && document.getElementById('toggleButtonContainer')) {
            clearInterval(ready);
            initChildcareLayer();
        }
    }, 80);
});
