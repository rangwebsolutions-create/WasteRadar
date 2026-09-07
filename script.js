(function () {
'use strict';

// =========================================================
// Config / shared state
// =========================================================
const AGADIR_COORDS = [30.4278, -9.5981];
const DEFAULT_ZOOM = 13;
const STORAGE_KEY = 'wasteradar_crew';
const USERNAME_KEY = 'wasteradar_username'; // optional display name — no email/password, just a demo placeholder
const XP_PER_REPORT = 10;
const XP_PER_VERIFY = 50;
const LEADERBOARD_TEAMS = ['Team Atlas', 'Beach Guardians', 'Desert Rovers'];

const TEAM_AVATARS = {
  'Team Atlas': '🧭',
  'Beach Guardians': '🛡️',
  'Desert Rovers': '🏜️',
};
function avatarFor(team) {
  return TEAM_AVATARS[team] || '👤';
}

let xp = 0;
let map; // created only after the crew-select modal is dismissed — see initMap()
let hotspotMarkers = []; // markers from the live 'open' fetch — cleared + redrawn on each fetchHotspots()
let resolvedMarkers = []; // markers + territory circles verified this session — kept OUT of
                           // hotspotMarkers so a later re-fetch never removes them.

let reportPlacementActive = false; // true while waiting for the user to tap a map location
let pendingReportLatLng = null;    // the location they picked, until the report is submitted/cancelled
let pendingMarker = null;          // the temporary white "draft" pin shown at that location

// =========================================================
// Supabase client
// =========================================================
const SUPABASE_URL = 'https://chexgbbklouvcursnkxw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNoZXhnYmJrbG91dmN1cnNua3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxOTI4ODQsImV4cCI6MjEwMzc2ODg4NH0.C_2vnIu602FVVX3chZiczTKkGZsKulua24K5U6hCtiY';
let supabase = null;
if (window.supabase && typeof window.supabase.createClient === 'function') {
  try {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    console.error('Supabase failed to initialize:', err);
  }
} else {
  console.error(
    'Supabase JS library not found on window. Check that the CDN <script> tag ' +
    '(https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2) is present in index.html ' +
    'and loads BEFORE script.js.'
  );
}

// =========================================================
// DOM refs
// =========================================================
const authOverlay = document.getElementById('auth-overlay');
const crewSelect = document.getElementById('crew-select');
const usernameInput = document.getElementById('username-input');
const deployBtn = document.getElementById('deploy-btn');

const mapEl = document.getElementById('map');
const reportBtn = document.getElementById('report-btn');
const reportBtnLabel = reportBtn.querySelector('.report-btn__label');
const reportModal = document.getElementById('report-modal');
const closeReportModalBtn = document.getElementById('close-report-modal');
const uploadZone = document.getElementById('upload-zone');
const uploadZoneIcon = document.getElementById('upload-zone-icon');
const uploadZoneTitle = document.getElementById('upload-zone-title');
const uploadZoneHint = document.getElementById('upload-zone-hint');
const photoInput = document.getElementById('photo-input');
const submitBtn = document.getElementById('submit-report-btn');
const submitLabel = submitBtn.querySelector('.submit-btn__label');

const claimModal = document.getElementById('claim-modal');
const closeClaimModalBtn = document.getElementById('close-claim-modal');
const claimStateForm = document.getElementById('claim-state-form');
const claimStateScanning = document.getElementById('claim-state-scanning');
const claimStateSuccess = document.getElementById('claim-state-success');
const claimSeverityBadge = document.getElementById('claim-severity-badge');
const claimUploadZone = document.getElementById('claim-upload-zone');
const claimUploadIcon = document.getElementById('claim-upload-icon');
const claimUploadTitle = document.getElementById('claim-upload-title');
const claimUploadHint = document.getElementById('claim-upload-hint');
const claimPhotoInput = document.getElementById('claim-photo-input');
const runScannerBtn = document.getElementById('run-scanner-btn');
const claimSuccessPercent = document.getElementById('claim-success-percent');
const claimSuccessSubtext = document.getElementById('claim-success-subtext');
const claimSuccessXp = document.getElementById('claim-success-xp');
const claimShareBtn = document.getElementById('claim-share-btn');
const claimDoneBtn = document.getElementById('claim-done-btn');

// Bottom nav + sheets — the app's primary structure
const bottomNav = document.getElementById('bottom-nav');
const navLeaderboard = document.getElementById('nav-leaderboard');
const navMap = document.getElementById('nav-map');
const navMe = document.getElementById('nav-me');
const navMeIcon = document.getElementById('nav-me-icon');

const sheetBackdrop = document.getElementById('sheet-backdrop');
const sheetLeaderboard = document.getElementById('sheet-leaderboard');
const sheetMe = document.getElementById('sheet-me');
const closeLeaderboardBtn = document.getElementById('close-leaderboard');
const closeMeBtn = document.getElementById('close-me');

const leaderboardListEl = document.getElementById('leaderboard-list');
const leaderboardTotalEl = document.getElementById('leaderboard-total');

const meAvatar = document.getElementById('me-avatar');
const meName = document.getElementById('me-name');
const meTeam = document.getElementById('me-team');
const meXpCount = document.getElementById('me-xp-count');
const meSwitchBtn = document.getElementById('me-switch-btn');

const devModeTrigger = document.getElementById('dev-mode-trigger');

const landingScreen = document.getElementById('landing-screen');
const landingCta = document.getElementById('landing-cta');
const landingStatReported = document.getElementById('landing-stat-reported');
const landingStatVerified = document.getElementById('landing-stat-verified');

const mapEmptyHint = document.getElementById('map-empty-hint');

const toastEl = document.getElementById('toast');

// =========================================================
// Map init — OpenStreetMap tiles (no API key, ever) with a CSS filter
// (see style.css .leaflet-tile-pane) for the dark look. Only ever
// called from activateCrew().
// =========================================================
function initMap() {
  map = L.map('map', { zoomControl: false }).setView(AGADIR_COORDS, DEFAULT_ZOOM);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  // Tap-to-place: only listens while "Report Hotspot" has armed placement mode
  map.on('click', (e) => {
    if (!reportPlacementActive) return;
    setPendingLocationAndOpenReport(e.latlng);
  });
}

// =========================================================
// Landing screen — the real front door. Always shown on load; a saved
// crew (returning visitor) only skips the crew-select step after this.
// =========================================================
function showLandingScreen() {
  landingScreen.classList.remove('hidden');
  loadLandingStats();
}
function hideLandingScreen() {
  landingScreen.classList.add('hidden');
}

async function loadLandingStats() {
  if (!supabase) return; // leave the em-dash placeholders — this is a first-impression screen
  try {
    const [totalRes, resolvedRes] = await Promise.all([
      supabase.from('hotspots').select('*', { count: 'exact', head: true }),
      supabase.from('hotspots').select('*', { count: 'exact', head: true }).eq('status', 'resolved'),
    ]);
    if (totalRes.error) throw totalRes.error;
    if (resolvedRes.error) throw resolvedRes.error;
    landingStatReported.textContent = totalRes.count || 0;
    landingStatVerified.textContent = resolvedRes.count || 0;
  } catch (err) {
    console.error('Could not load landing stats:', err);
  }
}

landingCta.addEventListener('click', () => {
  hideLandingScreen();
  const savedCrew = localStorage.getItem(STORAGE_KEY);
  if (savedCrew) {
    activateCrew(savedCrew); // returning visitor — no need to re-pick a crew
  } else {
    showAuthOverlay();
  }
});

// =========================================================
// Mock authentication — crew + optional display name -> Deploy.
// No email, no password: a placeholder identity layer for the demo.
// =========================================================
function showAuthOverlay() { authOverlay.classList.remove('hidden'); }
function hideAuthOverlay() { authOverlay.classList.add('hidden'); }

function activateCrew(crewName) {
  crewSelect.value = crewName;
  usernameInput.value = localStorage.getItem(USERNAME_KEY) || '';
  navMeIcon.textContent = avatarFor(crewName);
  bottomNav.classList.remove('hidden');

  hideAuthOverlay();

  if (!map) initMap();
  fetchHotspots();
}

deployBtn.addEventListener('click', () => {
  const selectedTeam = crewSelect.value;
  const customName = usernameInput.value.trim();

  localStorage.setItem(STORAGE_KEY, selectedTeam);
  if (customName) {
    localStorage.setItem(USERNAME_KEY, customName);
  } else {
    localStorage.removeItem(USERNAME_KEY);
  }

  activateCrew(selectedTeam);
  showToast(`${selectedTeam} deployed to Agadir`);
});

meSwitchBtn.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  bottomNav.classList.add('hidden');
  goToMap();
  showAuthOverlay();
});

