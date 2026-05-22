/* ═══════════════════════════════════════════════════════
   BICTS — js/classifier.js
   Real SVM classifier using exported TF-IDF + LinearSVC
   weights from the Python notebook (SVM_v2, 200/cat).

   Model file: data/svm_model.json
   Contains:
     classes    — 7 category names in label-encoder order
     vocabulary — word/bigram → feature index (1,990 features)
     idf        — IDF weights per feature
     coef       — SVM decision weights [7 × 1990]
     intercept  — SVM intercepts [7]

   Pipeline mirrors the Python preprocessing exactly:
     lowercase → strip punctuation → remove stop words
     → min length >2 → TF-IDF (1,2)-gram → LinearSVC
═══════════════════════════════════════════════════════ */

/* ── Model state ── */
let _model    = null;   /* loaded from svm_model.json */
let _modelErr = false;  /* true if load failed */

/* ── Load model on boot ── */
function initClassifier() {
  return fetch('data/svm_model.json')
    .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
    .then(data => {
      _model = data;
      console.log('BICTS: SVM model loaded —', data.classes);
    })
    .catch(err => {
      _modelErr = true;
      console.warn('BICTS: Could not load svm_model.json, using keyword fallback.', err);
    });
}

/* ══════════════════════════════════════════════════════
   PREPROCESSING — must exactly match Python notebook:
   lowercase → remove non-alphanum → collapse spaces
   → remove stop words → remove tokens len ≤ 2
══════════════════════════════════════════════════════ */
const STOP_WORDS = new Set([
  'ang','ng','sa','na','at','ay','si','ni','mga','ito',
  'ko','mo','niya','kami','kayo','sila','ako','ikaw','siya',
  'namin','natin','nila','aming','inyong','kanilang',
  'the','a','an','is','was','are','were','in','on',
  'to','of','and','for','with','by','from','that','this',
  'it','he','she','they','we','you','i','be','been','have',
  'has','had','do','did','will','would','could','should',
  'may','might','can','not','no','so','but','or','if',
]);

function preprocess(text) {
  let t = String(text).toLowerCase();
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.split(' ')
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .join(' ');
}

/* ══════════════════════════════════════════════════════
   TF-IDF (1,2)-gram vectoriser
   Produces a sparse vector matching the trained vocab.
══════════════════════════════════════════════════════ */
function tfidfVectorize(text) {
  const vocab = _model.vocabulary;
  const idf   = _model.idf;
  const n     = idf.length;

  /* Count term frequencies for unigrams and bigrams */
  const tf = new Float64Array(n);
  const words = text.split(' ').filter(w => w.length > 0);

  for (let i = 0; i < words.length; i++) {
    /* unigram */
    const w1 = words[i];
    if (vocab[w1] !== undefined) tf[vocab[w1]]++;

    /* bigram */
    if (i + 1 < words.length) {
      const bg = w1 + ' ' + words[i + 1];
      if (vocab[bg] !== undefined) tf[vocab[bg]]++;
    }
  }

  /* Apply sublinear TF scaling: tf = 1 + log(tf) if tf > 0 */
  for (let i = 0; i < n; i++) {
    if (tf[i] > 0) tf[i] = 1 + Math.log(tf[i]);
  }

  /* Multiply by IDF */
  for (let i = 0; i < n; i++) {
    tf[i] *= idf[i];
  }

  /* L2 normalise */
  let norm = 0;
  for (let i = 0; i < n; i++) norm += tf[i] * tf[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < n; i++) tf[i] /= norm;

  return tf;
}

/* ══════════════════════════════════════════════════════
   LINEAR SVC DECISION
   decision[k] = coef[k] · vec + intercept[k]
   Predicted class = argmax(decision)
══════════════════════════════════════════════════════ */
function svmDecide(vec) {
  const coef      = _model.coef;
  const intercept = _model.intercept;
  const nClasses  = _model.classes.length;
  const nFeatures = vec.length;

  const scores = new Float64Array(nClasses);
  for (let k = 0; k < nClasses; k++) {
    let dot = intercept[k];
    const ck = coef[k];
    for (let i = 0; i < nFeatures; i++) {
      if (vec[i] !== 0) dot += ck[i] * vec[i];
    }
    scores[k] = dot;
  }
  return scores;
}

