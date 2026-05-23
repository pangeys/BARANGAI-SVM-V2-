/* ═══════════════════════════════════════════════════════
   BICTS — js/app.js  (DB-connected version)
   Core application logic: navigation, modals, complaints
   store, wizard flow, and boot sequence.

   Changes from original:
     • complaints[], notifStore[], nextId are loaded from
       MySQL via api.php on every page load.
     • addComplaint(), resolveComplaint(), advanceStatus(),
       pushNotif() all sync to the DB automatically.
     • Full in-memory fallback if api.php is unreachable.

   Depends on: data.js, classifier.js, render.js, dataset.js

   NOTE: The admin login + profile gate now lives in login.html.
   No login/profile logic belongs in this file.
═══════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════
   API CONFIG
   Points to api.php in the same folder as index.html.
══════════════════════════════════════════════════════ */
const API_URL = 'api.php';

/* ══════════════════════════════════════════════════════
   COMPLAINTS STORE  (in-memory cache, synced to DB)
══════════════════════════════════════════════════════ */
let complaints = [];
let nextId     = 1;
let notifStore = [];

/* ── Load everything from the database on boot ── */
async function loadFromDB() {
  try {
    const res  = await fetch(API_URL + '?type=init');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    complaints = data.complaints  || [];
    notifStore = (data.notifications || []).map(n => ({
      msg:    n.msg,
      type:   n.type,
      time:   n.time,
      unread: n.isRead ? false : true,
    }));
    nextId     = parseInt(data.nextId) || 1;

    console.log('BICTS: Loaded from DB —', complaints.length, 'complaints,', notifStore.length, 'notifications.');
  } catch (err) {
    console.warn('BICTS: Could not reach api.php, running in in-memory mode.', err);
    complaints = [];
    notifStore = [];
    nextId     = 1;
  }

  /* Render everything now that data is loaded */
  renderAll();
  renderNotifs();
}

/* ── Add a new complaint (saves to DB, updates local cache) ── */
async function addComplaint(data) {
  const dateFiled = new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });

  try {
    const res    = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        action: 'add_complaint',
        data:   { ...data, date_filed: dateFiled },
      }),
    });
    const result = await res.json();

    if (result.success) {
      /* Push to local cache using the server-assigned ID */
      const newComplaint = { id: result.id, date: dateFiled, ...data };
      complaints.unshift(newComplaint);
      renderAll();
      return newComplaint;
    }
  } catch (err) {
    console.warn('BICTS: DB save failed, using in-memory fallback.', err);
  }

  /* In-memory fallback */
  const id = '#' + String(nextId).padStart(3, '0');
  complaints.unshift({ id, date: dateFiled, ...data });
  nextId++;
  renderAll();
  return complaints[0];
}

/* ── Resolve a complaint (updates DB + local cache) ── */
async function resolveComplaint(id) {
  const c = complaints.find(x => x.id === id);
  if (!c || c.status === 'Resolved') return;

  c.status     = 'Resolved';
  c.sb         = 'b-green';
  c.resolvedAt = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });

  /* Optimistic update first, then sync */
  renderAll();

  try {
    await fetch(API_URL, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        action:      'update_status',
        id,
        status:      'Resolved',
        sb:          'b-green',
        resolved_at: c.resolvedAt,
      }),
    });
  } catch (err) {
    console.warn('BICTS: DB status sync failed.', err);
  }

  await pushNotif('Complaint ' + id + ' (' + c.category + ') marked as Resolved.', 'success');
}

/* ── Advance complaint to the next status step ── */
async function advanceStatus(id) {
  const c = complaints.find(x => x.id === id);
  if (!c) return;

  const idx = STATUS_FLOW.indexOf(c.status);
  if (idx >= STATUS_FLOW.length - 1) return;

  c.status = STATUS_FLOW[idx + 1];
  c.sb     = statusBadge(c.status);

  if (c.status === 'Resolved') {
    c.resolvedAt = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
    await pushNotif('Complaint ' + id + ' (' + c.category + ') marked as Resolved.', 'success');
  }

  renderAll();

  try {
    await fetch(API_URL, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        action:      'update_status',
        id,
        status:      c.status,
        sb:          c.sb,
        resolved_at: c.resolvedAt || '',
      }),
    });
  } catch (err) {
    console.warn('BICTS: DB status sync failed.', err);
  }
}