// Every load starts at the landing screen — it's the app's front door.
showLandingScreen();

// =========================================================
// XP helper — shared by report submissions and cleanup verifications
// =========================================================
function addXp(amount) {
  xp += amount;
  meXpCount.textContent = xp;
}

// =========================================================
// Live hotspots — fetched from Supabase.
// Red marker = open (click it to claim + verify a cleanup).
// Green marker = resolved this session.
// =========================================================
function hotspotIcon(resolved) {
  const classes = ['hotspot-marker'];
  if (resolved) classes.push('hotspot-marker--resolved');
  return L.divIcon({
    className: classes.join(' '),
    html: '<span class="hotspot-marker__ring"></span><span class="hotspot-marker__dot"></span>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function addHotspot(row) {
  const marker = L.marker([Number(row.lat), Number(row.lng)], { icon: hotspotIcon(false) }).addTo(map);
  marker.on('click', () => {
    if (reportPlacementActive) return; // ignore existing pins while placing a new report
    if (row.status !== 'open') {
      showToast('Already verified — nice work! ✅');
      return;
    }
    openClaimModal(row, marker);
  });
  return marker;
}

function clearHotspotMarkers() {
  hotspotMarkers.forEach((marker) => map.removeLayer(marker));
  hotspotMarkers = [];
}

async function fetchHotspots() {
  if (!map) return;

  if (!supabase) {
    console.error('fetchHotspots() aborted: Supabase client is not available.');
    showToast('Live map data unavailable right now');
    return;
  }

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

  mapEmptyHint.classList.toggle('hidden', hotspotMarkers.length > 0);
}

// =========================================================
// Report Hotspot — tap the map to place a pin, then attach a photo.
// =========================================================
function pendingIcon() {
  return L.divIcon({
    className: 'pending-marker',
    html: '<span class="pending-marker__ring"></span><span class="pending-marker__dot"></span>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function startReportPlacement() {
  reportPlacementActive = true;
  reportBtn.classList.add('report-btn--armed');
  reportBtnLabel.textContent = 'Tap Map To Place Pin';
  mapEl.classList.add('crosshair');
  showToast('Tap anywhere on the map to mark the hotspot', 3000);
}

function cancelReportPlacement() {
  reportPlacementActive = false;
  reportBtn.classList.remove('report-btn--armed');
  reportBtnLabel.textContent = 'Report Hotspot';
  mapEl.classList.remove('crosshair');
}

function clearPendingMarker() {
  if (pendingMarker) {
    map.removeLayer(pendingMarker);
    pendingMarker = null;
  }
  pendingReportLatLng = null;
}

function setPendingLocationAndOpenReport(latlng) {
  pendingReportLatLng = latlng;
  if (pendingMarker) map.removeLayer(pendingMarker);
  pendingMarker = L.marker(latlng, { icon: pendingIcon() }).addTo(map);

  cancelReportPlacement();
  reportModal.classList.remove('hidden');
}

function resetReportForm() {
  photoInput.value = '';
  uploadZone.classList.remove('has-photo');
  uploadZoneIcon.textContent = '📷';
  uploadZoneIcon.classList.remove('upload-zone__icon--success');
  uploadZoneTitle.textContent = 'Snap a photo of the waste';
  uploadZoneHint.textContent = 'Tap to open camera or gallery';
  submitBtn.classList.remove('is-loading');
  submitLabel.textContent = 'Submit Report';
}

function performClose() {
  reportModal.classList.add('hidden');
  resetReportForm();
  clearPendingMarker();
}

function requestClose() {
  if (submitBtn.disabled) return;
  performClose();
}

reportBtn.addEventListener('click', () => {
  if (reportPlacementActive) {
    cancelReportPlacement();
  } else {
    startReportPlacement();
  }
});
closeReportModalBtn.addEventListener('click', requestClose);
reportModal.addEventListener('click', (e) => {
  if (e.target === reportModal) requestClose();
});

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  uploadZone.classList.add('has-photo');
  uploadZoneIcon.textContent = '✓';
  uploadZoneIcon.classList.add('upload-zone__icon--success');
  uploadZoneTitle.textContent = 'Image Attached!';
  uploadZoneHint.textContent = 'Tap to change photo';
});

submitBtn.addEventListener('click', async () => {
  if (!pendingReportLatLng) {
    showToast('Something went wrong — please pick a location again');
    performClose();
    return;
  }
  if (!photoInput.files[0]) {
    showToast('Please attach a photo first 📷');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.classList.add('is-loading');
  submitLabel.textContent = 'Analyzing coordinates...';

  if (!supabase) {
    console.error('Submit aborted: Supabase client is not available.');
    showToast('Cannot submit right now — please try again shortly');
    submitBtn.disabled = false;
    submitBtn.classList.remove('is-loading');
    submitLabel.textContent = 'Submit Report';
    return;
  }

  const payload = {
    lat: pendingReportLatLng.lat,
    lng: pendingReportLatLng.lng,
    severity_score: Math.floor(Math.random() * 5) + 1,
    status: 'open',
  };

  const { error } = await supabase.from('hotspots').insert([payload]);

  if (error) {
    console.error('Error submitting report:', error);
    showToast('Report failed — please try again');
    submitBtn.disabled = false;
    submitBtn.classList.remove('is-loading');
    submitLabel.textContent = 'Submit Report';
    return;
  }

  await fetchHotspots();
  addXp(XP_PER_REPORT);
  performClose();
  showToast(`+${XP_PER_REPORT} XP — hotspot reported and live on the map`);
});

// =========================================================
// Claim Cleanup modal — AI verification core loop
// =========================================================
let currentClaim = null;

function showClaimState(state) {
  claimStateForm.classList.toggle('hidden', state !== 'form');
  claimStateScanning.classList.toggle('hidden', state !== 'scanning');
  claimStateSuccess.classList.toggle('hidden', state !== 'success');
}

function resetClaimForm() {
  claimPhotoInput.value = '';
  claimUploadZone.classList.remove('has-photo');
  claimUploadIcon.textContent = '📷';
  claimUploadIcon.classList.remove('upload-zone__icon--success');
  claimUploadTitle.textContent = 'Upload "After" Photo to Verify Cleanup';
  claimUploadHint.textContent = 'Tap to open camera or gallery';
  showClaimState('form');
}

function openClaimModal(row, marker) {
  currentClaim = { row, marker };
  claimSeverityBadge.textContent = `Severity score: ${row.severity_score}`;
  resetClaimForm();
  claimModal.classList.remove('hidden');
}

function requestCloseClaim() {
  const isScanning = !claimStateScanning.classList.contains('hidden');
  if (isScanning) return;
  claimModal.classList.add('hidden');
  currentClaim = null;
}

closeClaimModalBtn.addEventListener('click', requestCloseClaim);
claimModal.addEventListener('click', (e) => {
  if (e.target === claimModal) requestCloseClaim();
});
claimDoneBtn.addEventListener('click', requestCloseClaim);

claimPhotoInput.addEventListener('change', () => {
  const file = claimPhotoInput.files[0];
  if (!file) return;
  claimUploadZone.classList.add('has-photo');
  claimUploadIcon.textContent = '✓';
  claimUploadIcon.classList.add('upload-zone__icon--success');
  claimUploadTitle.textContent = 'Image Attached!';
  claimUploadHint.textContent = 'Tap to change photo';
});

function markMarkerResolved(claim) {
  claim.marker.setIcon(hotspotIcon(true));
  claim.row.status = 'resolved';
  const idx = hotspotMarkers.indexOf(claim.marker);
  if (idx !== -1) hotspotMarkers.splice(idx, 1);
  resolvedMarkers.push(claim.marker);

  const territory = L.circle(claim.marker.getLatLng(), {
    radius: 45,
    color: '#2EFFB2',
    weight: 1,
    opacity: 0.4,
    fillColor: '#2EFFB2',
    fillOpacity: 0.10,
    interactive: false,
  }).addTo(map);
  resolvedMarkers.push(territory);
}

runScannerBtn.addEventListener('click', async () => {
  if (!currentClaim) return;

  if (!claimPhotoInput.files[0]) {
    showToast('Please attach an "after" photo first 📷');
    return;
  }

  if (!supabase) {
    showToast('Cannot verify right now — please try again shortly');
    return;
  }

  showClaimState('scanning');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const { error } = await supabase
    .from('hotspots')
    .update({ status: 'resolved' })
    .eq('id', currentClaim.row.id);

  if (error) {
    console.error('Error updating hotspot status:', error);
    showToast('Verification failed — please try again');
    showClaimState('form');
    return;
  }

  const reductionPercent = Math.floor(Math.random() * (99 - 75 + 1)) + 75;
  const bottleEquivalent = Math.round(reductionPercent / 5);

  markMarkerResolved(currentClaim);
  addXp(XP_PER_VERIFY);

  claimSuccessPercent.textContent = reductionPercent;
  claimSuccessSubtext.textContent = `≈ ${bottleEquivalent} plastic bottles' worth of waste cleared 🌊`;
  claimSuccessXp.textContent = `+${XP_PER_VERIFY} XP`;
  showClaimState('success');

  currentClaim = null;
});

claimShareBtn.addEventListener('click', async () => {
  const shareText =
    `Cleanup Verified! ${claimSuccessPercent.textContent}% waste reduction detected. ` +
    `${claimSuccessSubtext.textContent} ${claimSuccessXp.textContent} via WasteRadar 🌍`;

  if (navigator.share) {
    try {
      await navigator.share({ title: 'WasteRadar', text: shareText, url: window.location.href });
    } catch (err) {
      // AbortError just means the user closed the share sheet
    }
    return;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(shareText);
      showToast('Copied to clipboard — share your win!');
    } catch (err) {
      console.error('Clipboard write failed:', err);
    }
  }
});

// =========================================================
// Bottom navigation — Map is home; Leaderboard and Me open as sheets.
// =========================================================
function closeAllSheets() {
  sheetBackdrop.classList.add('hidden');
  sheetLeaderboard.classList.add('hidden');
  sheetMe.classList.add('hidden');
}

function setActiveNav(name) {
  navLeaderboard.classList.toggle('is-active', name === 'leaderboard');
  navMap.classList.toggle('is-active', name === 'map');
  navMe.classList.toggle('is-active', name === 'me');
}

function goToMap() {
  closeAllSheets();
  setActiveNav('map');
}

function openSheet(name) {
  sheetBackdrop.classList.remove('hidden');
  sheetLeaderboard.classList.toggle('hidden', name !== 'leaderboard');
  sheetMe.classList.toggle('hidden', name !== 'me');
  setActiveNav(name);
}

navMap.addEventListener('click', goToMap);
sheetBackdrop.addEventListener('click', goToMap);
closeLeaderboardBtn.addEventListener('click', goToMap);
closeMeBtn.addEventListener('click', goToMap);

navLeaderboard.addEventListener('click', () => {
  if (!sheetLeaderboard.classList.contains('hidden')) { goToMap(); return; }
  openSheet('leaderboard');
  refreshLeaderboard();
});

navMe.addEventListener('click', () => {
  if (!sheetMe.classList.contains('hidden')) { goToMap(); return; }
  openSheet('me');
  refreshMeSheet();
});

function refreshMeSheet() {
  const crew = localStorage.getItem(STORAGE_KEY) || 'Crew Member';
  const customName = localStorage.getItem(USERNAME_KEY) || '';
  meAvatar.textContent = avatarFor(crew);
  meName.textContent = customName || crew;
  meTeam.textContent = crew;
  meTeam.style.display = customName ? 'block' : 'none';
  meXpCount.textContent = xp;
}

// =========================================================
// Leaderboard data — Task 1.
//
// Team-level attribution isn't tracked in the schema yet (claiming a
// cleanup doesn't record which crew did it), so there is no real
// per-team number to query. Rather than fabricate one, we take the one
// number that IS real — total verified cleanups — and split it with an
// honest, unweighted random distribution. Deliberately NOT biased toward
// whichever team is currently viewing it.
// =========================================================
function splitCountAcrossTeams(total, teamCount) {
  if (total <= 0) return new Array(teamCount).fill(0);
  const cuts = [0];
  for (let i = 0; i < teamCount - 1; i++) {
    cuts.push(Math.floor(Math.random() * (total + 1)));
  }
  cuts.push(total);
  cuts.sort((a, b) => a - b);
  const counts = [];
  for (let i = 0; i < teamCount; i++) counts.push(cuts[i + 1] - cuts[i]);
  return counts;
}

function renderLeaderboard(total) {
  leaderboardTotalEl.textContent = total;

  if (total <= 0) {
    leaderboardListEl.innerHTML =
      '<p class="leaderboard-caption">No cleanups verified yet — be the first crew on the board!</p>';
    return;
  }

  const counts = splitCountAcrossTeams(total, LEADERBOARD_TEAMS.length);
  const myTeam = localStorage.getItem(STORAGE_KEY);

  const rows = LEADERBOARD_TEAMS
    .map((team, i) => ({ team, score: counts[i] }))
    .sort((a, b) => b.score - a.score);

  leaderboardListEl.innerHTML = rows
    .map((row, i) => `
      <div class="leaderboard-row ${row.team === myTeam ? 'leaderboard-row--you' : ''}">
        <span class="leaderboard-row__rank">#${i + 1}</span>
        <span class="leaderboard-row__avatar">${avatarFor(row.team)}</span>
        <span class="leaderboard-row__name">${row.team}${row.team === myTeam ? ' (you)' : ''}</span>
        <span class="leaderboard-row__score">${row.score}</span>
      </div>
    `)
    .join('');
}

async function refreshLeaderboard() {
  leaderboardListEl.innerHTML = '<p class="leaderboard-caption">Loading standings...</p>';

  if (!supabase) {
    leaderboardListEl.innerHTML =
      '<p class="leaderboard-caption">Leaderboard unavailable — check your connection and try again.</p>';
    return;
  }

  const { count, error } = await supabase
    .from('hotspots')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'resolved');

  if (error) {
    console.error('Error fetching leaderboard count:', error);
    leaderboardListEl.innerHTML =
      '<p class="leaderboard-caption">Could not load leaderboard data. Check your connection and try again.</p>';
    return;
  }

  renderLeaderboard(count || 0);
}

// Unified Escape handling for every dismissible surface
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (reportPlacementActive) cancelReportPlacement();
  if (!reportModal.classList.contains('hidden')) requestClose();
  if (!claimModal.classList.contains('hidden')) requestCloseClaim();
  if (!sheetLeaderboard.classList.contains('hidden') || !sheetMe.classList.contains('hidden')) goToMap();
});

