/* ═══════════════════════════════════════════════════════
   BICTS — js/app.js
   Core application logic: navigation, modals, complaints
   store, wizard flow, and boot sequence.
   Depends on: data.js, classifier.js, render.js, dataset.js
═══════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════
   COMPLAINTS STORE
══════════════════════════════════════════════════════ */
let complaints = [];
let nextId     = 1;
let notifStore = [];

function addComplaint(data) {
  const id   = '#' + String(nextId).padStart(3, '0');
  const date = new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  complaints.unshift({ id, date, ...data });
  nextId++;
  renderAll();
  return complaints[0];
}

function resolveComplaint(id) {
  const c = complaints.find(x => x.id === id);
  if (!c || c.status === 'Resolved') return;
  c.status     = 'Resolved';
  c.sb         = 'b-green';
  c.resolvedAt = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  pushNotif('Complaint ' + id + ' (' + c.category + ') marked as Resolved.', 'success');
  renderAll();
}

function advanceStatus(id) {
  const c = complaints.find(x => x.id === id);
  if (!c) return;
  const idx = STATUS_FLOW.indexOf(c.status);
  if (idx < STATUS_FLOW.length - 1) {
    c.status = STATUS_FLOW[idx + 1];
    c.sb     = statusBadge(c.status);
    if (c.status === 'Resolved') {
      c.resolvedAt = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
      pushNotif('Complaint ' + id + ' (' + c.category + ') marked as Resolved.', 'success');
    }
    renderAll();
  }
}

function pushNotif(msg, type) {
  notifStore.unshift({
    msg, type,
    time: new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
  });
  renderNotifs();
  const bell = document.querySelector('.topbar-action');
  if (bell) { bell.style.background = 'var(--sky-light)'; setTimeout(() => { bell.style.background = ''; }, 1200); }
}

/* Re-render all live sections */
function renderAll() {
  renderDashboardStats();
  renderCriticalCases();
  renderComplaints();
  renderPriorityQueue();
  renderKanban();
  renderDashboardDonut();
  renderWeeklyBars();
}

/* ══════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════ */
const SCREEN_TITLES = {
  dashboard:          'Dashboard',
  complaints:         'All Complaints',
  'complaint-detail': 'Complaint Detail',
  priority:           'Priority Queue',
  cases:              'Case Board',
  ai:                 'AI Classification Results',
  reports:            'Reports',
  users:              'User Management',
  notifs:             'Notifications',
  settings:           'Settings',
};

function showScreen(id, navEl) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + id);
  if (el) el.classList.add('active');
  document.getElementById('topbar-title').textContent = SCREEN_TITLES[id] || id;
  if (navEl) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    navEl.classList.add('active');
  }
}

function doLogin() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('shell').style.display        = 'flex';
}

function doLogout() {
  document.getElementById('shell').style.display        = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

/* ══════════════════════════════════════════════════════
   COMPLAINT DETAIL VIEW
══════════════════════════════════════════════════════ */
function viewComplaint(id) {
  const c = complaints.find(x => x.id === id);
  if (!c) return;

  const bcEl = document.getElementById('detail-breadcrumb');
  if (bcEl) bcEl.textContent = id + ' – ' + c.category;

  const ptEl = document.getElementById('detail-page-title');
  if (ptEl) ptEl.textContent = id + ' – ' + c.category;

  const badgeRow = document.getElementById('detail-badge-row');
  if (badgeRow) {
    badgeRow.innerHTML =
      '<span class="badge b-blue">' + c.category + '</span>' +
      '<span class="badge ' + c.pb + '">' + c.priority + ' Priority</span>' +
      '<span class="badge ' + c.sb + '">' + c.status   + '</span>';
  }

  const resolveBtn = document.getElementById('detail-resolve-btn');
  if (resolveBtn) {
    if (c.status !== 'Resolved') {
      resolveBtn.textContent       = '✓ Resolve';
      resolveBtn.style.color       = 'var(--green)';
      resolveBtn.style.borderColor = 'var(--green)';
      resolveBtn.onclick = () => { resolveComplaint(id); viewComplaint(id); };
    } else {
      resolveBtn.textContent       = '✓ Resolved';
      resolveBtn.style.color       = 'var(--text3)';
      resolveBtn.style.borderColor = 'var(--border)';
      resolveBtn.onclick           = null;
    }
  }

  const fieldMap = {
    'detail-date-filed':    c.date        || '—',
    'detail-incident-date': (c.date || '—') + (c.time ? ' ' + c.time : ''),
    'detail-location':      c.location    || '—',
    'detail-affected':      c.affected    || '—',
    'detail-complainant':   c.complainant || 'Anonymous',
    'detail-officer':       c.officer     || '—',
  };
  Object.entries(fieldMap).forEach(([elId, val]) => {
    const el = document.getElementById(elId);
    if (el) el.textContent = val;
  });

  const descEl = document.getElementById('detail-description');
  if (descEl) descEl.textContent = c.description || 'No description provided.';

  renderDetailNlpBars(c);
  renderDetailAhp(c);
  renderDetailTimeline(c);
  renderCaseNotes();

  showScreen('complaint-detail', null);
  document.getElementById('topbar-title').textContent = id + ' – ' + c.category;
}

/* ══════════════════════════════════════════════════════
   MODALS
══════════════════════════════════════════════════════ */
function showModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
  if (id === 'submitModal') resetWizard();
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function initModalBackdropClose() {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
  });
}

