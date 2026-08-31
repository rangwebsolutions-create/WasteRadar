// =========================================================
// Config
// =========================================================
const AGADIR_COORDS = [30.4278, -9.5981];
const DEFAULT_ZOOM = 13;
const STORAGE_KEY = 'wasteradar_crew';
const REPORT_JITTER = 0.012; // degrees — keeps simulated reports near the city center

const MOCK_HOTSPOTS = [
  { id: 'seed-1', name: 'Agadir Marina',                  lat: 30.4142, lng: -9.6066, severity: 'High'   },
  { id: 'seed-2', name: 'Agadir Fishing Port',             lat: 30.4085, lng: -9.6140, severity: 'High'   },
  { id: 'seed-3', name: 'Plage Municipale',                lat: 30.4215, lng: -9.6021, severity: 'Medium' },
  { id: 'seed-4', name: 'Corniche — Palais des Congrès',   lat: 30.4265, lng: -9.5975, severity: 'Low'    },
  { id: 'seed-5', name: 'Founty Beach Sector',             lat: 30.4350, lng: -9.5940, severity: 'Medium' },
];

const hotspotRegistry = new Map(); // id -> { data, marker }
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
const authOverlay = document.getElementById('auth-overlay');
const crewSelect = document.getElementById('crew-select');
const deployBtn = document.getElementById('deploy-btn');
const crewBadge = document.getElementById('crew-badge');
const crewBadgeName = document.getElementById('crew-badge-name');
const badgeCount = document.getElementById('badge-count');
const switchCrewBtn = document.getElementById('switch-crew-btn');

const reportBtn = document.getElementById('report-btn');
const reportModal = document.getElementById('report-modal');
const closeReportModalBtn = document.getElementById('close-report-modal');
const uploadZone = document.getElementById('upload-zone');
const uploadZoneContent = document.getElementById('upload-zone-content');
const photoInput = document.getElementById('photo-input');
const submitBtn = document.getElementById('submit-report-btn');
const submitLabel = submitBtn.querySelector('.submit-btn__label');

const toastEl = document.getElementById('toast');

// =========================================================
// Mock authentication — "Select Your Crew" -> Deploy
// =========================================================
function showAuthOverlay() { authOverlay.classList.remove('hidden'); }
function hideAuthOverlay() { authOverlay.classList.add('hidden'); }

function activateCrew(crewName) {
  crewSelect.value = crewName;
  crewBadgeName.textContent = crewName;
  crewBadge.classList.remove('hidden');
  hideAuthOverlay();
  // Leaflet needs a nudge if it was ever rendered under a hidden/animating container
  setTimeout(() => map.invalidateSize(), 320);
}

// Frictionless: if a crew was already selected in a previous visit, skip the modal
const savedCrew = localStorage.getItem(STORAGE_KEY);
if (savedCrew) {
  activateCrew(savedCrew);
} else {
  showAuthOverlay();
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
  showAuthOverlay();
});

