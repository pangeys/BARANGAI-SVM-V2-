<?php
// ═══════════════════════════════════════════════════════
//  BICTS — api/update_status.php
//  Updates complaint status (e.g. mark as Resolved)
//  POST body: { complaint_no, status, resolved_at }
// ═══════════════════════════════════════════════════════

require_once 'config.php';
$db = getDB();

$body = json_decode(file_get_contents('php://input'), true);
if (!$body) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON']);
    exit();
}

$complaint_no = $body['complaint_no'] ?? '';
$status       = $body['status']       ?? 'Open';
$resolved_at  = isset($body['resolved_at']) ? date('Y-m-d H:i:s', strtotime($body['resolved_at'])) : null;

if ($status === 'Resolved' && $resolved_at) {
    $stmt = $db->prepare("UPDATE complaints SET status = ?, resolved_at = ? WHERE complaint_no = ?");
    $stmt->bind_param('sss', $status, $resolved_at, $complaint_no);
} else {
    $stmt = $db->prepare("UPDATE complaints SET status = ? WHERE complaint_no = ?");
    $stmt->bind_param('ss', $status, $complaint_no);
}

if ($stmt->execute()) {
    echo json_encode(['success' => true, 'affected' => $stmt->affected_rows]);
} else {
    http_response_code(500);
    echo json_encode(['error' => $stmt->error]);
}

$stmt->close();
$db->close();
