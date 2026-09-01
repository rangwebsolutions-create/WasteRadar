// =========================================================
// Config
// =========================================================
const AGADIR_COORDS = [30.4278, -9.5981];
const DEFAULT_ZOOM = 13;
const STORAGE_KEY = 'wasteradar_crew';
const REPORT_JITTER = 0.012; // degrees — keeps simulated reports near the city center

// =========================================================
// Supabase client
// =========================================================
const SUPABASE_URL = 'https://chexgbbklouvcursnkxw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNoZXhnYmJrbG91dmN1cnNua3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxOTI4ODQsImV4cCI6MjEwMzc2ODg4NH0.C_2vnIu602FVVX3chZiczTKkGZsKulua24K5U6hCtiY';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
// Live hotspots — fetched from Supabase, no more mock arrays
// =========================================================
let hotspotMarkers = []; // currently-rendered layers, so a re-fetch can clear + redraw cleanly

function hotspotIcon() {
  return L.divIcon({
    className: 'hotspot-marker',
    html: '<span class="hotspot-marker__ring"></span><span class="hotspot-marker__dot"></span>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function buildPopupHtml(row) {
  return `
    <div class="hotspot-popup">
      <div class="hotspot-popup__severity">Severity score: ${row.severity_score}</div>
      <div class="hotspot-popup__coords">${Number(row.lat).toFixed(5)}, ${Number(row.lng).toFixed(5)}</div>
      <div class="hotspot-popup__status">Status: ${row.status}</div>
    </div>`;
}

function addHotspot(row) {
  const marker = L.marker([Number(row.lat), Number(row.lng)], { icon: hotspotIcon() }).addTo(map);
  marker.bindPopup(buildPopupHtml(row));
  return marker;
}

function clearHotspotMarkers() {
  hotspotMarkers.forEach((marker) => map.removeLayer(marker));
  hotspotMarkers = [];
}

async function fetchHotspots() {
  const { data, error } = await supabase
    .from('hotspots')
    .select('*')
    .eq('status', 'open');

  if (error) {
    console.error('Error fetching hotspots:', error);
    showToast('Could not load hotspots from the database');
    return;
  }

  clearHotspotMarkers();
  hotspotMarkers = data
    .filter((row) => row.lat != null && row.lng != null)
    .map((row) => addHotspot(row));
}

fetchHotspots();

// =========================================================
// Report Hotspot modal — fake photo upload, real DB insert
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

submitBtn.addEventListener('click', async () => {
  submitBtn.disabled = true;
  submitBtn.classList.add('is-loading');
  submitLabel.textContent = 'Analyzing coordinates...';

  const jitter = () => (Math.random() - 0.5) * REPORT_JITTER;
  const payload = {
    lat: AGADIR_COORDS[0] + jitter(),
    lng: AGADIR_COORDS[1] + jitter(),
    severity_score: 2,
    status: 'open',
  };

  const { error } = await supabase.from('hotspots').insert([payload]);

  if (error) {
    console.error('Error submitting report:', error);
    showToast('Report failed — please try again');
    submitBtn.disabled = false;
    submitBtn.classList.remove('is-loading');
    submitLabel.textContent = 'Submit Report';
    return; // leave the modal open so the user can retry without re-picking a photo
  }

  await fetchHotspots(); // re-render from the DB, no page reload
  reportCount += 1;
  badgeCount.textContent = reportCount;
  performClose();
  showToast(`Hotspot #${reportCount} reported — live on the map`);
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
