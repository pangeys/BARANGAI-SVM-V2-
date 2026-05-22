<?php
// ═══════════════════════════════════════════════════════
//  BICTS — api/complaints.php
//  Handles saving complaints from the frontend to MySQL
//  and fetching them back for reports.
//
//  GET  /api/complaints.php              → fetch all complaints
//  GET  /api/complaints.php?id=5         → fetch single complaint
//  POST /api/complaints.php              → save a new complaint
// ═══════════════════════════════════════════════════════

require_once 'config.php';
$db = getDB();

// ── POST: Save a new complaint ──
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!$body) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON body']);
        exit();
    }

    $stmt = $db->prepare("
        INSERT INTO complaints
          (complaint_no, date_filed, incident_date, incident_time, location,
           description, complainant, affected, category, confidence,
           priority, score, officer, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");

    $complaint_no  = $body['id']            ?? '#000';
    $date_filed    = date('Y-m-d');
    $incident_date = $body['date']          ?? null;
    $incident_time = $body['time']          ?? null;
    $location      = $body['location']      ?? '';
    $description   = $body['description']   ?? '';
    $complainant   = $body['complainant']   ?? 'Anonymous';
    $affected      = (int)($body['affected'] ?? 1);
    $category      = $body['category']      ?? '';
    $confidence    = (float)($body['confidence'] ?? 0);
    $priority      = $body['priority']      ?? 'Low';
    $score         = (float)($body['score'] ?? 0);
    $officer       = $body['officer']       ?? '—';
    $status        = $body['status']        ?? 'Open';

    $stmt->bind_param(
        'sssssssissddss',
        $complaint_no, $date_filed, $incident_date, $incident_time,
        $location, $description, $complainant, $affected,
        $category, $confidence, $priority, $score, $officer, $status
    );

    if ($stmt->execute()) {
        echo json_encode(['success' => true, 'inserted_id' => $db->insert_id]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => $stmt->error]);
    }
    $stmt->close();
    exit();
}

// ── GET: Fetch complaints ──
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['id'])) {
        // Single complaint
        $id   = (int)$_GET['id'];
        $stmt = $db->prepare("SELECT * FROM complaints WHERE id = ?");
        $stmt->bind_param('i', $id);
        $stmt->execute();
        $result = $stmt->get_result();
        echo json_encode($result->fetch_assoc());
        $stmt->close();
    } else {
        // All complaints
        $result = $db->query("SELECT * FROM complaints ORDER BY date_filed DESC");
        $rows   = [];
        while ($row = $result->fetch_assoc()) $rows[] = $row;
        echo json_encode($rows);
    }
    exit();
}

$db->close();
