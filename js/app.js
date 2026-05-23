/* ═══════════════════════════════════════════════════════
   BICTS — js/app.js  (DB-connected version)
   Core application logic: navigation, modals, complaints
   store, wizard flow, and boot sequence.

   Notes-feature changes from previous version:
     • editNote(id)      — new function: inline edit a note
     • saveNoteEdit(id)  — new function: persist edit to DB + UI
     • cancelNoteEdit(id)— new function: discard edit, restore text
     • deleteNote()      — FIX: now sends DELETE (was POST)
     • renderCaseNotes() — now renders Edit pencil + inline textarea

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
let _officers  = [];
let _editingOfficerId = null;
let _assignComplaintId = null;
let _currentDetailComplaintId = null;
let nextId     = 1;
let notifStore = [];

/* ── Load everything from the database on boot ── */
async function loadFromDB() {
  try {
    const res  = await fetch(API_URL + '?type=init');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    complaints = data.complaints  || [];
    _officers  = data.officers    || [];
    notifStore = (data.notifications || []).map(n => ({
      msg:    n.msg,
      type:   n.type,
      time:   n.time,
      unread: n.isRead ? false : true,
    }));
    nextId = parseInt(data.nextId) || 1;

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

/* ── Add a new complaint ── */
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

/* ── Resolve a complaint ── */
async function resolveComplaint(id) {
  const c = complaints.find(x => x.id === id);
  if (!c || c.status === 'Resolved' || c.status === 'Closed') return;

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

/* ── Close a complaint (final state, distinct from Resolved) ── */
async function closeComplaint(id, reason) {
  const c = complaints.find(x => x.id === id);
  if (!c || c.status === 'Resolved' || c.status === 'Closed') return;
 
  c.status      = 'Closed';
  c.sb          = 'b-gray';
  c.closeReason = reason || 'Closed';
  c.resolvedAt  = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
 
  renderAll();
 
  try {
    await fetch(API_URL, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'close_complaint', id, reason: c.closeReason }),
    });
  } catch (err) {
    console.warn('BICTS: DB close sync failed.', err);
  }
 
  await pushNotif('Complaint ' + id + ' (' + c.category + ') closed — ' + c.closeReason + '.', 'info');
}
 
/* ── Close Case modal handlers ── */
let _closingId = null;
function openCloseModal(id) {
  _closingId = id;
  const sel = document.getElementById('close-reason');
  if (sel) sel.selectedIndex = 0;
  showModal('closeModal');
}
async function submitCloseCase() {
  if (!_closingId) return;
  const reason = document.getElementById('close-reason')?.value || 'Closed';
  const id = _closingId;
  closeModal('closeModal');
  await closeComplaint(id, reason);
  _closingId = null;
  if (typeof viewComplaint === 'function') viewComplaint(id);
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

/* ── Push a notification ── */
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
   CASE NOTES — full CRUD
   State:
     _currentComplaintNotes  — array of note objects for the open complaint
     _currentComplaintId     — complaint_id string of the open complaint
══════════════════════════════════════════════════════ */
let _currentComplaintNotes = [];
let _currentComplaintId    = null;

/* ─── Load notes from DB for a complaint ─────────────── */
async function loadNotes(complaintId) {
  _currentComplaintId    = complaintId;
  _currentComplaintNotes = [];

  try {
    const res  = await fetch(API_URL + '?type=notes&complaint_id=' + encodeURIComponent(complaintId));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _currentComplaintNotes = data.notes || [];
  } catch (err) {
    console.warn('BICTS: Could not load notes.', err);
  }

  renderCaseNotes();
}

/* ─── ADD note ───────────────────────────────────────── */
async function addNote(complaintId, content) {
  const user       = window.CURRENT_USER || {};
  const optimistic = {
    id:          null,           // filled in after server confirms
    author:      user.name  || 'Unknown',
    author_role: user.role  || '',
    content,
    created_at:  new Date().toISOString().slice(0, 19).replace('T', ' '),
    updated_at:  new Date().toISOString().slice(0, 19).replace('T', ' '),
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
      if (idx !== -1) {
        _currentComplaintNotes[idx] = {
          ...optimistic,
          id:         result.id,
          created_at: result.created_at,
          updated_at: result.updated_at || result.created_at,
        };
      }
      renderCaseNotes();
    } else {
      throw new Error(result.error || 'Server returned failure');
    }
  } catch (err) {
    console.warn('BICTS: Note save failed.', err);
    // Roll back optimistic update
    _currentComplaintNotes = _currentComplaintNotes.filter(n => n !== optimistic);
    renderCaseNotes();
    alert('Could not save the note. Please try again.');
  }
}

