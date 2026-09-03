(function () {
'use strict';

// =========================================================
// Config / shared state
// =========================================================
const AGADIR_COORDS = [30.4278, -9.5981];
const DEFAULT_ZOOM = 13;
const STORAGE_KEY = 'wasteradar_crew';
const REPORT_JITTER = 0.012; // degrees — keeps simulated reports near the city center
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
let resolvedMarkers = []; // markers verified this session — kept OUT of hotspotMarkers so a
                           // later re-fetch never removes them; they stay on the map as
                           // permanent green "captured territory" pins for this session.

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
const deployBtn = document.getElementById('deploy-btn');

const hud = document.getElementById('hud');
const hudTeamBtn = document.getElementById('hud-team-btn');
const hudAvatar = document.getElementById('hud-avatar');
const hudTeamName = document.getElementById('hud-team-name');
const hudXpWrap = document.querySelector('.hud__xp');
const hudXpCount = document.getElementById('hud-xp-count');

const reportBtn = document.getElementById('report-btn');
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
const claimSuccessText = document.getElementById('claim-success-text');
const claimDoneBtn = document.getElementById('claim-done-btn');

const leaderboardBtn = document.getElementById('leaderboard-btn');
const leaderboardBackdrop = document.getElementById('leaderboard-backdrop');
const leaderboardPanel = document.getElementById('leaderboard-panel');
const closeLeaderboardBtn = document.getElementById('close-leaderboard');
const leaderboardListEl = document.getElementById('leaderboard-list');
const leaderboardTotalEl = document.getElementById('leaderboard-total');

const devModeTrigger = document.getElementById('dev-mode-trigger');

const toastEl = document.getElementById('toast');

// =========================================================
// Map init — CartoDB Dark Matter basemap, centered on Agadir, Morocco.
// High-contrast dark tiles so the neon-green UI and red/green hotspot
// pins pop aggressively (Task 3). Only ever called from activateCrew().
// =========================================================
function initMap() {
  map = L.map('map', { zoomControl: false }).setView(AGADIR_COORDS, DEFAULT_ZOOM);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);
}

// =========================================================
// Mock authentication — "Select Your Crew" -> Deploy
// =========================================================
function showAuthOverlay() { authOverlay.classList.remove('hidden'); }
function hideAuthOverlay() { authOverlay.classList.add('hidden'); }

function activateCrew(crewName) {
  crewSelect.value = crewName;
  hudAvatar.textContent = avatarFor(crewName);
  hudTeamName.textContent = crewName;
  hud.classList.remove('hidden');

  // Hide the modal completely before anything else happens
  hideAuthOverlay();

  // Map + live Supabase data only come online AFTER the modal is dismissed
  if (!map) initMap();
  fetchHotspots();
}

deployBtn.addEventListener('click', () => {
  const selectedTeam = crewSelect.value;
  localStorage.setItem(STORAGE_KEY, selectedTeam);
  activateCrew(selectedTeam);
  showToast(`${selectedTeam} deployed to Agadir`);
});

hudTeamBtn.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  hud.classList.add('hidden');
  showAuthOverlay();
});

// Frictionless: if a crew was already selected in a previous visit, skip the modal
const savedCrew = localStorage.getItem(STORAGE_KEY);
if (savedCrew) {
  activateCrew(savedCrew);
} else {
  showAuthOverlay();
}

// =========================================================
// XP helper — shared by report submissions and cleanup verifications,
// with a small "bump" animation on the HUD counter for gamified feedback.
// =========================================================
function addXp(amount) {
  xp += amount;
  hudXpCount.textContent = xp;
  hudXpWrap.classList.remove('bump');
  void hudXpWrap.offsetWidth; // force reflow so the animation restarts even if still mid-bump
  hudXpWrap.classList.add('bump');
}

// =========================================================
// Live hotspots — fetched from Supabase.
// Red marker = open (click it to claim + verify a cleanup).
// Green marker = resolved this session (see Claim Cleanup flow below).
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
  if (!map) return; // guard: this should never run before initMap() has fired

  if (!supabase) {
    console.error('fetchHotspots() aborted: Supabase client is not available.');
    showToast('Live data unavailable — Supabase failed to load');
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
}

// =========================================================
// Report Hotspot modal — functional photo picker, real DB insert
// =========================================================
function resetReportForm() {
  photoInput.value = '';
  uploadZone.classList.remove('has-photo');
  uploadZoneIcon.textContent = '📷';
  uploadZoneIcon.classList.remove('upload-zone__icon--success');
  uploadZoneTitle.textContent = 'Snap a photo of the waste';
  uploadZoneHint.textContent = 'Tap to open camera or gallery';
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
  submitBtn.disabled = true;
  submitBtn.classList.add('is-loading');
  submitLabel.textContent = 'Analyzing coordinates...';

  if (!supabase) {
    console.error('Submit aborted: Supabase client is not available.');
    showToast('Cannot submit — Supabase failed to load');
    submitBtn.disabled = false;
    submitBtn.classList.remove('is-loading');
    submitLabel.textContent = 'Submit Report';
    return;
  }

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

  await fetchHotspots(); // re-render open hotspots from the DB, no page reload
  addXp(XP_PER_REPORT);
  performClose();
  showToast(`+${XP_PER_REPORT} XP — hotspot reported and live on the map`);
});