// =========================================================
// Hotspot markers — mock data, severity icons, claim flow
// =========================================================
function severityIcon(severity, claimed) {
  const classes = ['hotspot-marker', `hotspot-marker--${severity.toLowerCase()}`];
  if (claimed) classes.push('hotspot-marker--claimed');
  return L.divIcon({
    className: classes.join(' '),
    html: '<span class="hotspot-marker__ring"></span><span class="hotspot-marker__dot"></span>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function buildPopupHtml(data) {
  const sevKey = data.severity.toLowerCase();
  const reporterLine = data.reportedBy
    ? `<div class="hotspot-popup__reporter">Reported by ${data.reportedBy}</div>`
    : '';
  const claimedBlock = data.claimedBy
    ? `<div class="hotspot-popup__claimed">✅ Claimed by ${data.claimedBy}</div>`
    : `<button type="button" class="hotspot-popup__claim-btn" data-hotspot-id="${data.id}">Claim Cleanup</button>`;

  return `
    <div class="hotspot-popup">
      <div class="hotspot-popup__severity hotspot-popup__severity--${sevKey}">${data.severity}</div>
      <div class="hotspot-popup__name">${data.name}</div>
      <div class="hotspot-popup__coords">${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}</div>
      ${reporterLine}
      ${claimedBlock}
    </div>`;
}

function addHotspot(data) {
  const marker = L.marker([data.lat, data.lng], {
    icon: severityIcon(data.severity, !!data.claimedBy),
  }).addTo(map);
  marker.bindPopup(buildPopupHtml(data));
  hotspotRegistry.set(data.id, { data, marker });
  return marker;
}

function claimHotspot(id) {
  const entry = hotspotRegistry.get(id);
  if (!entry || entry.data.claimedBy) return;
  const crew = localStorage.getItem(STORAGE_KEY) || 'Unassigned crew';
  entry.data.claimedBy = crew;
  entry.marker.setIcon(severityIcon(entry.data.severity, true));
  entry.marker.setPopupContent(buildPopupHtml(entry.data));
  showToast(`Cleanup claimed by ${crew} 🧹`);
}

// Delegate clicks on the "Claim Cleanup" button inside whichever popup is open
map.on('popupopen', (e) => {
  const el = e.popup.getElement();
  const btn = el && el.querySelector('.hotspot-popup__claim-btn');
  if (btn) btn.addEventListener('click', () => claimHotspot(btn.dataset.hotspotId), { once: true });
});

MOCK_HOTSPOTS.forEach(addHotspot);

// =========================================================
// Report Hotspot modal — fake upload + simulated submission
// =========================================================
let selectedPhotoUrl = null;

function resetReportForm() {
  photoInput.value = '';
  if (selectedPhotoUrl) {
    URL.revokeObjectURL(selectedPhotoUrl);
    selectedPhotoUrl = null;
  }
  uploadZone.classList.remove('has-photo');
  uploadZoneContent.innerHTML = `
    <span class="upload-zone__icon">📷</span>
    <span class="upload-zone__title">Snap a photo of the waste</span>
    <span class="upload-zone__hint">Tap to open camera or gallery</span>
  `;
  submitBtn.disabled = false;
  submitBtn.classList.remove('is-loading');
  submitLabel.textContent = 'Submit Report';
}

function performClose() {
  reportModal.classList.add('hidden');
  resetReportForm();
}

function requestClose() {
  if (submitBtn.disabled) return; // ignore dismiss attempts mid-submission
  performClose();
}

reportBtn.addEventListener('click', () => reportModal.classList.remove('hidden'));
closeReportModalBtn.addEventListener('click', requestClose);
reportModal.addEventListener('click', (e) => {
  if (e.target === reportModal) requestClose();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !reportModal.classList.contains('hidden')) requestClose();
});

uploadZone.addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);
  selectedPhotoUrl = URL.createObjectURL(file);
  uploadZone.classList.add('has-photo');
  uploadZoneContent.innerHTML = `
    <img class="upload-zone__preview" src="${selectedPhotoUrl}" alt="Selected waste photo preview" />
    <span class="upload-zone__filename">${file.name}</span>
    <span class="upload-zone__hint">Tap to change photo</span>
  `;
});

submitBtn.addEventListener('click', () => {
  submitBtn.disabled = true;
  submitBtn.classList.add('is-loading');
  submitLabel.textContent = 'Analyzing coordinates...';

  // Smoke & mirrors: no network call, just a timed illusion of processing
  setTimeout(() => {
    performClose();

    const crew = localStorage.getItem(STORAGE_KEY) || 'Unassigned crew';
    const jitter = () => (Math.random() - 0.5) * REPORT_JITTER;
    const newHotspot = {
      id: `user-${Date.now()}`,
      name: 'Community Report',
      lat: AGADIR_COORDS[0] + jitter(),
      lng: AGADIR_COORDS[1] + jitter(),
      severity: 'Unverified',
      reportedBy: crew,
    };

    const marker = addHotspot(newHotspot);
    marker.openPopup();

    reportCount += 1;
    badgeCount.textContent = reportCount;
    showToast(`Hotspot #${reportCount} logged — pending verification`);
  }, 2000);
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