/* ─── EDIT note — enter edit mode in the UI ─────────── */
function editNote(noteId) {
  const note = _currentComplaintNotes.find(n => n.id === noteId);
  if (!note) return;

  // Swap the static content div for an editable textarea + Save/Cancel buttons
  const contentEl = document.getElementById('note-content-' + noteId);
  if (!contentEl) return;

  // Build inline editor HTML
  contentEl.innerHTML =
    '<textarea ' +
      'id="note-edit-ta-' + noteId + '" ' +
      'class="inp ta" ' +
      'style="min-height:70px;margin-bottom:6px;font-size:13px;" ' +
    '>' + _escHtml(note.content) + '</textarea>' +
    '<div style="display:flex;gap:6px;justify-content:flex-end;">' +
      '<button class="btn btn-secondary btn-sm" onclick="cancelNoteEdit(' + noteId + ')">Cancel</button>' +
      '<button class="btn btn-primary btn-sm"   id="note-save-btn-' + noteId + '" ' +
              'onclick="saveNoteEdit(' + noteId + ')">Save</button>' +
    '</div>';

  // Focus and place cursor at end
  const ta = document.getElementById('note-edit-ta-' + noteId);
  if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }

  // Hide the edit/delete action buttons while editing
  const actionsEl = document.getElementById('note-actions-' + noteId);
  if (actionsEl) actionsEl.style.display = 'none';
}

/* ─── SAVE note edit — persist to DB ────────────────── */
async function saveNoteEdit(noteId) {
  const ta = document.getElementById('note-edit-ta-' + noteId);
  if (!ta) return;

  const newContent = ta.value.trim();
  if (!newContent) { alert('Note cannot be empty.'); ta.focus(); return; }

  const saveBtn = document.getElementById('note-save-btn-' + noteId);
  if (saveBtn) { saveBtn.textContent = 'Saving…'; saveBtn.disabled = true; }

  try {
    const res    = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'edit_note', id: noteId, content: newContent }),
    });
    const result = await res.json();

    if (result.success) {
      // Update local cache
      const note = _currentComplaintNotes.find(n => n.id === noteId);
      if (note) {
        note.content    = newContent;
        note.updated_at = result.updated_at || new Date().toISOString().slice(0, 19).replace('T', ' ');
      }
      renderCaseNotes(); // full re-render exits edit mode cleanly
    } else {
      throw new Error(result.error || 'Server returned failure');
    }
  } catch (err) {
    console.warn('BICTS: Note edit failed.', err);
    if (saveBtn) { saveBtn.textContent = 'Save'; saveBtn.disabled = false; }
    alert('Could not save the edit. Please try again.');
  }
}

/* ─── CANCEL note edit — restore original text ───────── */
function cancelNoteEdit(noteId) {
  // Simply re-render — restores the static view from _currentComplaintNotes
  renderCaseNotes();
}

/* ─── DELETE note ────────────────────────────────────── */
async function deleteNote(noteId) {
  if (!confirm('Delete this note? This cannot be undone.')) return;

  // Optimistic removal
  const removed = _currentComplaintNotes.find(n => n.id === noteId);
  _currentComplaintNotes = _currentComplaintNotes.filter(n => n.id !== noteId);
  renderCaseNotes();

  try {
    const res = await fetch(API_URL, {
      method:  'DELETE',                          // ← FIX: was POST in old version
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'delete_note', id: noteId }),
    });
    const result = await res.json();

    if (!result.success) throw new Error(result.error || 'Server returned failure');
  } catch (err) {
    console.warn('BICTS: Note delete failed.', err);
    // Roll back: re-insert the removed note and re-render
    if (removed) {
      _currentComplaintNotes.push(removed);
      _currentComplaintNotes.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
    renderCaseNotes();
    alert('Could not delete the note. Please try again.');
  }
}