/* ── Push a notification (saves to DB + local cache) ── */
async function pushNotif(msg, type) {
  const time = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  notifStore.unshift({ msg, type, time, unread: true });
  renderNotifs();

  /* Bell flash */
  const bell = document.querySelector('.topbar-action');
  if (bell) {
    bell.style.background = 'var(--sky-light)';
    setTimeout(() => { bell.style.background = ''; }, 1200);
  }

  try {
    await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'add_notification', msg, notif_type: type, time }),
    });
  } catch (err) {
    console.warn('BICTS: Notification DB save failed.', err);
  }
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

  /* Lazy-load the Users page data the first time it's opened */
  if (id === 'users' && typeof loadUsers === 'function') loadUsers();
}

function doLogin() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('shell').style.display        = 'flex';
}

function doLogout() {
  fetch('api/auth.php?action=logout').finally(() => location.href = 'login.html');
}
/* ══════════════════════════════════════════════════════
   NOTES DETAIL VIEW
══════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════
   CASE NOTES
══════════════════════════════════════════════════════ */
let _currentComplaintNotes = [];
let _currentComplaintId    = null;

// Loads notes from DB for a specific complaint
async function loadNotes(complaintId) {
  _currentComplaintId    = complaintId;
  _currentComplaintNotes = [];
  try {
    const res  = await fetch(API_URL + '?type=notes&complaint_id=' + encodeURIComponent(complaintId));
    const data = await res.json();
    _currentComplaintNotes = data.notes || [];
  } catch (err) {
    console.warn('Could not load notes.', err);
  }
  renderCaseNotes();
}

// Saves a new note to DB
async function addNote(complaintId, content) {
  const user = window.CURRENT_USER || {};
  const optimistic = {
    id:          null,
    author:      user.name || 'Unknown',
    author_role: user.role || '',
    content,
    created_at:  new Date().toISOString().slice(0,19).replace('T',' '),
  };

  _currentComplaintNotes.push(optimistic);
  renderCaseNotes();

  try {
    const res    = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        action:       'add_note',
        complaint_id: complaintId,
        content,
        author:       optimistic.author,
        author_role:  optimistic.author_role,
        barangay_id:  user.barangay_id || null,
      }),
    });
    const result = await res.json();
    if (result.success) {
      const idx = _currentComplaintNotes.indexOf(optimistic);
      if (idx !== -1) _currentComplaintNotes[idx] = { ...optimistic, id: result.id, created_at: result.created_at };
      renderCaseNotes();
    }
  } catch (err) {
    console.warn('Note save failed.', err);
    _currentComplaintNotes = _currentComplaintNotes.filter(n => n !== optimistic);
    renderCaseNotes();
  }
}

// Deletes a note from DB
async function deleteNote(noteId) {
  if (!confirm('Delete this note?')) return;
  _currentComplaintNotes = _currentComplaintNotes.filter(n => n.id !== noteId);
  renderCaseNotes();
  try {
    await fetch(API_URL, {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'delete_note', id: noteId }),
    });
  } catch (err) {
    console.warn('Note delete failed.', err);
    if (_currentComplaintId) await loadNotes(_currentComplaintId);
  }
}

// Called when Save Note button is clicked
async function submitNote() {
  const ta      = document.getElementById('note-content');
  const content = (ta ? ta.value : '').trim();
  if (!content) { alert('Please write something before saving.'); return; }

  const btn = document.getElementById('note-submit-btn');
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  await addNote(_currentComplaintId, content);

  if (btn) { btn.textContent = 'Save Note'; btn.disabled = false; }
  if (ta)  ta.value = '';
  hideNoteForm();
}

// Shows the note input form
function showNoteForm() {
  const form = document.getElementById('note-form');
  if (form) form.style.display = 'block';
  const ta = document.getElementById('note-content');
  if (ta) { ta.value = ''; ta.focus(); }
}

// Hides and clears the note input form
function hideNoteForm() {
  const form = document.getElementById('note-form');
  if (form) form.style.display = 'none';
  const ta = document.getElementById('note-content');
  if (ta) ta.value = '';
}

