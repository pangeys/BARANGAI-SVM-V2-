/* ═══════════════════════════════════════════════════════
   BICTS — js/data.js
   All static configuration & experiment result data.
   Edit this file to update model numbers, categories,
   AHP weights, or NLP pipeline steps.
═══════════════════════════════════════════════════════ */

/* ── 7 Validated complaint categories (merged from 12) ── */
const CATEGORIES = [
  'Threat & Violence',
  'Financial & Fraud',
  'Theft & Property',
  'Defamation & Cyberbullying',
  'Lost Items & Missing Person',
  'Accident & Traffic',
  'Environmental & Infrastructure',
];

/* ── Category colours (donut chart + kanban borders) ── */
const CAT_COLORS = {
  'Threat & Violence':              '#A02020',
  'Financial & Fraud':              '#B06000',
  'Theft & Property':               '#1E5FA8',
  'Defamation & Cyberbullying':     '#6B3FA0',
  'Lost Items & Missing Person':    '#1B7A4A',
  'Accident & Traffic':             '#4CA3DD',
  'Environmental & Infrastructure': '#5A7A4A',
};

/* ── Fuzzy AHP weights (Chapter 1 Objective 4) ── */
const AHP_WEIGHTS = {
  severity:  0.35,
  urgency:   0.30,
  frequency: 0.20,
  affected:  0.15,
};

/* ── AHP default criterion scores per category (1–9 scale) ──
   Severity/Urgency sourced from domain knowledge.
   Frequency sourced from real dataset sample counts.        ── */
const CAT_AHP = {
  'Threat & Violence':              { severity: 9, urgency: 9, frequency: 8 },
  'Financial & Fraud':              { severity: 7, urgency: 6, frequency: 7 },
  /* Lowered so single-item theft scores Low, multi-victim or violent theft scores Medium */
  'Theft & Property':               { severity: 4, urgency: 3, frequency: 6 },
  'Defamation & Cyberbullying':     { severity: 5, urgency: 4, frequency: 4 },
  'Lost Items & Missing Person':    { severity: 4, urgency: 5, frequency: 3 },
  /* Lowered from 9/9 — injuries push to High via HAZARD_KEYWORDS override */
  'Accident & Traffic':             { severity: 7, urgency: 7, frequency: 2 },
  /* Raised slightly — infrastructure hazards often affect whole streets */
  'Environmental & Infrastructure': { severity: 6, urgency: 6, frequency: 2 },
};

/* ── Death/fatality keywords → Critical override ── */
const FATALITY_KEYWORDS = [
  'patay','namatay','napatay','bangkay','pumanaw',
  'dead','death','died','killed','fatality',
  'murder','pinatay','binaril','sinaksak','nilason',
];

/* ── Missing/runaway minor keywords → Critical override (score ≥ 90) ── */
const MISSING_PERSON_KEYWORDS = [
  'nawala ang aking anak','missing child','missing person',
  'menor de edad','anak ko','batang','hindi na bumalik',
  'tumakas','wala na','di na nagbabalik','hinahanap',
  'child','minor','kid','son','daughter',
  'taong gulang','taon gulang',
];

/* ── Injury/hazard keywords → High floor ── */
const HAZARD_KEYWORDS = [
  'nasugatan','nahulog','nasaktan','napilayan','naaksidente',
  'nasunog','sunog','apoy','injured','hurt','fell','fire',
  'delikado','mapanganib','dangerous','hazard',
];

/* ── Threat words in non-violence complaints (e.g. landlord threats) → High floor ── */
const THREAT_IN_COMPLAINT_KEYWORDS = [
  'nagbanta','banta','pananakot','threatened','threat',
  'papalayasin','palayasin','tatanggalin','ipapakulong',
];

/* ── Keyword rules for client-side SVM-style classification ──
   Mirrors CAT_KEYWORDS + SYNONYMS from the Python notebook.  ── */
