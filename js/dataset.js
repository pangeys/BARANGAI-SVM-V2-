/* ═══════════════════════════════════════════════════════
   BICTS — js/dataset.js
   Loads and displays the v2 (200/cat) augmented training
   dataset used to train the SVM classifier.

   Expected file:  data/barangay_dataset_v2_200.csv
   Expected cols:  Complaint_Summary, Category, Is_Augmented

   Generate this file by running the export cell in your
   Colab notebook (SVM_v2), then place the CSV in data/.
═══════════════════════════════════════════════════════ */

const DATASET_FILE = 'data/barangay_dataset_v2_200.csv';

let datasetRows = [];

/* ── CSV Parser ── */
function parseCSV(text) {
  const lines  = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

  const findCol = (...names) => {
    for (const n of names) {
      const idx = header.findIndex(h => h.toLowerCase() === n.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const summaryIdx   = findCol('Complaint_Summary','complaint_summary','clean_text','summary','text');
  const categoryIdx  = findCol('Category','category','label','class');
  const augmentedIdx = findCol('Is_Augmented','is_augmented','augmented');

  if (summaryIdx === -1 || categoryIdx === -1) {
    console.error('BICTS: CSV missing required columns (Complaint_Summary, Category)');
    return [];
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols     = splitCSVLine(lines[i]);
    if (cols.length < 2) continue;
    const summary  = (cols[summaryIdx]  || '').replace(/^"|"$/g,'').trim();
    const category = (cols[categoryIdx] || '').replace(/^"|"$/g,'').trim();
    if (!summary || !category) continue;
    let isAug = false;
    if (augmentedIdx !== -1) {
      const val = (cols[augmentedIdx] || '').replace(/^"|"$/g,'').trim().toLowerCase();
      isAug = val === 'true';
    }
    rows.push({ summary, category, isAug, row: i });
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

/* Recalculate Fuzzy AHP frequency scores from v2 sample counts */
function recomputeFrequencies(rows) {
  const counts = {};
  CATEGORIES.forEach(c => { counts[c] = 0; });
  rows.forEach(r => {
    const m = mapToMergedCategory(r.category);
    if (m) counts[m]++;
  });
  const maxCount = Math.max(...Object.values(counts), 1);
  Object.keys(CAT_AHP).forEach(cat => {
    CAT_AHP[cat].frequency = Math.max(Math.round((counts[cat] / maxCount) * 9), 1);
  });
}

function mapToMergedCategory(raw) {
  const MAP = {
    'Threat / Public Order':'Threat & Violence','Physical Assault':'Threat & Violence',
    'Domestic / Family Concern':'Threat & Violence','Public Order / Mediation':'Threat & Violence',
    'Threat & Violence':'Threat & Violence',
    'Financial Dispute':'Financial & Fraud','Fraud / Financial Dispute':'Financial & Fraud',
    'Financial & Fraud':'Financial & Fraud',
    'Theft / Robbery':'Theft & Property','Property Dispute':'Theft & Property',
    'Theft & Property':'Theft & Property',
    'Defamation / Cyberbullying':'Defamation & Cyberbullying',
    'Defamation & Cyberbullying':'Defamation & Cyberbullying',
    'Lost Items / Missing Person':'Lost Items & Missing Person',
    'Lost Items & Missing Person':'Lost Items & Missing Person',
    'Accident / Traffic':'Accident & Traffic','Accident & Traffic':'Accident & Traffic',
    'Environmental / Infrastructure':'Environmental & Infrastructure',
    'Environmental & Infrastructure':'Environmental & Infrastructure',
  };
  return MAP[raw.trim()] || null;
}

/* ── Auto-load v2 training dataset on boot ── */
function initDatasetUpload() {
  fetch(DATASET_FILE)
    .then(res => { if (!res.ok) throw new Error('not found'); return res.text(); })
    .then(text => {
      const rows = parseCSV(text);
      if (rows.length === 0) return;
      datasetRows = rows;
      recomputeFrequencies(rows);
      renderDatasetStats();
      renderDatasetTable();
      renderDashboardDonut();
      showDatasetSection();
    })
    .catch(() => {
      const el = document.getElementById('dataset-empty');
      if (el) el.innerHTML =
        '<div class="alert alert-warn" style="margin:0;">' +
        '⚠️ Training dataset not found. Run the export cell in your Colab notebook and place ' +
        '<code style="font-family:monospace;background:var(--bg2);padding:1px 5px;border-radius:3px;">barangay_dataset_v2_200.csv</code>' +
        ' inside the <code style="font-family:monospace;background:var(--bg2);padding:1px 5px;border-radius:3px;">data/</code> folder.' +
        '</div>';
    });
}

function showDatasetSection() {
  const empty = document.getElementById('dataset-empty');
  const table = document.getElementById('dataset-table-wrap');
  if (empty) empty.style.display = 'none';
  if (table) table.style.display = 'block';
}

/* Stats bar: total · real · augmented · per-category */
function renderDatasetStats() {
  const el = document.getElementById('dataset-stats');
  if (!el || datasetRows.length === 0) return;

  const total = datasetRows.length;
  const real  = datasetRows.filter(r => !r.isAug).length;
  const aug   = datasetRows.filter(r =>  r.isAug).length;

  const counts = {};
  CATEGORIES.forEach(c => { counts[c] = 0; });
  datasetRows.forEach(r => { const m = mapToMergedCategory(r.category); if (m) counts[m]++; });

  el.innerHTML =
    '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">' +
    '<span style="font-size:12px;font-weight:600;color:var(--text)">v2 training set: ' +
    '<span style="color:var(--blue)">' + total + ' samples</span></span>' +
    '<span class="badge b-green">Real: ' + real + '</span>' +
    '<span class="badge b-gray">Augmented: ' + aug + '</span>' +
    '</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">' +
    CATEGORIES.map(cat =>
      '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);">' +
      '<span style="width:8px;height:8px;border-radius:2px;background:' + CAT_COLORS[cat] + ';flex-shrink:0;"></span>' +
      cat.split(' & ')[0] + ': <strong>' + counts[cat] + '</strong></span>'
    ).join('') + '</div>';
}

/* Filter state */
let _dsSearch    = '';
let _dsCatFilter = '';
let _dsAugFilter = '';
let _dsPage      = 1;
const DS_PAGE_SIZE = 15;

function filterDatasetTable() {
  _dsSearch    = (document.getElementById('ds-search')?.value    || '').toLowerCase();
  _dsCatFilter = (document.getElementById('ds-cat-filter')?.value || '');
  _dsAugFilter = (document.getElementById('ds-aug-filter')?.value || '');
  _dsPage = 1;
  renderDatasetTable();
}

function getFilteredRows() {
  return datasetRows.filter(r => {
    const m = mapToMergedCategory(r.category) || r.category;
    if (_dsCatFilter && m !== _dsCatFilter) return false;
    if (_dsAugFilter === 'real' &&  r.isAug) return false;
    if (_dsAugFilter === 'aug'  && !r.isAug) return false;
    if (_dsSearch && !r.summary.toLowerCase().includes(_dsSearch)) return false;
    return true;
  });
}

function renderDatasetTable() {
  const tbody    = document.getElementById('dataset-tbody');
  const pageInfo = document.getElementById('ds-page-info');
  const prevBtn  = document.getElementById('ds-prev');
  const nextBtn  = document.getElementById('ds-next');
  if (!tbody) return;

  const filtered   = getFilteredRows();
  const total      = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / DS_PAGE_SIZE));
  _dsPage          = Math.min(_dsPage, totalPages);
  const pageRows   = filtered.slice((_dsPage - 1) * DS_PAGE_SIZE, _dsPage * DS_PAGE_SIZE);

  if (pageRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text3);font-size:12px;">No records match the current filter.</td></tr>';
  } else {
    tbody.innerHTML = pageRows.map(r => {
      const merged   = mapToMergedCategory(r.category) || r.category;
      const color    = CAT_COLORS[merged] || '#8A9BB0';
      const augBadge = r.isAug
        ? '<span class="badge b-gray"  style="font-size:9px;">aug</span>'
        : '<span class="badge b-green" style="font-size:9px;">real</span>';
      return '<tr>' +
        '<td style="font-family:var(--mono);color:var(--text3);font-size:10px">' + r.row + '</td>' +
        '<td style="font-size:12px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(r.summary) + '</td>' +
        '<td><span class="badge" style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44">' + escHtml(merged) + '</span></td>' +
        '<td>' + augBadge + '</td>' +
        '</tr>';
    }).join('');
  }

  if (pageInfo) pageInfo.textContent = 'Page ' + _dsPage + ' of ' + totalPages + ' · ' + total + ' records';
  if (prevBtn)  prevBtn.disabled = _dsPage <= 1;
  if (nextBtn)  nextBtn.disabled = _dsPage >= totalPages;
}

function dsPagePrev() { if (_dsPage > 1) { _dsPage--; renderDatasetTable(); } }
function dsPageNext() {
  if (_dsPage < Math.ceil(getFilteredRows().length / DS_PAGE_SIZE)) { _dsPage++; renderDatasetTable(); }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}