/* ─── Submit new note (called by Save Note button) ────── */
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

/* ─── Show / hide the new-note form ─────────────────── */
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

/* ─── Render the notes list ─────────────────────────── */
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

  const currentUserId = (window.CURRENT_USER || {}).id;

  el.innerHTML = _currentComplaintNotes.map(function (n) {
    const initial = (n.author || '?').charAt(0).toUpperCase();

    /* Format created date */
    const createdStr = _formatNoteDate(n.created_at);

    /* Show "(edited)" label if updated_at differs meaningfully from created_at */
    const wasEdited = n.updated_at && n.updated_at !== n.created_at &&
                      Math.abs(new Date(n.updated_at) - new Date(n.created_at)) > 2000;
    const editedTag = wasEdited
      ? '<span style="font-size:10px;color:var(--text3);font-style:italic;"> · edited</span>'
      : '';

    /* Show action buttons only for notes that are saved (id !== null).
       Any logged-in user who belongs to this barangay can edit/delete. */
    const canAct = n.id !== null && window.CURRENT_USER;

    return (
      '<div style="padding:12px 0;border-bottom:1px solid var(--border);" id="note-row-' + n.id + '">' +

        /* ── Header row ── */
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +

          /* Left: avatar + author + role */
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="width:28px;height:28px;border-radius:50%;background:var(--sky-light);color:var(--blue);' +
                 'font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">' +
              initial +
            '</div>' +
            '<span style="font-size:12px;font-weight:600;">' + _escHtml(n.author) + '</span>' +
            (n.author_role
              ? '<span class="badge b-gray" style="font-size:9px;">' + _escHtml(n.author_role) + '</span>'
              : '') +
          '</div>' +

          /* Right: timestamp + action buttons */
          '<div style="display:flex;align-items:center;gap:8px;" id="note-actions-' + n.id + '">' +
            '<span style="font-size:10px;color:var(--text3);">' + createdStr + editedTag + '</span>' +
            (canAct
              ? /* Edit button */
                '<button ' +
                  'class="btn btn-ghost btn-sm" ' +
                  'style="padding:2px 7px;font-size:11px;" ' +
                  'onclick="editNote(' + n.id + ')" ' +
                  'title="Edit note">✏️</button>' +
                /* Delete button */
                '<button ' +
                  'style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--text3);padding:2px 4px;" ' +
                  'onclick="deleteNote(' + n.id + ')" ' +
                  'title="Delete note">✕</button>'
              : '') +
          '</div>' +

        '</div>' +

        /* ── Content area (swapped with textarea in edit mode) ── */
        '<div ' +
          'id="note-content-' + n.id + '" ' +
          'style="font-size:13px;color:var(--text2);line-height:1.65;padding-left:36px;white-space:pre-wrap;">' +
          _escHtml(n.content) +
        '</div>' +

      '</div>'
    );
  }).join('');
}

/* ── Tiny XSS-safe HTML escaper used only inside renderCaseNotes ── */
function _escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Format a note timestamp for display ── */
function _formatNoteDate(rawDate) {
  try {
    // MySQL returns "2026-05-23 03:25:00" — replace space with T for Safari compat
    const d = new Date(rawDate.replace(' ', 'T'));
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) +
           ' · ' +
           d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return rawDate || '—';
  }
}