// Draws the notes list on screen
function renderCaseNotes() {
  const el = document.getElementById('case-notes');
  if (!el) return;

  if (_currentComplaintNotes.length === 0) {
    el.innerHTML =
      '<div class="empty-state" style="padding:20px 0;">' +
        '<div class="empty-icon">📝</div>' +
        '<div class="empty-title">No notes yet</div>' +
        '<div class="empty-desc">Add a note to begin tracking case progress.</div>' +
      '</div>';
    return;
  }

  el.innerHTML = _currentComplaintNotes.map(function(n) {
    const initial   = (n.author || '?').charAt(0).toUpperCase();
    const canDelete = window.CURRENT_USER && n.id !== null;
    const date      = (function() {
      try {
        const d = new Date(n.created_at.replace(' ','T'));
        return d.toLocaleDateString('en-PH',{ month:'short', day:'numeric' }) + ' · ' +
               d.toLocaleTimeString('en-PH',{ hour:'2-digit', minute:'2-digit' });
      } catch(e) { return n.created_at; }
    })();

    return (
      '<div style="padding:12px 0;border-bottom:1px solid var(--border);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="width:28px;height:28px;border-radius:50%;background:var(--sky-light);color:var(--blue);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">' + initial + '</div>' +
            '<span style="font-size:12px;font-weight:600;">' + n.author + '</span>' +
            (n.author_role ? '<span class="badge b-gray" style="font-size:9px;">' + n.author_role + '</span>' : '') +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="font-size:10px;color:var(--text3);">' + date + '</span>' +
            (canDelete ? '<span style="cursor:pointer;font-size:12px;color:var(--text3);" onclick="deleteNote(' + n.id + ')">✕</span>' : '') +
          '</div>' +
        '</div>' +
        '<div style="font-size:13px;color:var(--text2);line-height:1.65;padding-left:36px;white-space:pre-wrap;">' + n.content + '</div>' +
      '</div>'
    );
  }).join('');
}
/* ══════════════════════════════════════════════════════
   COMPLAINT DETAIL VIEW
══════════════════════════════════════════════════════ */
async function viewComplaint(id) {
  const c = complaints.find(x => x.id === id);
  if (!c) return;

  const bcEl = document.getElementById('detail-breadcrumb');
  if (bcEl) bcEl.textContent = id + ' – ' + c.category;

  const ptEl = document.getElementById('detail-page-title');
  if (ptEl) ptEl.textContent = id + ' – ' + c.category;

  const badgeRow = document.getElementById('detail-badge-row');
  if (badgeRow) {
    badgeRow.innerHTML =
      '<span class="badge b-blue">'   + c.category + '</span>' +
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
  hideNoteForm();
  await loadNotes(id);  

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
let wizardStep    = 1;
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

async function wizardSubmit() {
  const description = document.getElementById('w-description')?.value || '';
  const affected    = document.getElementById('w-affected')?.value    || '1';
  const cat         = _lastAiResult.cat;
  const conf        = _lastAiResult.conf;
  const ahp         = computeAHPScore(cat, affected, description);
  const priInfo     = priorityLabel(ahp.score);

  /* Show a brief loading indicator on the submit button */
  const submitBtn = document.getElementById('wizard-submit');
  if (submitBtn) { submitBtn.textContent = 'Saving…'; submitBtn.disabled = true; }

  await addComplaint({
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

  await pushNotif('New complaint — ' + cat + ' · Priority: ' + priInfo.label, 'info');

  if (submitBtn) { submitBtn.textContent = '✓ Submit Complaint'; submitBtn.disabled = false; }
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
   Order: load classifier → fetch DB data → render static
══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {

  /* 1. Load the real SVM model (classifier.js handles fallback) */
  await initClassifier();

  /* 2. Fetch all persisted data from the database */
  await loadFromDB();

  /* 3. Static renders that don't depend on complaints (data.js constants) */
  renderAccuracyBars();
  renderDashboardDonut();
  renderDatasetVersionTable();
  renderModelComparison();
  renderF1Table();
  renderNlpPipeline();
  renderAugTags();
  renderReports();
  renderIsoEval();
  renderUsers();
  renderSettings();

  /* 4. UI behaviour */
  initModalBackdropClose();
  initTabs();
  initToggles();
});