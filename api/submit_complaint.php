<?php
// api/submit_complaint.php
// Called by resident.html when a resident submits a complaint.
// Inserts into the existing `complaints` table in bicts_db.
session_start();
require_once 'config.php';   // getDB() + sets Content-Type: application/json

function out($ok, $data = [], $code = 200) {
    http_response_code($code);
    echo json_encode(['ok' => $ok] + $data);
    exit;
}

// ── guards ────────────────────────────────────────────────────────
if (empty($_SESSION['user']))
    out(false, ['error' => 'Not logged in. Please sign in again.'], 401);

$user = $_SESSION['user'];

if ($user['role'] !== 'resident')
    out(false, ['error' => 'Only residents can use this endpoint.'], 403);

if (!$user['barangay_id'])
    out(false, ['error' => 'Your account has no barangay assigned. Contact admin.'], 400);

// ── read form data ────────────────────────────────────────────────
$input = json_decode(file_get_contents('php://input'), true) ?? [];

$incident_date = $input['incident_date'] ?? '';
$incident_time = $input['incident_time'] ?: null;
$location      = trim($input['location']      ?? '');
$description   = trim($input['description']   ?? '');
$complainant   = trim($input['complainant']   ?? '') ?: 'Anonymous';
$affected      = isset($input['affected']) && $input['affected'] !== ''
                    ? (int)$input['affected'] : 1;

if (!$incident_date || !$location || !$description)
    out(false, ['error' => 'Date, location, and description are required.'], 422);

// ── generate complaint ID  (format: RES-2026-00001) ───────────────
$db   = getDB();
$year = date('Y');
$countResult = $db->query("SELECT COUNT(*) AS cnt FROM complaints WHERE submitted_by IS NOT NULL AND YEAR(created_at) = $year");
$count       = (int)$countResult->fetch_assoc()['cnt'];
$complaint_id = 'RES-' . $year . '-' . str_pad($count + 1, 5, '0', STR_PAD_LEFT);
$date_filed   = date('Y-m-d');

// ── insert into existing complaints table ─────────────────────────
// Columns: complaint_id, date_filed, description, location,
//          incident_date, incident_time, complainant, affected,
//          category, confidence, score, priority, priority_badge,
//          officer, status, status_badge, barangay_id, submitted_by
$stmt = $db->prepare('
    INSERT INTO complaints
        (complaint_id, date_filed, description, location,
         incident_date, incident_time, complainant, affected,
         category, confidence, score, priority, priority_badge,
         officer, status, status_badge, barangay_id, submitted_by)
    VALUES
        (?, ?, ?, ?,
         ?, ?, ?, ?,
         "", 0, "", "Low", "b-gray",
         "—", "Open", "b-gray", ?, ?)
');

// type string:
// s  complaint_id
// s  date_filed
// s  description
// s  location
// s  incident_date
// s  incident_time
// s  complainant
// i  affected
// i  barangay_id
// i  submitted_by
$stmt->bind_param(
    'sssssssiiii',
    $complaint_id,
    $date_filed,
    $description,
    $location,
    $incident_date,
    $incident_time,
    $complainant,
    $affected,
    $user['barangay_id'],
    $user['id']
);

if ($stmt->execute()) {
    $stmt->close();
    $db->close();
    out(true, [
        'complaint_no' => $complaint_id,
        'message'      => 'Complaint submitted successfully.'
    ]);
} else {
    $err = $stmt->error;
    $stmt->close();
    $db->close();
    out(false, ['error' => 'Could not save complaint: ' . $err], 500);
}