// =========================================================
// Claim Cleanup modal — AI verification core loop
// =========================================================
let currentClaim = null; // { row, marker } for whichever hotspot is currently being claimed

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
  runScannerBtn.disabled = true;
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
  if (isScanning) return; // ignore dismiss attempts mid-scan
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
  runScannerBtn.disabled = false;
});

// Detach a resolved marker from the live-fetch tracking array so a future
// fetchHotspots() (triggered by someone else's report) never removes it —
// it stays on the map as a permanent green "captured territory" pin.
function markMarkerResolved(claim) {
  claim.marker.setIcon(hotspotIcon(true));
  claim.row.status = 'resolved';
  const idx = hotspotMarkers.indexOf(claim.marker);
  if (idx !== -1) hotspotMarkers.splice(idx, 1);
  resolvedMarkers.push(claim.marker);
}

runScannerBtn.addEventListener('click', async () => {
  if (!currentClaim) return;

  if (!supabase) {
    showToast('Cannot verify — Supabase failed to load');
    return;
  }

  // Task 2: highly visual "smoke & mirrors" AI analysis — a fixed delay,
  // not a real model. The DB write right after it is real, though, and
  // is handled honestly (failure blocks success, same as the report flow).
  showClaimState('scanning');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const { error } = await supabase
    .from('hotspots')
    .update({ status: 'resolved' })
    .eq('id', currentClaim.row.id);

  if (error) {
    console.error('Error updating hotspot status:', error);
    showToast('Verification failed — please try again');
    showClaimState('form'); // let them retry without re-uploading the photo
    return;
  }

  const reductionPercent = Math.floor(Math.random() * (99 - 75 + 1)) + 75; // 75–99 inclusive

  markMarkerResolved(currentClaim);
  addXp(XP_PER_VERIFY);

  claimSuccessText.textContent =
    `Cleanup Verified! ${reductionPercent}% waste reduction detected. +${XP_PER_VERIFY} XP`;
  showClaimState('success');

  currentClaim = null;
});

// =========================================================
// Leaderboard — Task 1.
//
// Team-level attribution isn't tracked in the schema yet (claiming a
// cleanup doesn't record which crew did it), so there is no real
// per-team number to query. Rather than fabricate one, we take the one number
// that IS real — total verified cleanups — and split it with an honest,
// unweighted random distribution. It's deliberately NOT biased toward
// whichever team is currently viewing it: a leaderboard that quietly
// always flatters the current user isn't a leaderboard, it's a trick,
// and it would mislead a real demo audience about actual progress.
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
  const counts = splitCountAcrossTeams(total, LEADERBOARD_TEAMS.length);
  const myTeam = localStorage.getItem(STORAGE_KEY);

  const rows = LEADERBOARD_TEAMS
    .map((team, i) => ({ team, score: counts[i] }))
    .sort((a, b) => b.score - a.score);

  leaderboardTotalEl.textContent = total;
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

async function openLeaderboard() {
  leaderboardBackdrop.classList.remove('hidden');
  leaderboardPanel.classList.remove('hidden');
  leaderboardListEl.innerHTML = '<p class="leaderboard-caption">Loading standings...</p>';

  if (!supabase) {
    leaderboardListEl.innerHTML = '<p class="leaderboard-caption">Leaderboard unavailable — Supabase failed to load.</p>';
    return;
  }

  const { count, error } = await supabase
    .from('hotspots')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'resolved');

  if (error) {
    console.error('Error fetching leaderboard count:', error);
    leaderboardListEl.innerHTML = '<p class="leaderboard-caption">Could not load leaderboard data.</p>';
    return;
  }

  renderLeaderboard(count || 0);
}

function closeLeaderboard() {
  leaderboardBackdrop.classList.add('hidden');
  leaderboardPanel.classList.add('hidden');
}

leaderboardBtn.addEventListener('click', openLeaderboard);
closeLeaderboardBtn.addEventListener('click', closeLeaderboard);
leaderboardBackdrop.addEventListener('click', closeLeaderboard);

// Unified Escape handling for every dismissible overlay
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!reportModal.classList.contains('hidden')) requestClose();
  if (!claimModal.classList.contains('hidden')) requestCloseClaim();
  if (!leaderboardPanel.classList.contains('hidden')) closeLeaderboard();
});

// =========================================================
// Developer "God Mode" — hidden demo-reset gesture (Task 2).
//
// SECURITY NOTE: this offers zero real protection on its own. The delete
// call below runs with the same public anon key already shipped in this
// file — anyone who opens devtools can run it directly with no gesture
// at all. The only thing actually preventing a random visitor from
// wiping this table is your Supabase Row Level Security policy on
// `hotspots`. If anon can DELETE here, anon can DELETE from the console
// too. Treat this as a demo convenience, not a security boundary.
// =========================================================
let lastDevTapTime = 0;
const DOUBLE_TAP_WINDOW_MS = 400;

devModeTrigger.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastDevTapTime < DOUBLE_TAP_WINDOW_MS) {
    lastDevTapTime = 0; // reset so a stray third tap doesn't immediately re-trigger
    triggerDevReset();
  } else {
    lastDevTapTime = now;
  }
});

async function triggerDevReset() {
  const confirmed = window.confirm('DEV MODE: Reset all map data for live demo?');
  if (!confirmed) return;

  if (!supabase) {
    window.alert('Cannot reset — Supabase client is not available.');
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

})();
