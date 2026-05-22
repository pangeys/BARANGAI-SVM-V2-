<?php
if (session_status() === PHP_SESSION_NONE) session_start();
require_once 'config.php';

function out($ok, $data = [], $code = 200) {
    http_response_code($code);
    echo json_encode(['ok' => $ok] + $data);
    exit;
}

$input  = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $_GET['action'] ?? ($input['action'] ?? '');
$db     = getDB();

switch ($action) {

// ── LOGIN ──────────────────────────────────────────────────────────
case 'login':
    $identifier = trim($input['identifier'] ?? '');
    $password   = $input['password']         ?? '';
    if (!$identifier || !$password) out(false, ['error' => 'Missing credentials'], 422);

    $stmt = $db->prepare('SELECT * FROM users WHERE (username = ? OR email = ?) AND status = "active" LIMIT 1');
    $stmt->bind_param('ss', $identifier, $identifier);
    $stmt->execute();
    $user = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$user || !password_verify($password, $user['password_hash']))
        out(false, ['error' => 'Invalid username/email or password'], 401);

    // also grab barangay name for the resident portal header
    $brgyName = '';
    if ($user['barangay_id']) {
        $s = $db->prepare('SELECT name FROM barangays WHERE id = ?');
        $s->bind_param('i', $user['barangay_id']);
        $s->execute();
        $row = $s->get_result()->fetch_assoc();
        $brgyName = $row ? $row['name'] : '';
        $s->close();
    }

    $_SESSION['user'] = [
        'id'          => (int)$user['id'],
        'name'        => $user['full_name'],
        'role'        => $user['role'],
        'barangay_id' => (int)$user['barangay_id'],
        'barangay'    => $brgyName,
    ];
    out(true, ['role' => $user['role'], 'name' => $user['full_name']]);

// ── SIGN UP (residents only) ───────────────────────────────────────
case 'signup':
    $name    = trim($input['full_name']   ?? '');
    $email   = trim($input['email']       ?? '');
    $pw      = $input['password']          ?? '';
    $brgy_id = (int)($input['barangay_id'] ?? 0);
    $phone   = trim($input['phone']       ?? '');
    $address = trim($input['address']     ?? '');

    if (!$name || !$email || strlen($pw) < 6 || $brgy_id <= 0)
        out(false, ['error' => 'Please fill all required fields (password min 6 chars).'], 422);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))
        out(false, ['error' => 'Invalid email address.'], 422);

    // check if email already exists
    $chk = $db->prepare('SELECT id FROM users WHERE email = ?');
    $chk->bind_param('s', $email);
    $chk->execute();
    $chk->store_result();
    if ($chk->num_rows > 0) out(false, ['error' => 'Email already registered.'], 409);
    $chk->close();

    $hash = password_hash($pw, PASSWORD_DEFAULT);
    $ins  = $db->prepare('INSERT INTO users (full_name, email, password_hash, role, barangay_id, phone, address) VALUES (?, ?, ?, "resident", ?, ?, ?)');
    $ins->bind_param('sssiss', $name, $email, $hash, $brgy_id, $phone, $address);

    if ($ins->execute()) {
        out(true, ['message' => 'Account created successfully.']);
    } else {
        out(false, ['error' => 'Registration failed: ' . $ins->error], 500);
    }
    $ins->close();

// ── BARANGAY LIST (for signup dropdown) ───────────────────────────
case 'barangays':
    $result = $db->query('SELECT id, name FROM barangays ORDER BY name');
    $list   = [];
    while ($row = $result->fetch_assoc()) $list[] = $row;
    out(true, ['barangays' => $list]);

// ── SESSION CHECK ──────────────────────────────────────────────────
case 'me':
    out(true, ['user' => $_SESSION['user'] ?? null]);

// ── LOGOUT ────────────────────────────────────────────────────────
case 'logout':
    session_destroy();
    out(true);

default:
    out(false, ['error' => 'Unknown action.'], 400);
}