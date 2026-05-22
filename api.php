<?php
error_reporting(0);
ini_set('display_errors', 0);

/* ═══════════════════════════════════════════════════════
   BICTS — api.php
   REST backend for complaints, notifications, ID counter.
   Now filters complaints by the logged-in admin's barangay.
═══════════════════════════════════════════════════════ */

if (session_status() === PHP_SESSION_NONE) session_start();

define('DB_HOST', 'localhost');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'bicts_db');

header("Content-Type: application/json; charset=utf-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
$conn->set_charset('utf8mb4');
if ($conn->connect_error) {
    http_response_code(500);
    echo json_encode(["error" => "DB connection failed: " . $conn->connect_error]);
    exit;
}

function esc($conn, $val) {
    return $conn->real_escape_string(strval($val ?? ''));
}

function respond($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// get logged-in admin's barangay_id from session
$barangay_id = 0;
if (!empty($_SESSION['user']) && $_SESSION['user']['role'] === 'admin') {
    $barangay_id = (int)$_SESSION['user']['barangay_id'];
}

$method = $_SERVER['REQUEST_METHOD'];
$type   = $_GET['type'] ?? '';
$body   = json_decode(file_get_contents("php://input"), true) ?? [];
$action = $body['action'] ?? '';

/* ════════════════════════════════════════════════════
   GET api.php?type=init
   Returns only THIS admin's barangay complaints.
════════════════════════════════════════════════════ */
if ($method === 'GET' && $type === 'init') {

    // fetch complaints filtered by barangay
    $complaints = [];
    if ($barangay_id > 0) {
        $stmt = $conn->prepare(
            "SELECT * FROM complaints WHERE barangay_id = ? ORDER BY created_at DESC"
        );
        $stmt->bind_param('i', $barangay_id);
        $stmt->execute();
        $r = $stmt->get_result();
    } else {
        // no session — return all (fallback for dev/testing)
        $r = $conn->query("SELECT * FROM complaints ORDER BY created_at DESC");
    }

    while ($row = $r->fetch_assoc()) {
        $complaints[] = [
            'id'          => $row['complaint_id'],
            'date'        => $row['date_filed'],
            'description' => $row['description'],
            'location'    => $row['location'],
            'time'        => $row['incident_time'],
            'complainant' => $row['complainant'],
            'affected'    => strval($row['affected']),
            'category'    => $row['category'],
            'confidence'  => intval($row['confidence']),
            'score'       => $row['score'],
            'priority'    => $row['priority'],
            'pb'          => $row['priority_badge'],
            'officer'     => $row['officer'],
            'status'      => $row['status'],
            'sb'          => $row['status_badge'],
            'resolvedAt'  => $row['resolved_at'],
            'barangay_id' => intval($row['barangay_id']),
        ];
    }

    // notifications filtered by barangay
    $notifs = [];
    if ($barangay_id > 0) {
        $stmt2 = $conn->prepare(
            "SELECT * FROM notifications WHERE barangay_id = ? OR barangay_id IS NULL ORDER BY created_at DESC"
        );
        $stmt2->bind_param('i', $barangay_id);
        $stmt2->execute();
        $r2 = $stmt2->get_result();
    } else {
        $r2 = $conn->query("SELECT * FROM notifications ORDER BY created_at DESC");
    }
    while ($row = $r2->fetch_assoc()) {
        $notifs[] = [
            'msg'  => $row['msg'],
            'type' => $row['type'],
            'time' => $row['time'],
        ];
    }

    // next complaint ID
    $r3     = $conn->query("SELECT next_id FROM id_counter WHERE id = 1");
    $nextId = intval($r3->fetch_assoc()['next_id'] ?? 1);

    respond([
        'complaints'    => $complaints,
        'notifications' => $notifs,
        'nextId'        => $nextId,
    ]);
}

/* ════════════════════════════════════════════════════
   POST — add_complaint  (tags with admin's barangay)
════════════════════════════════════════════════════ */
if ($method === 'POST' && $action === 'add_complaint') {
    $d = $body['data'] ?? [];

    // atomically get + increment the ID counter
    $conn->begin_transaction();
    $conn->query("UPDATE id_counter SET next_id = next_id + 1 WHERE id = 1");
    $r      = $conn->query("SELECT next_id FROM id_counter WHERE id = 1");
    $nextId = intval($r->fetch_assoc()['next_id']);
    $conn->commit();

    $num = $nextId - 1;
    $cid = '#' . str_pad($num, 3, '0', STR_PAD_LEFT);

    $dateFiled = esc($conn, $d['date_filed']  ?? date('M j'));
    $desc      = esc($conn, $d['description'] ?? '');
    $loc       = esc($conn, $d['location']    ?? '');
    $incDate   = esc($conn, $d['date']        ?? '');
    $incTime   = esc($conn, $d['time']        ?? '');
    $comp      = esc($conn, $d['complainant'] ?? 'Anonymous');
    $affected  = intval($d['affected']        ?? 1);
    $cat       = esc($conn, $d['category']    ?? '');
    $conf      = intval($d['confidence']      ?? 0);
    $score     = esc($conn, $d['score']       ?? '0');
    $priority  = esc($conn, $d['priority']    ?? 'Low');
    $pb        = esc($conn, $d['pb']          ?? 'b-gray');
    $officer   = esc($conn, $d['officer']     ?? '—');
    $status    = esc($conn, $d['status']      ?? 'Open');
    $sb        = esc($conn, $d['sb']          ?? 'b-gray');
    $cidEsc    = esc($conn, $cid);
    $bid       = $barangay_id > 0 ? $barangay_id : 'NULL';

    $ok = $conn->query("
        INSERT INTO complaints
            (complaint_id, date_filed, description, location,
             incident_date, incident_time, complainant, affected,
             category, confidence, score, priority, priority_badge,
             officer, status, status_badge, barangay_id)
        VALUES
            ('$cidEsc', '$dateFiled', '$desc', '$loc',
             '$incDate', '$incTime', '$comp', $affected,
             '$cat', $conf, '$score', '$priority', '$pb',
             '$officer', '$status', '$sb', $bid)
    ");

    if ($ok) {
        respond(["success" => true, "id" => $cid]);
    } else {
        respond(["success" => false, "error" => $conn->error], 500);
    }
}

/* ════════════════════════════════════════════════════
   POST — add_notification  (tags with admin's barangay)
════════════════════════════════════════════════════ */
if ($method === 'POST' && $action === 'add_notification') {
    $msg   = esc($conn, $body['msg']        ?? '');
    $ntype = esc($conn, $body['notif_type'] ?? 'info');
    $time  = esc($conn, $body['time']       ?? '');
    $bid   = $barangay_id > 0 ? $barangay_id : 'NULL';

    $conn->query(
        "INSERT INTO notifications (msg, type, time, barangay_id) VALUES ('$msg', '$ntype', '$time', $bid)"
    );
    respond(["success" => true]);
}

/* ════════════════════════════════════════════════════
   PUT — update_status  (only own barangay's complaints)
════════════════════════════════════════════════════ */
if ($method === 'PUT' && $action === 'update_status') {
    $id         = esc($conn, $body['id']          ?? '');
    $status     = esc($conn, $body['status']      ?? '');
    $sb         = esc($conn, $body['sb']          ?? 'b-gray');
    $resolvedAt = esc($conn, $body['resolved_at'] ?? '');

    if ($barangay_id > 0) {
        $ok = $conn->query("
            UPDATE complaints
            SET status = '$status', status_badge = '$sb', resolved_at = '$resolvedAt'
            WHERE complaint_id = '$id' AND barangay_id = $barangay_id
        ");
    } else {
        $ok = $conn->query("
            UPDATE complaints
            SET status = '$status', status_badge = '$sb', resolved_at = '$resolvedAt'
            WHERE complaint_id = '$id'
        ");
    }
    respond(["success" => (bool)$ok]);
}

respond(["error" => "Unknown request"], 400);