/* ══════════════════════════════════════════════════════
   COMPLAINT DETAIL VIEW
══════════════════════════════════════════════════════ */
async function viewComplaint(id) {
  _currentDetailComplaintId = id;
  const c = complaints.find(x => x.id === id);
  if (!c) return;

  const bcEl = document.getElementById('detail-breadcrumb');
  if (bcEl) bcEl.textContent = id + ' – ' + c.category;

  const ptEl = document.getElementById('detail-page-title');
  if (ptEl) ptEl.textContent = id + ' – ' + c.category;

  const badgeRow = document.getElementById('detail-badge-row');
  if (badgeRow) {
    badgeRow.innerHTML =
      '<span class="badge b-blue">'       + c.category + '</span>' +
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

  const closeBtn = document.getElementById('detail-close-btn');
  if (closeBtn) {
    if (c.status === 'Closed') {
      closeBtn.textContent  = '⊘ Closed';
      closeBtn.style.color  = 'var(--text3)';
      closeBtn.onclick      = null;
      closeBtn.style.display = 'inline-flex';
    } else if (c.status === 'Resolved') {
      closeBtn.style.display = 'none';
    } else {
      closeBtn.textContent   = '⊘ Close Case';
      closeBtn.style.color   = 'var(--text3)';
      closeBtn.style.display  = 'inline-flex';
      closeBtn.onclick = () => openCloseModal(id);
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

  await loadNotes(id);   // ← loads + renders notes

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
   Officer Management (Settings > Officers tab)
══════════════════════════════════════════════════════ */
async function loadOfficers() {
  try {
    const res  = await fetch(API_URL + '?type=officers');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _officers  = data.officers || [];
  } catch (err) {
    console.warn('BICTS: Could not load officers.', err);
    // do not clear _officers on failure
  }
  renderOfficersTable();
  renderOfficerStats();
}
 
/**
 * Render the officers table inside Settings > Officers tab.
 */
function renderOfficersTable() {
  const tbody = document.getElementById('officers-tbody');
  if (!tbody) return;
 
  if (_officers.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center;padding:48px;color:var(--text3);">' +
        '<div style="font-size:28px;margin-bottom:8px;">👮</div>' +
        '<div style="font-weight:600;margin-bottom:4px;">No officers yet</div>' +
        '<div style="font-size:11px;">Click <strong>+ Add Officer</strong> to get started.</div>' +
      '</td></tr>';
    return;
  }
 
  tbody.innerHTML = _officers.map(function (o) {
    const isActive   = o.status === 'Active';
    const badgeCls   = isActive ? 'b-green' : 'b-gray';
    const activeCases = complaints.filter(function (c) {
      return String(c.officer_id) === String(o.id) &&
             c.status !== 'Resolved' &&
             c.status !== 'Closed';
    }).length;
 
    return (
      '<tr>' +
        '<td>' +
          '<div style="font-weight:600;">' + _escHtml(o.name) + '</div>' +
          (activeCases > 0
            ? '<div style="font-size:10px;color:var(--text3);">' + activeCases + ' active case' + (activeCases !== 1 ? 's' : '') + '</div>'
            : '') +
        '</td>' +
        '<td>' + _escHtml(o.rank || '—') + '</td>' +
        '<td>' + _escHtml(o.contact || '—') + '</td>' +
        '<td style="font-size:12px;">' + _escHtml(o.email || '—') + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + _escHtml(o.status) + '</span></td>' +
        '<td>' +
          '<div style="display:flex;gap:6px;">' +
            '<button class="btn btn-ghost btn-sm" onclick="openEditOfficer(' + o.id + ')" style="font-size:11px;">✏️ Edit</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="deleteOfficer(' + o.id + ')" ' +
                    'style="font-size:11px;color:var(--red,#dc2626);">✕ Delete</button>' +
          '</div>' +
        '</td>' +
      '</tr>'
    );
  }).join('');
}
 
/**
 * Update the three stat counters above the officers table.
 */
function renderOfficerStats() {
  const total    = _officers.length;
  const active   = _officers.filter(function (o) { return o.status === 'Active';   }).length;
  const inactive = _officers.filter(function (o) { return o.status === 'Inactive'; }).length;
 
  const totalEl    = document.getElementById('officer-stat-total');
  const activeEl   = document.getElementById('officer-stat-active');
  const inactiveEl = document.getElementById('officer-stat-inactive');
 
  if (totalEl)    totalEl.textContent    = total;
  if (activeEl)   activeEl.textContent   = active;
  if (inactiveEl) inactiveEl.textContent = inactive;
}
 
/**
 * Open the Add Officer modal (blank form).
 */
function openAddOfficer() {
  _editingOfficerId = null;
  const titleEl = document.getElementById('officer-modal-title');
  if (titleEl) titleEl.textContent = 'Add Officer';
 
  _clearOfficerForm();
  showModal('officerModal');
}
 
/**
 * Open the Edit Officer modal (pre-filled with existing data).
 */
function openEditOfficer(id) {
  const o = _officers.find(function (x) { return String(x.id) === String(id); });
  if (!o) return;
 
  _editingOfficerId = id;
  const titleEl = document.getElementById('officer-modal-title');
  if (titleEl) titleEl.textContent = 'Edit Officer';
 
  _setField('om-name',    o.name    || '');
  _setField('om-rank',    o.rank    || '');
  _setField('om-contact', o.contact || '');
  _setField('om-email',   o.email   || '');
  _setField('om-status',  o.status  || 'Active');
 
  const msgEl = document.getElementById('om-msg');
  if (msgEl) msgEl.textContent = '';
 
  showModal('officerModal');
}
 
/**
 * Submit the Add or Edit officer form.
 * Uses action=add_officer or action=edit_officer based on _editingOfficerId.
 */
async function submitOfficer() {
  const name    = (_getField('om-name')    || '').trim();
  const rank    = (_getField('om-rank')    || '').trim();
  const contact = (_getField('om-contact') || '').trim();
  const email   = (_getField('om-email')   || '').trim();
  const status  = _getField('om-status') || 'Active';
  const msgEl   = document.getElementById('om-msg');

  /* Validate */
  if (!name) {
    if (msgEl) { msgEl.textContent = 'Officer name is required.'; msgEl.style.color = 'var(--red,#dc2626)'; }
    document.getElementById('om-name')?.focus();
    return;
  }

  const btn = document.getElementById('om-submit-btn');
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  const isEdit  = _editingOfficerId !== null;
  const payload = {
    action:  isEdit ? 'edit_officer' : 'add_officer',
    name, rank, contact, email, status,
  };
  if (isEdit) payload.id = _editingOfficerId;

  try {
    const res    = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const result = await res.json();

    if (result.success) {
      closeModal('officerModal');

      if (isEdit) {
        const idx = _officers.findIndex(function(x) {
          return String(x.id) === String(_editingOfficerId);
        });
        if (idx !== -1) {
          _officers[idx] = Object.assign(_officers[idx], { name, rank, contact, email, status });
        }
        complaints.forEach(function(c) {
          if (String(c.officer_id) === String(_editingOfficerId)) c.officer = name;
        });
        renderAll();
      } else {
        _officers.push({
          id:          result.id,
          name:        name,
          rank:        rank,
          contact:     contact,
          email:       email,
          status:      status,
          barangay_id: (window.CURRENT_USER || {}).barangay_id || 0,
          created_at:  new Date().toISOString().slice(0, 19).replace('T', ' ')
        });
      }

      renderOfficersTable();
      renderOfficerStats();

      await pushNotif(
        isEdit ? 'Officer updated: ' + name : 'New officer added: ' + name,
        'success'
      );
    } else {
      if (msgEl) { msgEl.textContent = result.error || 'Failed to save officer.'; msgEl.style.color = 'var(--red,#dc2626)'; }
    }
  } catch (err) {
    console.warn('BICTS: Officer save failed.', err);
    if (msgEl) { msgEl.textContent = 'Network error — please try again.'; msgEl.style.color = 'var(--red,#dc2626)'; }
  } finally {
    if (btn) { btn.textContent = 'Save Officer'; btn.disabled = false; }
  }
} 
 
/**
 * Delete an officer after confirmation.
 * The backend also clears officer/officer_id from any affected complaints.
 */
async function deleteOfficer(id) {
  const o = _officers.find(function (x) { return String(x.id) === String(id); });
  if (!o) return;
 
  const activeCases = complaints.filter(function (c) {
    return String(c.officer_id) === String(id) &&
           c.status !== 'Resolved' &&
           c.status !== 'Closed';
  }).length;
 
  const warning = activeCases > 0
    ? '\n\nWarning: this officer has ' + activeCases + ' active case(s) — they will be unassigned.'
    : '';
 
  if (!confirm('Delete officer "' + o.name + '"? This cannot be undone.' + warning)) return;
 
  try {
    const res    = await fetch(API_URL, {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'delete_officer', id }),
    });
    const result = await res.json();
 
    if (result.success) {
      /* Update local cache — clear from complaints too */
      _officers = _officers.filter(function (x) { return String(x.id) !== String(id); });
      complaints.forEach(function (c) {
        if (String(c.officer_id) === String(id)) {
          c.officer    = '—';
          c.officer_id = 0;
        }
      });
      renderOfficersTable();
      renderOfficerStats();
      renderAll();
      await pushNotif('Officer "' + o.name + '" removed.', 'info');
    } else {
      alert(result.error || 'Could not delete officer. Please try again.');
    }
  } catch (err) {
    console.warn('BICTS: Officer delete failed.', err);
    alert('Network error — please try again.');
  }
}
 
 
/* ══════════════════════════════════════════════════════
   ASSIGN OFFICER — dynamic modal
   Endpoint: PUT action=assign_officer
══════════════════════════════════════════════════════ */
 
/**
 * Open the Assign Officer modal for a given complaint.
 * Dynamically populates the <select> with active officers
 * and their current caseload counts.
 *
 * @param {string} complaintId  — e.g. '#001'
 */
async function openAssignModal(complaintId) {
  if (!complaintId) return;
  _assignComplaintId = complaintId;
 
  /* Ensure we have a current officer list */
  if (_officers.length === 0) await loadOfficers();
 
  const select = document.getElementById('assign-officer-select');
  const msgEl  = document.getElementById('assign-msg');
  const ctxEl  = document.getElementById('assign-complaint-ctx');
 
  if (msgEl) msgEl.textContent = '';
 
  /* Show complaint context badges */
  const c = complaints.find(function (x) { return x.id === complaintId; });
  if (ctxEl && c) {
    ctxEl.innerHTML =
      '<span class="badge b-blue">'        + _escHtml(c.category || '—') + '</span>' +
      '<span class="badge b-gray">'        + _escHtml(c.id)              + '</span>' +
      '<span class="badge ' + c.pb + '">'  + _escHtml(c.priority || '—') + ' Priority</span>';
  }
 
  /* Build officer options — only Active officers */
  if (select) {
    const activeOfficers = _officers.filter(function (o) { return o.status === 'Active'; });
 
    /* Count open cases per officer */
    const caseCount = {};
    complaints.forEach(function (comp) {
      if (comp.officer_id && comp.status !== 'Resolved' && comp.status !== 'Closed') {
        caseCount[comp.officer_id] = (caseCount[comp.officer_id] || 0) + 1;
      }
    });
 
    if (activeOfficers.length === 0) {
      select.innerHTML =
        '<option value="">No active officers — add some in Settings → Officers</option>';
    } else {
      select.innerHTML =
        '<option value="">-- Select Officer --</option>' +
        activeOfficers.map(function (o) {
          const n     = caseCount[o.id] || 0;
          const label = _escHtml(o.name) +
                        (o.rank ? ' · ' + _escHtml(o.rank) : '') +
                        '  (' + n + ' active case' + (n !== 1 ? 's' : '') + ')';
          return '<option value="' + o.id + '" data-name="' + _escHtml(o.name) + '">' +
                 label + '</option>';
        }).join('');
    }
 
    /* Pre-select existing assignment if any */
    if (c && c.officer_id) select.value = String(c.officer_id);
  }
 
  /* Clear target date */
  const dateEl = document.getElementById('assign-target-date');
  if (dateEl) dateEl.value = '';
 
  showModal('assignModal');
}
 
/**
 * Submit the officer assignment — saves to DB and updates local cache.
 */
async function submitAssignOfficer() {
  const select  = document.getElementById('assign-officer-select');
  const dateEl  = document.getElementById('assign-target-date');
  const msgEl   = document.getElementById('assign-msg');
  const btn     = document.getElementById('assign-submit-btn');
 
  /* Validate */
  if (!select || !select.value) {
    if (msgEl) {
      msgEl.textContent  = 'Please select an officer.';
      msgEl.style.color  = 'var(--red,#dc2626)';
    }
    return;
  }
 
  if (msgEl) msgEl.textContent = '';
 
  const officerId   = parseInt(select.value, 10);
  const selectedOpt = select.options[select.selectedIndex];
  /* data-name holds the plain name; fall back to splitting the option text */
  const officerName = selectedOpt.getAttribute('data-name') ||
                      (selectedOpt.text.split(' · ')[0].split('(')[0].trim());
 
  if (btn) { btn.textContent = 'Assigning…'; btn.disabled = true; }
 
  try {
    const res    = await fetch(API_URL, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        action:       'assign_officer',
        complaint_id: _assignComplaintId,
        officer_id:   officerId,
        officer_name: officerName,
        target_date:  dateEl ? dateEl.value : '',
      }),
    });
    const result = await res.json();
 
    if (result.success) {
      /* Update local complaints cache */
      const c = complaints.find(function (x) { return x.id === _assignComplaintId; });
      if (c) {
        c.officer    = officerName;
        c.officer_id = officerId;
      }
 
      /* Refresh the detail view if it is open */
      const detailEl = document.getElementById('detail-officer');
      if (detailEl) detailEl.textContent = officerName;
 
      renderAll();
      closeModal('assignModal');
 
      await pushNotif(
        'Officer "' + officerName + '" assigned to complaint ' + _assignComplaintId + '.',
        'success'
      );
    } else {
      if (msgEl) {
        msgEl.textContent = result.error || 'Assignment failed — please try again.';
        msgEl.style.color = 'var(--red,#dc2626)';
      }
    }
  } catch (err) {
    console.warn('BICTS: Officer assignment failed.', err);
    if (msgEl) {
      msgEl.textContent = 'Network error — please try again.';
      msgEl.style.color = 'var(--red,#dc2626)';
    }
  } finally {
    if (btn) { btn.textContent = 'Assign Officer'; btn.disabled = false; }
  }
}
 
 
/* ══════════════════════════════════════════════════════
   SETTINGS TAB SWITCHER
   Handles show/hide of the Officers panel vs the main
   settings panel. Compatible with the existing initTabs()
   active-class toggle.
══════════════════════════════════════════════════════ */
 