const CLASSIFY_RULES = [
  {
    cat: 'Threat & Violence', conf: 91,
    words: [
      'banta','nagbanta','pananakot','sinuntok','binugbog','tinampal','hinampas',
      'itak','kutsilyo','gulok','samurai','sinakal','nanakit','alitan','away',
      'gulo','nagwala','hinipuan','sumabog','sinalakay','inatake',
      'threat','violence','physical','assault','fight','attacked','stabbed',
      'hit','punch','slap','weapon','hurt','harm','domestic','abuse',
    ],
  },
  {
    cat: 'Financial & Fraud', conf: 89,
    words: [
      'utang','bayad','kasunduan','sangla','hiniram','nagbenta','pera','bayaran',
      'kontrata','usapan','prenda','hindi nagbabayad','ayaw magbayad','tumakas',
      'fraud','money','debt','loan','payment','contract','scam','swindled',
      'cheated','overcharge','refund','unpaid','pautang','kwarta','salapi',
    ],
  },
  {
    cat: 'Theft & Property', conf: 90,
    words: [
      'ninakaw','kinuha','tinangay','bakod','lupa','bahay',
      'pagnanakaw','sinira','winasak','dinukot','inagaw','naglaho','pader',
      'rehas','property','theft','stolen','robbery','snatch','burglary',
      'land','fence','boundary','squatter','encroach','trespass',
      'ninakaw ang','kinuha ang','tangay',
    ],
  },
  {
    cat: 'Defamation & Cyberbullying', conf: 88,
    words: [
      'nagpost','social media','facebook','messenger','pambubully','minura',
      'dinuro','paninirang puri','panlalait','ininsulto','pinagmurahan',
      'impormasyon','tsismis','video','litrato','defamation','cyberbullying',
      'bully','harassment','post','online','slander','libel','insult',
      'tweet','group chat','screenshot','viral','maling impormasyon',
    ],
  },
  {
    cat: 'Lost Items & Missing Person', conf: 85,
    words: [
      'wallet','pitaka','cellphone','nalaglag','nawawalang','missing','anak',
      'naiwanan','nakalimutan','nahulog','wala','di makita',
      'nawala ang aking anak','missing person','bata','bata namin',
      'hindi na bumalik','wala na','di na nagbabalik','hinahanap',
      'lost','misplaced','left behind','cannot find','missing child',
      'nawala ang','nawala si','nawala siya',
    ],
  },
  {
    cat: 'Accident & Traffic', conf: 91,
    words: [
      'aksidente','nasagi','napilayan','gasgas','banggaan','nabanggaan',
      'naaksidente','nabangga','nasaktan','sidecar','nagkaaksidente',
      'patay','namatay','napatay','bangkay','pumanaw',
      'dead','death','died','killed','fatality','victim',
      'accident','traffic','collision','crash','hit and run','vehicle',
      'motor','motorcycle','tricycle','car','truck','road','kalsada',
    ],
  },
  {
    cat: 'Environmental & Infrastructure', conf: 83,
    words: [
      'kuryente','poste','tubig','basura','puno','nabasag','jumper','meralco',
      'gripo','ilaw','linya','kalat','tapunan','basurahan','sanga',
      'garbage','trash','flood','flooding','canal','electricity','water',
      'power','outage','illegal connection','pollution','dumi','fumes','smoke',
    ],
  },
];

/* ── Experiment results (from SVM_v2 notebook) ──
   Update these if you re-run the experiment.              ── */

/* Dashboard accuracy bars */
const MODEL_ACCURACY_BARS = [
  { label: 'SVM (v2 — best)',  value: 95.45 },
  { label: 'BiLSTM (v3)',      value: 90.91 },
  { label: 'Naive Bayes (v1)', value: 86.36 },
];

/* Dataset version table (v1–v5) */
const DATASET_VERSIONS = [
  { ver: 'v1 (100/cat)', train: 700,  nb: 86.13, svm: 90.84, bi: 5.59  },
  { ver: 'v2 (200/cat)', train: 1400, nb: 76.36, svm: 95.30, bi: 80.91, best: true },
  { ver: 'v3 (300/cat)', train: 2037, nb: 81.78, svm: 90.84, bi: 90.84 },
  { ver: 'v4 (400/cat)', train: 2591, nb: 81.78, svm: 90.84, bi: 86.56 },
  { ver: 'v5 (500/cat)', train: 3090, nb: 81.78, svm: 90.84, bi: 77.06 },
];

/* Model comparison at v2 (best configuration) */
const MODEL_COMPARISON_V2 = [
  { metric: 'Accuracy',   nb: '77.27%', svm: '95.45%', bi: '81.82%' },
  { metric: 'Precision',  nb: '78.03%', svm: '96.10%', bi: '86.36%' },
  { metric: 'Recall',     nb: '77.27%', svm: '95.45%', bi: '81.82%' },
  { metric: 'F1-Score',   nb: '76.36%', svm: '95.30%', bi: '80.91%' },
  { metric: 'Train Time', nb: '0.003s', svm: '0.013s', bi: '197.28s' },
  { metric: 'Infer Time', nb: '~0s',    svm: '0.0002s',bi: '~0.01s'  },
];