/* ══════════════════════════════════════════════════════
   SUBMIT COMPLAINT WIZARD
══════════════════════════════════════════════════════ */
let wizardStep   = 1;
const TOTAL_STEPS = 4;
let _lastAiResult = { cat: CATEGORIES[0], conf: 75, scores: {} };

function resetWizard() {
  wizardStep = 1;
  renderWizardStep();
  ['w-date','w-time','w-location','w-description','w-complainant','w-affected']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

function wizardNext() {
  if (wizardStep === 1) {
    const loc  = (document.getElementById('w-location')?.value  || '').trim();
    const desc = (document.getElementById('w-description')?.value || '').trim();
    if (!loc || !desc) { alert('Please fill in Location and Description before proceeding.'); return; }
  }
  if (wizardStep < TOTAL_STEPS) {
    wizardStep++;
    renderWizardStep();
    if (wizardStep === 3) runAiClassification();
  }
}

function wizardBack() {
  if (wizardStep > 1) { wizardStep--; renderWizardStep(); }
}

function wizardSubmit() {
  const description = document.getElementById('w-description')?.value || '';
  const affected    = document.getElementById('w-affected')?.value    || '1';
  const cat         = _lastAiResult.cat;
  const conf        = _lastAiResult.conf;
  const ahp         = computeAHPScore(cat, affected, description);
  const priInfo     = priorityLabel(ahp.score);

  addComplaint({
    description,
    location:    document.getElementById('w-location')?.value    || '',
    date:        document.getElementById('w-date')?.value        || '',
    time:        document.getElementById('w-time')?.value        || '',
    complainant: document.getElementById('w-complainant')?.value || 'Anonymous',
    affected,
    category:    cat,
    confidence:  conf,
    score:       ahp.score.toString(),
    priority:    priInfo.label,
    pb:          priInfo.badge,
    officer:     '—',
    status:      'Open',
    sb:          'b-gray',
  });

  pushNotif('New complaint — ' + cat + ' · Priority: ' + priInfo.label, 'info');
  wizardStep = 5;
  renderWizardStep();
}

function renderWizardStep() {
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const numEl = document.getElementById('ws-n-' + i);
    const lblEl = document.getElementById('ws-l-' + i);
    if (!numEl) continue;
    const state       = i < wizardStep ? 'done' : i === wizardStep ? 'cur' : 'todo';
    numEl.className   = 'wizard-step-n '     + state;
    if (lblEl) lblEl.className = 'wizard-step-label ' + state;
    numEl.textContent = i < wizardStep ? '✓' : String(i);
  }

  document.querySelectorAll('.wizard-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(wizardStep <= TOTAL_STEPS ? 'wp-' + wizardStep : 'wp-success');
  if (panel) panel.classList.add('active');

  const backBtn   = document.getElementById('wizard-back');
  const nextBtn   = document.getElementById('wizard-next');
  const submitBtn = document.getElementById('wizard-submit');
  const cancelBtn = document.getElementById('wizard-cancel');
  const doneBtn   = document.getElementById('wizard-done');
  if (!backBtn) return;

  if (wizardStep === 5) {
    [backBtn, nextBtn, submitBtn].forEach(b => { b.style.display = 'none'; });
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (doneBtn)   doneBtn.style.display   = 'inline-flex';
    return;
  }

  if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  if (doneBtn)   doneBtn.style.display   = 'none';
  backBtn.style.display   = wizardStep > 1            ? 'inline-flex' : 'none';
  nextBtn.style.display   = wizardStep < TOTAL_STEPS  ? 'inline-flex' : 'none';
  submitBtn.style.display = wizardStep === TOTAL_STEPS ? 'inline-flex' : 'none';
  nextBtn.textContent     = wizardStep === 2 ? 'Next: AI Classify →' : wizardStep === 3 ? 'Next: Confirm →' : 'Next →';
}

function runAiClassification() {
  const desc   = document.getElementById('w-description')?.value || '';
  const result = classifyDescription(desc);
  _lastAiResult = result;

  const catEl  = document.getElementById('ai-cat');
  const confEl = document.getElementById('ai-conf');
  const barsEl = document.getElementById('ai-conf-bars');
  if (catEl)  catEl.textContent  = result.cat;
  if (confEl) confEl.textContent = result.conf + '% confidence · SVM (TF-IDF bigrams)';

  if (barsEl) {
    barsEl.innerHTML = CATEGORIES.map(cat => {
      const pct = result.scores[cat] || 3;
      return '<div class="conf-bar">' +
        '<span class="conf-label">' + cat + (cat === result.cat ? ' ★' : '') + '</span>' +
        '<div class="conf-track"><div class="conf-fill" style="width:' + pct + '%;background:' +
        (cat === result.cat ? 'var(--blue)' : 'var(--sky)') + '"></div></div>' +
        '<span class="conf-pct">' + pct + '%</span></div>';
    }).join('');
  }

  /* Pre-fill confirm panel */
  const el  = document.getElementById('confirm-rows');
  if (!el) return;
  const aff = document.getElementById('w-affected')?.value || '1';
  const ahp = computeAHPScore(result.cat, aff, desc);
  const pri = priorityLabel(ahp.score);
  el.innerHTML = [
    ['Date',           document.getElementById('w-date')?.value        || '—'],
    ['Time',           document.getElementById('w-time')?.value        || '—'],
    ['Location',       document.getElementById('w-location')?.value    || '—'],
    ['Description',    (desc.length > 80 ? desc.slice(0,80) + '…' : desc)],
    ['Complainant',    document.getElementById('w-complainant')?.value || 'Anonymous'],
    ['Affected',       aff],
    ['AI Category',    result.cat + ' (' + result.conf + '% confidence)'],
    ['Fuzzy AHP Score',ahp.score + ' / 100 → ' + pri.label],
  ].map(r =>
    '<div class="confirm-row"><span class="confirm-key">' + r[0] + '</span><span class="confirm-val">' + r[1] + '</span></div>'
  ).join('');
}

/* ══════════════════════════════════════════════════════
   FILTER STATE
══════════════════════════════════════════════════════ */
let _activeStatusFilter = 'All';

function filterByStatus(status, el) {
  _activeStatusFilter = status;
  document.querySelectorAll('#screen-complaints .filter-row .chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  renderComplaints();
}

function filterComplaints() { renderComplaints(); }

/* ══════════════════════════════════════════════════════
   MISC UI INIT
══════════════════════════════════════════════════════ */
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', function () {
      this.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
    });
  });
}

function initToggles() {
  document.querySelectorAll('.toggle').forEach(toggle => {
    toggle.addEventListener('click', function () {
      this.classList.toggle('on');
      this.classList.toggle('off');
    });
  });
}

/* ══════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  /* Load real SVM model first — classifier.js handles fallback if fetch fails */
  initClassifier();

  /* Static renders (data from data.js) */
  renderAccuracyBars();
  renderDashboardDonut();
  renderCriticalCases();
  renderDashboardStats();
  renderComplaints();
  renderPriorityQueue();
  renderKanban();
  renderDatasetVersionTable();
  renderModelComparison();
  renderF1Table();
  renderNlpPipeline();
  renderAugTags();
  renderReports();
  renderWeeklyBars();
  renderIsoEval();
  renderUsers();
  renderNotifs();
  renderSettings();

  /* UI behaviour */
  initModalBackdropClose();
  initTabs();
  initToggles();
});