// =========================================================
// Developer "Demo Reset" trigger — hidden demo-reset gesture (Task 2).
//
// SECURITY NOTE: this offers zero real protection on its own. The delete
// call below runs with the same public anon key already shipped in this
// file — anyone who opens devtools can run it directly with no gesture
// at all. The only thing actually preventing a random visitor from
// wiping this table is your Supabase Row Level Security policy on
// `hotspots`. Treat this as a demo convenience, not a security boundary.
// =========================================================
let devTapTimestamps = [];
const DEV_TAP_WINDOW_MS = 600;
const DEV_TAPS_REQUIRED = 3;

devModeTrigger.addEventListener('click', () => {
  const now = Date.now();
  devTapTimestamps = devTapTimestamps.filter((t) => now - t < DEV_TAP_WINDOW_MS);
  devTapTimestamps.push(now);
  if (devTapTimestamps.length >= DEV_TAPS_REQUIRED) {
    devTapTimestamps = [];
    triggerDevReset();
  }
});

async function triggerDevReset() {
  const confirmed = window.confirm('DEV MODE: Reset all map data for live demo?');
  if (!confirmed) return;

  if (!supabase) {
    window.alert('Cannot reset — the database connection is not available.');
    return;
  }

  const { error } = await supabase.from('hotspots').delete().not('id', 'is', null);

  if (error) {
    console.error('Dev reset failed:', error);
    window.alert('Reset failed: ' + error.message);
    return;
  }

  window.location.reload();
}

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

// =========================================================
// PWA — register the service worker (see sw.js)
// =========================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  });
}

})();