/* Per-category classification report — SVM v2 (from Step 13 in notebook) */
const PER_CATEGORY_REPORT = [
  { cat: 'Accident & Traffic',             prec: '1.0000', rec: '1.0000', f1: '1.0000', sup: 2 },
  { cat: 'Defamation & Cyberbullying',     prec: '1.0000', rec: '1.0000', f1: '1.0000', sup: 2 },
  { cat: 'Environmental & Infrastructure', prec: '1.0000', rec: '1.0000', f1: '1.0000', sup: 2 },
  { cat: 'Financial & Fraud',              prec: '1.0000', rec: '1.0000', f1: '1.0000', sup: 4 },
  { cat: 'Lost Items & Missing Person',    prec: '1.0000', rec: '1.0000', f1: '1.0000', sup: 2 },
  { cat: 'Theft & Property',               prec: '1.0000', rec: '0.7500', f1: '0.8571', sup: 4 },
  { cat: 'Threat & Violence',              prec: '0.8571', rec: '1.0000', f1: '0.9231', sup: 6 },
];

/* NLP preprocessing pipeline steps */
const NLP_PIPELINE_STEPS = [
  'Raw free-text complaint (Filipino/Taglish)',
  'Lowercase + regex clean',
  'Stop-word removal (Filipino + English)',
  'Min length filter (>2 chars)',
  'TF-IDF (1,2)-gram · sublinear_tf',
  'LinearSVC (C=1.0) — best model',
  'Predicted Category + Confidence',
];

/* Augmentation techniques */
const AUG_TECHNIQUES = [
  { label: 'Domain Synonym Swap',      detail: '80+ Filipino entries' },
  { label: 'Sentence Template Filling',detail: '70 patterns × 7 categories' },
  { label: 'Keyword Injection',        detail: 'category-relevant terms' },
  { label: 'Phrase Recombination',     detail: 'same-class fragment blending' },
  { label: 'Word Deletion',            detail: 'p=0.15 random removal' },
];

/* Category merge table (12 → 7) */
const CATEGORY_MERGE_TABLE = [
  { merged: 'Threat & Violence',              original: 'Threat/Public Order + Physical Assault + Domestic/Family Concern + Public Order/Mediation', min: 6, total: 32 },
  { merged: 'Financial & Fraud',              original: 'Financial Dispute + Fraud/Financial Dispute',                                                 min: 8, total: 21 },
  { merged: 'Theft & Property',               original: 'Theft/Robbery + Property Dispute',                                                            min: 7, total: 18 },
  { merged: 'Defamation & Cyberbullying',     original: 'Defamation/Cyberbullying (unchanged)',                                                         min: 4, total: 11 },
  { merged: 'Lost Items & Missing Person',    original: 'Lost Items/Missing Person (unchanged)',                                                        min: 3, total: 9  },
  { merged: 'Accident & Traffic',             original: 'Accident/Traffic (unchanged)',                                                                 min: 2, total: 6  },
  { merged: 'Environmental & Infrastructure', original: 'Environmental/Infrastructure (unchanged)',                                                     min: 2, total: 6  },
];

/* Report cards */
const REPORT_ITEMS = [
  { icon: '📊', title: 'Classification Accuracy Report', desc: 'Model performance metrics per category'      },
  { icon: '📈', title: 'Complaint Volume Report',        desc: 'Complaints filed over time by category'     },
  { icon: '⏱️', title: 'Response Time Report',           desc: 'Avg handling and resolution times'          },
  { icon: '📋', title: 'Case Outcome Report',            desc: 'Breakdown of resolutions and escalations'   },
];

/* Settings fields */
const SETTINGS_FIELDS = [
  { label: 'System Name',    value: 'BICTS – Barangay Intelligent Case Tracking System' },
  { label: 'Barangay Name',  value: '' },
  { label: 'Municipality',   value: '' },
  { label: 'Admin Email',    value: '' },
];

/* Settings toggles */
const SETTINGS_TOGGLES = [
  { name: 'Auto-classify on submission (SVM)',  desc: 'Use SVM (TF-IDF bigrams) to auto-classify when submitted',     on: true  },
  { name: 'Allow anonymous complaint filing',   desc: 'Residents can submit without personal information',             on: true  },
  { name: 'Confidence threshold flag (<70%)',   desc: 'Flag complaints below 70% confidence for manual review',        on: true  },
  { name: 'Human-in-the-loop validation',       desc: 'Officers must validate AI classification before finalizing',    on: false },
  { name: 'BiLSTM fallback classification',     desc: 'Use BiLSTM if SVM confidence is below threshold',              on: false },
];

/* Status flow for case tracking */
const STATUS_FLOW = ['Open', 'In Progress', 'For Hearing', 'Resolved'];