/**
 * Switch between settings panels.
 * @param {string} tabName  — 'general' | 'categories' | 'ai' | 'audit' | 'officers'
 * @param {Element|null} el — the clicked tab element (null when called programmatically)
 */
function switchSettingsTab(tabName, el) {
  /* Update active class on tabs */
  const tabsContainer = document.getElementById('settings-tabs');
  if (tabsContainer) {
    tabsContainer.querySelectorAll('.tab').forEach(function (t) {
      t.classList.remove('active');
    });
    if (el) {
      el.classList.add('active');
    } else {
      /* Programmatic call — find tab by text */
      Array.from(tabsContainer.querySelectorAll('.tab')).forEach(function (t) {
        if (t.textContent.toLowerCase().includes(tabName)) t.classList.add('active');
      });
    }
  }
 
  const officerPanel = document.getElementById('settings-panel-officers');
  const mainPanel    = document.getElementById('settings-main-panel');
 
  if (tabName === 'officers') {
    if (officerPanel) officerPanel.style.display = '';
    if (mainPanel)    mainPanel.style.display    = 'none';
    if (_officers.length > 0) {
      renderOfficersTable();
      renderOfficerStats();
    } else {
      loadOfficers();
    }
  } else {
    if (officerPanel) officerPanel.style.display = 'none';
    if (mainPanel)    mainPanel.style.display    = '';
  }
}
 
 
/* ══════════════════════════════════════════════════════
   PRIVATE HELPERS  (officer form utilities)
══════════════════════════════════════════════════════ */
 
function _clearOfficerForm() {
  ['om-name', 'om-rank', 'om-contact', 'om-email'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  _setField('om-status', 'Active');
  const msgEl = document.getElementById('om-msg');
  if (msgEl) msgEl.textContent = '';
}
 
function _getField(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}
 
function _setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
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