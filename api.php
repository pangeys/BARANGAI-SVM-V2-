<?php
error_reporting(0);
ini_set('display_errors', 0);

/* ═══════════════════════════════════════════════════════
   BICTS — api.php  (OFFICER MANAGEMENT UPDATE)
   REST backend for complaints, notifications, ID counter,
   case notes, and officer management.

   Officer-feature changes from previous version:
     • GET  ?type=init        → now also returns officers[] and officer_id per complaint
     • GET  ?type=officers    → list all officers for the barangay
     • POST action=add_officer    → create a new officer
     • POST action=edit_officer   → update officer info
     • DELETE action=delete_officer → delete officer + clear from complaints
     • PUT  action=assign_officer → assign an officer to a complaint (officer + officer_id)

   All new endpoints are barangay-scoped and use prepared statements.
═══════════════════════════════════════════════════════ */

if (session_status() === PHP_SESSION_NONE) session_start();

define('DB_HOST', 'localhost');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'bicts_db');

header("Content-Type: application/json; charset=utf-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
$conn->set_charset('utf8mb4');
if ($conn->connect_error) {
    http_response_code(500);
    echo json_encode(["error" => "DB connection failed: " . $conn->connect_error]);
    exit;
}

/* ── helpers ─────────────────────────────────────────── */
function respond($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Write one row to activity_log.
 * Safe: all values are server-generated or already-validated.
 */
function logActivity($conn, $userId, $userName, $barangayId, $action, $detail) {
    $ip   = $_SERVER['REMOTE_ADDR'] ?? '';
    $stmt = $conn->prepare(
        "INSERT INTO activity_log (user_id, user_name, barangay_id, action, detail, ip_address)
         VALUES (?, ?, ?, ?, ?, ?)"
    );
    $stmt->bind_param('isisss', $userId, $userName, $barangayId, $action, $detail, $ip);
    $stmt->execute();
    $stmt->close();
}

/* ── session context ─────────────────────────────────── */
$sessionUser = $_SESSION['user'] ?? [];
$barangay_id = isset($sessionUser['barangay_id']) ? (int)$sessionUser['barangay_id'] : 0;
$userId      = isset($sessionUser['id'])          ? (int)$sessionUser['id']          : 0;
$userName    = $sessionUser['name']               ?? 'Unknown';

/* ── request parsing ─────────────────────────────────── */
$method = $_SERVER['REQUEST_METHOD'];
$type   = $_GET['type'] ?? '';
$body   = json_decode(file_get_contents("php://input"), true) ?? [];
$action = $body['action'] ?? '';


/* ════════════════════════════════════════════════════
   GET api.php?type=init
   Returns this barangay's complaints, notifications,
   next ID counter, AND officers list.
   CHANGED: added officer_id to each complaint row;
            added officers[] to response.
════════════════════════════════════════════════════ */
if ($method === 'GET' && $type === 'init') {

    /* ── Complaints ── */
    $complaints = [];
    if ($barangay_id > 0) {
        $stmt = $conn->prepare("SELECT * FROM complaints WHERE barangay_id = ? ORDER BY created_at DESC");
        $stmt->bind_param('i', $barangay_id);
        $stmt->execute();
        $r = $stmt->get_result();
        $stmt->close();
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
            'officer_id'  => intval($row['officer_id'] ?? 0),   // ← NEW
            'status'      => $row['status'],
            'sb'          => $row['status_badge'],
            'resolvedAt'  => $row['resolved_at'],
            'closeReason' => $row['close_reason'] ?? '',
            'barangay_id' => intval($row['barangay_id']),
        ];
    }

    /* ── Notifications ── */
    $notifs = [];
    if ($barangay_id > 0) {
        $stmt = $conn->prepare(
            "SELECT * FROM notifications
             WHERE barangay_id = ? OR barangay_id IS NULL
             ORDER BY created_at DESC"
        );
        $stmt->bind_param('i', $barangay_id);
        $stmt->execute();
        $r2 = $stmt->get_result();
        $stmt->close();
    } else {
        $r2 = $conn->query("SELECT * FROM notifications ORDER BY created_at DESC");
    }
    while ($row = $r2->fetch_assoc()) {
        $notifs[] = [
            'msg'    => $row['msg'],
            'type'   => $row['type'],
            'time'   => $row['time'],
            'isRead' => intval($row['is_read'] ?? 0),
        ];
    }

    /* ── ID counter ── */
    $r3     = $conn->query("SELECT next_id FROM id_counter WHERE id = 1");
    $nextId = intval($r3->fetch_assoc()['next_id'] ?? 1);

    /* ── Officers (NEW) ── */
    $officersList = [];
    if ($barangay_id > 0) {
        $stmt = $conn->prepare(
            "SELECT id, name, `rank`, contact, email, status, barangay_id
             FROM officers WHERE barangay_id = ? ORDER BY name ASC"
        );
        $stmt->bind_param('i', $barangay_id);
        $stmt->execute();
        $ro = $stmt->get_result();
        $stmt->close();
    } else {
        $ro = $conn->query(
            "SELECT id, name, `rank`, contact, email, status, barangay_id
             FROM officers ORDER BY name ASC"
        );
    }
    while ($row = $ro->fetch_assoc()) $officersList[] = $row;

    respond([
        'complaints'    => $complaints,
        'notifications' => $notifs,
        'nextId'        => $nextId,
        'officers'      => $officersList,   // ← NEW
    ]);
}


/* ════════════════════════════════════════════════════
   GET api.php?type=notes&complaint_id=X
   Returns all notes for one complaint, ordered oldest→newest.
   Scoped to the logged-in admin's barangay when possible.
════════════════════════════════════════════════════ */
if ($method === 'GET' && $type === 'notes') {
    $complaint_id = trim($_GET['complaint_id'] ?? '');

    if ($complaint_id === '') {
        respond(['error' => 'complaint_id required'], 400);
    }

    if ($barangay_id > 0) {
        // Extra safety: only return notes whose parent complaint belongs to this barangay
        $stmt = $conn->prepare(
            "SELECT n.id, n.complaint_id, n.author, n.author_role,
                    n.content, n.created_at, n.updated_at
             FROM   case_notes n
             INNER JOIN complaints c ON c.complaint_id = n.complaint_id
             WHERE  n.complaint_id = ?
               AND  c.barangay_id  = ?
             ORDER BY n.created_at ASC"
        );
        $stmt->bind_param('si', $complaint_id, $barangay_id);
    } else {
        $stmt = $conn->prepare(
            "SELECT id, complaint_id, author, author_role,
                    content, created_at, updated_at
             FROM   case_notes
             WHERE  complaint_id = ?
             ORDER BY created_at ASC"
        );
        $stmt->bind_param('s', $complaint_id);
    }

    $stmt->execute();
    $r     = $stmt->get_result();
    $notes = [];
    while ($row = $r->fetch_assoc()) $notes[] = $row;
    $stmt->close();

    respond(['notes' => $notes]);
}


/* ════════════════════════════════════════════════════
   POST action=add_note
════════════════════════════════════════════════════ */
if ($method === 'POST' && $action === 'add_note') {
    $complaint_id = trim((string)($body['complaint_id'] ?? ''));
    $content      = trim((string)($body['content']      ?? ''));
    $author       = trim((string)($body['author']       ?? 'Unknown'));
    $author_role  = trim((string)($body['author_role']  ?? ''));
    $bid          = $barangay_id > 0 ? $barangay_id : null;

    if ($complaint_id === '' || $content === '') {
        respond(['success' => false, 'error' => 'complaint_id and content are required'], 400);
    }

    $stmt = $conn->prepare(
        "INSERT INTO case_notes (complaint_id, author, author_role, content, barangay_id)
         VALUES (?, ?, ?, ?, ?)"
    );
    $stmt->bind_param('ssssi', $complaint_id, $author, $author_role, $content, $bid);
    $ok    = $stmt->execute();
    $newId = $conn->insert_id;
    $createdAt = date('Y-m-d H:i:s');
    $stmt->close();

    if ($ok) {
        logActivity($conn, $userId, $userName, $barangay_id,
            'note_added', "Note #$newId added to complaint $complaint_id");
    }

    respond([
        'success'    => (bool)$ok,
        'id'         => $newId,
        'created_at' => $createdAt,
        'updated_at' => $createdAt,
    ]);
}


/* ════════════════════════════════════════════════════
   POST action=edit_note
   Allows editing content of an existing note.
   Scoped: can only edit a note that belongs to this admin's
   barangay (verified via JOIN to complaints).
════════════════════════════════════════════════════ */
if ($method === 'POST' && $action === 'edit_note') {
    $id      = (int)($body['id']      ?? 0);
    $content = trim((string)($body['content'] ?? ''));

    if ($id === 0 || $content === '') {
        respond(['success' => false, 'error' => 'id and content are required'], 400);
    }

    if ($barangay_id > 0) {
        // Only edit if the parent complaint belongs to this barangay
        $stmt = $conn->prepare(
            "UPDATE case_notes n
             INNER JOIN complaints c ON c.complaint_id = n.complaint_id
             SET n.content = ?
             WHERE n.id = ? AND c.barangay_id = ?"
        );
        $stmt->bind_param('sii', $content, $id, $barangay_id);
    } else {
        $stmt = $conn->prepare("UPDATE case_notes SET content = ? WHERE id = ?");
        $stmt->bind_param('si', $content, $id);
    }

    $ok = $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();

    if ($ok && $affected > 0) {
        logActivity($conn, $userId, $userName, $barangay_id,
            'note_edited', "Note #$id updated");
    }

    respond([
        'success'    => $ok && $affected > 0,
        'updated_at' => date('Y-m-d H:i:s'),
    ]);
}


/* ════════════════════════════════════════════════════
   DELETE action=delete_note
   BUG FIX: was POST in the previous version; app.js sends DELETE.
   Scoped: can only delete a note that belongs to this admin's
   barangay (verified via JOIN to complaints).
════════════════════════════════════════════════════ */
if ($method === 'DELETE' && $action === 'delete_note') {
    $id = (int)($body['id'] ?? 0);

    if ($id === 0) {
        respond(['success' => false, 'error' => 'id required'], 400);
    }

    if ($barangay_id > 0) {
        $stmt = $conn->prepare(
            "DELETE n FROM case_notes n
             INNER JOIN complaints c ON c.complaint_id = n.complaint_id
             WHERE n.id = ? AND c.barangay_id = ?"
        );
        $stmt->bind_param('ii', $id, $barangay_id);
    } else {
        $stmt = $conn->prepare("DELETE FROM case_notes WHERE id = ?");
        $stmt->bind_param('i', $id);
    }

    $ok       = $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();

    if ($ok && $affected > 0) {
        logActivity($conn, $userId, $userName, $barangay_id,
            'note_deleted', "Note #$id deleted");
    }

    respond(['success' => $ok && $affected > 0]);
}


/* ════════════════════════════════════════════════════
   POST action=add_officer   (NEW)
════════════════════════════════════════════════════ */
if ($method === 'POST' && $action === 'add_officer') {
    $name    = trim((string)($body['name']    ?? ''));
    $rank    = trim((string)($body['rank']    ?? ''));
    $contact = trim((string)($body['contact'] ?? ''));
    $email   = trim((string)($body['email']   ?? ''));
    $status  = in_array(($body['status'] ?? ''), ['Active', 'Inactive'])
               ? $body['status'] : 'Active';
    $bid     = $barangay_id > 0 ? $barangay_id : null;

    if ($name === '') respond(['success' => false, 'error' => 'Officer name is required'], 400);

    $stmt = $conn->prepare(
        "INSERT INTO officers (name, `rank`, contact, email, status, barangay_id)
         VALUES (?, ?, ?, ?, ?, ?)"
    );
    $stmt->bind_param('sssssi', $name, $rank, $contact, $email, $status, $bid);
    $ok    = $stmt->execute();
    $newId = $conn->insert_id;
    $stmt->close();

    if ($ok) {
        logActivity($conn, $userId, $userName, $barangay_id,
            'officer_added', "Officer '$name' added (ID: $newId)");
    }
    respond(['success' => (bool)$ok, 'id' => $newId]);
}


/* ════════════════════════════════════════════════════
   POST action=edit_officer   (NEW)
════════════════════════════════════════════════════ */
if ($method === 'POST' && $action === 'edit_officer') {
    $id      = (int)($body['id']      ?? 0);
    $name    = trim((string)($body['name']    ?? ''));
    $rank    = trim((string)($body['rank']    ?? ''));
    $contact = trim((string)($body['contact'] ?? ''));
    $email   = trim((string)($body['email']   ?? ''));
    $status  = in_array(($body['status'] ?? ''), ['Active', 'Inactive'])
               ? $body['status'] : 'Active';

    if ($id === 0 || $name === '') {
        respond(['success' => false, 'error' => 'id and name are required'], 400);
    }

    if ($barangay_id > 0) {
        $stmt = $conn->prepare(
            "UPDATE officers
                SET name = ?, `rank` = ?, contact = ?, email = ?, status = ?
              WHERE id = ? AND barangay_id = ?"
        );
        $stmt->bind_param('sssssii', $name, $rank, $contact, $email, $status, $id, $barangay_id);
    } else {
        $stmt = $conn->prepare(
            "UPDATE officers SET name = ?, `rank` = ?, contact = ?, email = ?, status = ?
             WHERE id = ?"
        );
        $stmt->bind_param('sssssi', $name, $rank, $contact, $email, $status, $id);
    }
    $ok       = $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();

    if ($ok) {
        /* Also sync the display name in any complaints currently assigned to this officer */
        if ($barangay_id > 0) {
            $s2 = $conn->prepare(
                "UPDATE complaints SET officer = ?
                 WHERE officer_id = ? AND barangay_id = ?"
            );
            $s2->bind_param('sii', $name, $id, $barangay_id);
        } else {
            $s2 = $conn->prepare("UPDATE complaints SET officer = ? WHERE officer_id = ?");
            $s2->bind_param('si', $name, $id);
        }
        $s2->execute();
        $s2->close();

        logActivity($conn, $userId, $userName, $barangay_id,
            'officer_edited', "Officer ID $id updated to '$name'");
    }
    /* affected_rows is 0 when no field values changed — still a success */
    respond(['success' => (bool)$ok]);
}


/* ════════════════════════════════════════════════════
   DELETE action=delete_officer   (NEW)
   Also clears the officer from any assigned complaints.
════════════════════════════════════════════════════ */
if ($method === 'DELETE' && $action === 'delete_officer') {
    $id = (int)($body['id'] ?? 0);
    if ($id === 0) respond(['success' => false, 'error' => 'id required'], 400);

    if ($barangay_id > 0) {
        $stmt = $conn->prepare(
            "DELETE FROM officers WHERE id = ? AND barangay_id = ?"
        );
        $stmt->bind_param('ii', $id, $barangay_id);
    } else {
        $stmt = $conn->prepare("DELETE FROM officers WHERE id = ?");
        $stmt->bind_param('i', $id);
    }
    $ok       = $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();

    if ($ok && $affected > 0) {
        /* Clear the officer from any complaints that referenced this officer */
        if ($barangay_id > 0) {
            $s2 = $conn->prepare(
                "UPDATE complaints SET officer = '—', officer_id = NULL
                 WHERE officer_id = ? AND barangay_id = ?"
            );
            $s2->bind_param('ii', $id, $barangay_id);
        } else {
            $s2 = $conn->prepare(
                "UPDATE complaints SET officer = '—', officer_id = NULL WHERE officer_id = ?"
            );
            $s2->bind_param('i', $id);
        }
        $s2->execute();
        $s2->close();

        logActivity($conn, $userId, $userName, $barangay_id,
            'officer_deleted', "Officer ID $id deleted");
    }
    respond(['success' => $ok && $affected > 0]);
}


/* ════════════════════════════════════════════════════
   POST action=add_complaint
════════════════════════════════════════════════════ */
if ($method === 'POST' && $action === 'add_complaint') {
    $d = $body['data'] ?? [];

    // Atomically get + increment the ID counter
    $conn->begin_transaction();
    $conn->query("UPDATE id_counter SET next_id = next_id + 1 WHERE id = 1");
    $r      = $conn->query("SELECT next_id FROM id_counter WHERE id = 1");
    $nextId = intval($r->fetch_assoc()['next_id']);
    $conn->commit();

    $num = $nextId - 1;
    $cid = '#' . str_pad($num, 3, '0', STR_PAD_LEFT);

    // gather + type the values (no escaping needed — bound below)
    $dateFiled = (string)($d['date_filed']  ?? date('M j'));
    $desc      = (string)($d['description'] ?? '');
    $loc       = (string)($d['location']    ?? '');
    $incDate   = (string)($d['date']        ?? '');
    $incTime   = (string)($d['time']        ?? '');
    $comp      = (string)($d['complainant'] ?? 'Anonymous');
    $affected  = (int)($d['affected']       ?? 1);
    $cat       = (string)($d['category']    ?? '');
    $conf      = (int)($d['confidence']     ?? 0);
    $score     = (string)($d['score']       ?? '0');
    $priority  = (string)($d['priority']    ?? 'Low');
    $pb        = (string)($d['pb']          ?? 'b-gray');
    $officer   = (string)($d['officer']     ?? '—');
    $status    = (string)($d['status']      ?? 'Open');
    $sb        = (string)($d['sb']          ?? 'b-gray');
    $bid       = $barangay_id > 0 ? $barangay_id : null;

    $sql = "INSERT INTO complaints
              (complaint_id, date_filed, description, location,
               incident_date, incident_time, complainant, affected,
               category, confidence, score, priority, priority_badge,
               officer, status, status_badge, barangay_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    $stmt = $conn->prepare($sql);
    // types (17): cid,dateFiled,desc,loc,incDate,incTime,comp = 7×s,
    //             affected=i, cat=s, conf=i, score,priority,pb,officer,status,sb = 6×s, bid=i
    $stmt->bind_param(
        'sssssssisissssssi',
        $cid, $dateFiled, $desc, $loc,
        $incDate, $incTime, $comp, $affected,
        $cat, $conf, $score, $priority, $pb,
        $officer, $status, $sb, $bid
    );
    $ok = $stmt->execute();
    $stmt->close();

    if ($ok) respond(["success" => true, "id" => $cid]);
    else     respond(["success" => false, "error" => $conn->error], 500);
}


/* ════════════════════════════════════════════════════
   PUT action=assign_officer   (NEW)
   Assigns an officer (by ID + display name) to a
   complaint. Updates both officer and officer_id columns.
════════════════════════════════════════════════════ */
if ($method === 'PUT' && $action === 'assign_officer') {
    $complaintId = trim((string)($body['complaint_id'] ?? ''));
    $officerId   = (int)($body['officer_id']           ?? 0);
    $officerName = trim((string)($body['officer_name'] ?? '—'));

    if ($complaintId === '') {
        respond(['success' => false, 'error' => 'complaint_id required'], 400);
    }

    if ($barangay_id > 0) {
        $stmt = $conn->prepare(
            "UPDATE complaints
                SET officer = ?, officer_id = ?
              WHERE complaint_id = ? AND barangay_id = ?"
        );
        $stmt->bind_param('sisi', $officerName, $officerId, $complaintId, $barangay_id);
    } else {
        $stmt = $conn->prepare(
            "UPDATE complaints SET officer = ?, officer_id = ? WHERE complaint_id = ?"
        );
        $stmt->bind_param('sis', $officerName, $officerId, $complaintId);
    }
    $ok = $stmt->execute();
    $stmt->close();

    if ($ok) {
        logActivity($conn, $userId, $userName, $barangay_id,
            'officer_assigned',
            "Officer '$officerName' (ID: $officerId) assigned to complaint $complaintId");
    }
    respond(['success' => (bool)$ok]);
}


/* ════════════════════════════════════════════════════
   POST action=add_notification
════════════════════════════════════════════════════ */
if ($method === 'POST' && $action === 'add_notification') {
    $msg   = (string)($body['msg']        ?? '');
    $ntype = (string)($body['notif_type'] ?? 'info');
    $time  = (string)($body['time']       ?? '');
    $bid   = $barangay_id > 0 ? $barangay_id : null;

    $stmt = $conn->prepare("INSERT INTO notifications (msg, type, time, barangay_id) VALUES (?, ?, ?, ?)");
    $stmt->bind_param('sssi', $msg, $ntype, $time, $bid);
    $stmt->execute();
    $stmt->close();
    respond(["success" => true]);
}


/* ════════════════════════════════════════════════════
   POST action=mark_read
════════════════════════════════════════════════════ */
if ($method === 'POST' && $action === 'mark_read') {
    if ($barangay_id > 0) {
        $stmt = $conn->prepare(
            "UPDATE notifications SET is_read = 1 WHERE barangay_id = ? OR barangay_id IS NULL"
        );
        $stmt->bind_param('i', $barangay_id);
        $stmt->execute();
        $stmt->close();
    } else {
        $conn->query("UPDATE notifications SET is_read = 1");
    }
    respond(["success" => true]);
}


/* ════════════════════════════════════════════════════
   PUT action=update_status
════════════════════════════════════════════════════ */
if ($method === 'PUT' && $action === 'close_complaint') {
    $id     = (string)($body['id']     ?? '');
    $reason = (string)($body['reason'] ?? 'Closed');
    $sb     = 'b-gray';
    $closedAt = date('h:i A');
 
    if ($id === '') {
        respond(['success' => false, 'error' => 'id required'], 400);
    }
 
    if ($barangay_id > 0) {
        $stmt = $conn->prepare(
            "UPDATE complaints
                SET status = 'Closed', status_badge = ?, close_reason = ?, resolved_at = ?
              WHERE complaint_id = ? AND barangay_id = ?"
        );
        $stmt->bind_param('ssssi', $sb, $reason, $closedAt, $id, $barangay_id);
    } else {
        $stmt = $conn->prepare(
            "UPDATE complaints
                SET status = 'Closed', status_badge = ?, close_reason = ?, resolved_at = ?
              WHERE complaint_id = ?"
        );
        $stmt->bind_param('ssss', $sb, $reason, $closedAt, $id);
    }
    $ok = $stmt->execute();
    $stmt->close();
 
    if ($ok) {
        logActivity($conn, $userId, $userName, $barangay_id,
            'complaint_closed', "Complaint $id closed — $reason");
    }
    respond(['success' => (bool)$ok]);
}


respond(["error" => "Unknown request"], 400);