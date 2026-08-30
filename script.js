// =========================================================
// Config
// =========================================================
const AGADIR_COORDS = [30.4278, -9.5981];
const DEFAULT_ZOOM = 13;
const STORAGE_KEY = 'wasteradar_crew';

let reportingModeActive = false;
let reportCount = 0;

// =========================================================
// Map init — dark basemap, centered on Agadir, Morocco
// =========================================================
const map = L.map('map', { zoomControl: false }).setView(AGADIR_COORDS, DEFAULT_ZOOM);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 20,
}).addTo(map);

L.control.zoom({ position: 'topright' }).addTo(map);

// =========================================================
// DOM refs
// =========================================================
const overlay = document.getElementById('auth-overlay');
const crewSelect = document.getElementById('crew-select');
const deployBtn = document.getElementById('deploy-btn');
const crewBadge = document.getElementById('crew-badge');
const crewBadgeName = document.getElementById('crew-badge-name');
const badgeCount = document.getElementById('badge-count');
const switchCrewBtn = document.getElementById('switch-crew-btn');
const reportBtn = document.getElementById('report-btn');
const reportBtnLabel = document.getElementById('report-btn-label');
const mapEl = document.getElementById('map');
const toastEl = document.getElementById('toast');

// =========================================================
// Mock authentication — "Select Your Crew" -> Deploy
// =========================================================
function showOverlay() {
  overlay.classList.remove('hidden');
}
function hideOverlay() {
  overlay.classList.add('hidden');
}
function activateCrew(crewName) {
  crewSelect.value = crewName;
  crewBadgeName.textContent = crewName;
  crewBadge.classList.remove('hidden');
  hideOverlay();
  // Leaflet needs a nudge if it was ever rendered under a hidden/animating container
  setTimeout(() => map.invalidateSize(), 320);
}

// Frictionless: if a crew was already selected in a previous visit, skip the modal
const savedCrew = localStorage.getItem(STORAGE_KEY);
if (savedCrew) {
  activateCrew(savedCrew);
} else {
  showOverlay();
}

deployBtn.addEventListener('click', () => {
  const crew = crewSelect.value;
  localStorage.setItem(STORAGE_KEY, crew);
  activateCrew(crew);
  showToast(`${crew} deployed to Agadir`);
});

switchCrewBtn.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  crewBadge.classList.add('hidden');
  showOverlay();
});

// =========================================================
// Report Hotspot — arm mode, then drop a pin on next map tap
// =========================================================
const hotspotIcon = L.divIcon({
  className: 'hotspot-marker',
  html: '<span class="hotspot-marker__ring"></span><span class="hotspot-marker__dot"></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function setReportingMode(active) {
  reportingModeActive = active;
  reportBtn.classList.toggle('report-btn--armed', active);
  mapEl.classList.toggle('crosshair', active);
  reportBtnLabel.textContent = active ? 'Tap Map To Confirm' : 'Report Hotspot';
  if (active) showToast('Tap anywhere on the map to drop a pin', 2400);
}

reportBtn.addEventListener('click', () => setReportingMode(!reportingModeActive));

map.on('click', (e) => {
  if (!reportingModeActive) return;

  const crew = localStorage.getItem(STORAGE_KEY) || 'Unassigned crew';

  L.marker(e.latlng, { icon: hotspotIcon })
    .addTo(map)
    .bindPopup(
      `<div class="hotspot-popup">
         <strong>Hotspot flagged</strong><br/>
         Crew: ${crew}<br/>
         <span class="hotspot-popup__coords">${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}</span><br/>
         <em>Demo only — not saved</em>
       </div>`
    )
    .openPopup();

  reportCount += 1;
  badgeCount.textContent = reportCount;
  setReportingMode(false);
  showToast(`Hotspot #${reportCount} logged (demo only)`);
});

// =========================================================
// Toast helper
// =========================================================
let toastTimer;
function showToast(message, duration = 2600) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), duration);
}