/* Convert raw SVM scores to pseudo-probabilities via softmax */
function softmax(scores) {
  const max = Math.max(...scores);
  const exp = Array.from(scores).map(s => Math.exp(s - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map(e => e / sum);
}

/* ══════════════════════════════════════════════════════
   PUBLIC: classifyDescription(text)
   Returns { cat, conf, scores }
     cat    — predicted category string
     conf   — confidence % (0–99)
     scores — { category: pct } for all 7 classes
══════════════════════════════════════════════════════ */
function classifyDescription(desc) {
  /* Fall back to keyword rules if model not loaded */
  if (!_model) return classifyKeywords(desc);

  const clean  = preprocess(desc);
  const vec    = tfidfVectorize(clean);
  const raw    = svmDecide(vec);
  const probs  = softmax(raw);

  /* Find best class */
  let bestIdx = 0;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[bestIdx]) bestIdx = i;
  }

  const cat  = _model.classes[bestIdx];
  const conf = Math.min(Math.round(probs[bestIdx] * 100), 99);

  /* Build scores map for confidence bars */
  const scores = {};
  _model.classes.forEach((c, i) => {
    scores[c] = Math.round(probs[i] * 100);
  });

  return { cat, conf, scores };
}

/* ══════════════════════════════════════════════════════
   KEYWORD FALLBACK (used only if model fails to load)
   Kept in data.js as CLASSIFY_RULES
══════════════════════════════════════════════════════ */
function classifyKeywords(desc) {
  const lower    = desc.toLowerCase();
  let bestCat    = CATEGORIES[0];
  let bestConf   = 55;
  let bestHits   = 0;
  const rawHits  = {};

  for (const rule of CLASSIFY_RULES) {
    const hits = rule.words.filter(w => lower.includes(w)).length;
    rawHits[rule.cat] = hits;
    if (hits > bestHits) {
      bestHits = hits;
      bestCat  = rule.cat;
      bestConf = Math.min(rule.conf + Math.min(hits * 2, 6), 99);
    }
  }

  const total  = Object.values(rawHits).reduce((a, b) => a + b, 0) || 1;
  const scores = {};
  for (const cat of CATEGORIES) {
    scores[cat] = cat === bestCat
      ? bestConf
      : Math.max(Math.round((rawHits[cat] / total) * (bestConf - 10)), 3);
  }
  return { cat: bestCat, conf: bestConf, scores };
}

/* ══════════════════════════════════════════════════════
   FUZZY AHP PRIORITY SCORING
   Weights: Severity(35%) Urgency(30%) Frequency(20%) Affected(15%)
   Overrides:
     Fatality keywords    → Critical (score ≥ 90)
     Missing person/child → High    (score ≥ 70)
══════════════════════════════════════════════════════ */
function computeAHPScore(category, affected, description) {
  const affNum   = Math.max(parseInt(affected) || 1, 1);
  const affScore = Math.min(Math.ceil(affNum / 2), 9);

  const desc           = (description || '').toLowerCase();
  const isFatality     = FATALITY_KEYWORDS.some(w => desc.includes(w));
  const isMissingMinor = !isFatality && MISSING_PERSON_KEYWORDS.some(w => desc.includes(w));
  const isHazard       = !isFatality && !isMissingMinor && HAZARD_KEYWORDS.some(w => desc.includes(w));
  const isThreat       = !isFatality && !isMissingMinor && THREAT_IN_COMPLAINT_KEYWORDS.some(w => desc.includes(w));

  const defaults = CAT_AHP[category] || { severity: 5, urgency: 5, frequency: 4 };

  const sev = isFatality || isMissingMinor ? 9 : defaults.severity;
  const urg = isFatality || isMissingMinor ? 9
            : isHazard   || isThreat       ? Math.max(defaults.urgency, 7)
            : defaults.urgency;
  const freq = defaults.frequency;
  const aff  = affScore;

  const raw = (sev  * AHP_WEIGHTS.severity)
            + (urg  * AHP_WEIGHTS.urgency)
            + (freq * AHP_WEIGHTS.frequency)
            + (aff  * AHP_WEIGHTS.affected);

  const baseScore = Math.round((raw / 9) * 100);
  const score = isFatality || isMissingMinor ? Math.max(baseScore, 90)
              : isHazard   || isThreat       ? Math.max(baseScore, 70)
              : baseScore;

  return { score, sev, urg, freq, aff, isFatality, isMissingMinor, isHazard };
}

function priorityLabel(score) {
  if (score >= 85) return { label: 'Critical', badge: 'b-red'   };
  if (score >= 70) return { label: 'High',     badge: 'b-amber' };
  if (score >= 45) return { label: 'Medium',   badge: 'b-blue'  };
  return               { label: 'Low',      badge: 'b-green' };
}

function statusBadge(status) {
  if (status === 'Resolved')    return 'b-green';
  if (status === 'In Progress') return 'b-blue';
  if (status === 'For Hearing') return 'b-amber';
  return 'b-gray';
}