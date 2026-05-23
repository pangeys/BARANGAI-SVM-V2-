<?php
/* ═══════════════════════════════════════════════════════════
   BICTS — profile.php
   Handles: my profile (get/update), first-login completion,
            user management (admin only), and the activity log.
   Style: mysqli + prepared statements (matches auth.php).
═══════════════════════════════════════════════════════════ */
if (session_status() === PHP_SESSION_NONE) session_start();
require_once 'config.php';

header('Content-Type: application/json; charset=utf-8');

function out($ok, $data = [], $code = 200) {
    http_response_code($code);
    echo json_encode(['ok' => $ok] + $data);
    exit;
}

/* ---- helpers ---------------------------------------------- */
function current_user() {
    return $_SESSION['user'] ?? null;
}
function require_login() {
    $u = current_user();
    if (!$u) out(false, ['error' => 'Not logged in.'], 401);
    return $u;
}
function require_admin() {
    $u = require_login();
    if (($u['role'] ?? '') !== 'admin') out(false, ['error' => 'Admins only.'], 403);
    return $u;
}
function log_activity($db, $action, $detail = '') {
    $u   = current_user();
    $uid = $u['id']          ?? null;
    $un  = $u['name']        ?? null;
    $bid = $u['barangay_id'] ?? null;
    $ip  = $_SERVER['REMOTE_ADDR'] ?? null;
    $stmt = $db->prepare(
        'INSERT INTO activity_log (user_id, user_name, barangay_id, action, detail, ip_address)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->bind_param('isisss', $uid, $un, $bid, $action, $detail, $ip);
    $stmt->execute();
    $stmt->close();
}

$input  = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $_GET['action'] ?? ($input['action'] ?? '');
$db     = getDB();

switch ($action) {

/* ── MY PROFILE: read full details for the logged-in user ──── */
case 'get_profile':
    $u = require_login();
    $stmt = $db->prepare(
        'SELECT id, username, full_name, email, phone, address, role,
                last_login, login_count, profile_completed, created_at
           FROM users WHERE id = ? LIMIT 1'
    );
    $stmt->bind_param('i', $u['id']);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$row) out(false, ['error' => 'User not found.'], 404);
    out(true, ['profile' => $row]);

/* ── UPDATE MY PROFILE (also used by first-login setup) ────── */
case 'update_profile':
    $u = require_login();

    $name    = trim($input['full_name'] ?? '');
    $email   = trim($input['email']     ?? '');
    $phone   = trim($input['phone']     ?? '');
    $address = trim($input['address']   ?? '');
    $newpw   = $input['password']        ?? '';   // optional

    // Role is intentionally NOT editable here — display only on the client.
    if ($name === '' || $email === '')
        out(false, ['error' => 'Name and email are required.'], 422);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))
        out(false, ['error' => 'Invalid email address.'], 422);

    // email must be unique across other users
    $chk = $db->prepare('SELECT id FROM users WHERE email = ? AND id <> ?');
    $chk->bind_param('si', $email, $u['id']);
    $chk->execute();
    $chk->store_result();
    if ($chk->num_rows > 0) { $chk->close(); out(false, ['error' => 'Email already in use.'], 409); }
    $chk->close();

    if ($newpw !== '') {
        if (strlen($newpw) < 6) out(false, ['error' => 'Password must be at least 6 characters.'], 422);
        $hash = password_hash($newpw, PASSWORD_DEFAULT);
        $stmt = $db->prepare(
            'UPDATE users SET full_name=?, email=?, phone=?, address=?, password_hash=?, profile_completed=1 WHERE id=?'
        );
        $stmt->bind_param('sssssi', $name, $email, $phone, $address, $hash, $u['id']);
    } else {
        $stmt = $db->prepare(
            'UPDATE users SET full_name=?, email=?, phone=?, address=?, profile_completed=1 WHERE id=?'
        );
        $stmt->bind_param('ssssi', $name, $email, $phone, $address, $u['id']);
    }
    $ok = $stmt->execute();
    $stmt->close();
    if (!$ok) out(false, ['error' => 'Update failed.'], 500);

    // keep the session display name in sync
    $_SESSION['user']['name'] = $name;
    log_activity($db, 'profile_updated', 'Updated own profile');
    out(true, ['message' => 'Profile saved.', 'name' => $name]);

/* ── USERS LIST (admin only, scoped to own barangay) ───────── */
case 'list_users':
    $admin = require_admin();
    $bid   = (int)$admin['barangay_id'];
    $stmt  = $db->prepare(
        'SELECT id, username, full_name, email, phone, role, status,
                last_login, login_count
           FROM users
          WHERE barangay_id = ?
          ORDER BY role, full_name'
    );
    $stmt->bind_param('i', $bid);
    $stmt->execute();
    $res  = $stmt->get_result();
    $list = [];
    while ($r = $res->fetch_assoc()) $list[] = $r;
    $stmt->close();
    out(true, ['users' => $list]);

/* ── CREATE USER (admin only) ──────────────────────────────── */
case 'create_user':
    $admin = require_admin();
    $name  = trim($input['full_name'] ?? '');
    $email = trim($input['email']     ?? '');
    $uname = trim($input['username']  ?? '');
    $role  = trim($input['role']      ?? 'staff');
    $pw    = $input['password']        ?? '';

    $allowedRoles = ['admin', 'staff', 'viewer'];
    if (!in_array($role, $allowedRoles, true)) $role = 'staff';
    if ($name === '' || $email === '' || $uname === '' || strlen($pw) < 6)
        out(false, ['error' => 'All fields required (password min 6 chars).'], 422);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))
        out(false, ['error' => 'Invalid email.'], 422);

    $chk = $db->prepare('SELECT id FROM users WHERE email = ? OR username = ?');
    $chk->bind_param('ss', $email, $uname);
    $chk->execute();
    $chk->store_result();
    if ($chk->num_rows > 0) { $chk->close(); out(false, ['error' => 'Username or email already exists.'], 409); }
    $chk->close();

    $hash = password_hash($pw, PASSWORD_DEFAULT);
    $bid  = (int)$admin['barangay_id'];
    $stmt = $db->prepare(
        'INSERT INTO users (username, full_name, email, password_hash, role, barangay_id, status, profile_completed)
         VALUES (?, ?, ?, ?, ?, ?, "active", 0)'
    );
    $stmt->bind_param('sssssi', $uname, $name, $email, $hash, $role, $bid);
    $ok = $stmt->execute();
    $stmt->close();
    if (!$ok) out(false, ['error' => 'Could not create user.'], 500);
    log_activity($db, 'user_created', "Created user: $name ($role)");
    out(true, ['message' => 'User created.']);

/* ── UPDATE USER ROLE / STATUS (admin only) ────────────────── */
case 'update_user':
    $admin  = require_admin();
    $id     = (int)($input['id']     ?? 0);
    $role   = trim($input['role']    ?? '');
    $status = trim($input['status']  ?? '');

    if ($id <= 0) out(false, ['error' => 'Missing user id.'], 422);
    if ($id === (int)$admin['id'] && $role && $role !== 'admin')
        out(false, ['error' => "You can't remove your own admin role."], 422);

    $allowedRoles  = ['admin', 'staff', 'viewer'];
    $allowedStatus = ['active', 'disabled'];
    if ($role   && !in_array($role,   $allowedRoles,  true)) out(false, ['error' => 'Bad role.'], 422);
    if ($status && !in_array($status, $allowedStatus, true)) out(false, ['error' => 'Bad status.'], 422);

    // only touch users in the admin's own barangay
    $bid  = (int)$admin['barangay_id'];
    $stmt = $db->prepare(
        'UPDATE users SET role = COALESCE(NULLIF(?,""), role),
                          status = COALESCE(NULLIF(?,""), status)
           WHERE id = ? AND barangay_id = ?'
    );
    $stmt->bind_param('ssii', $role, $status, $id, $bid);
    $ok = $stmt->execute();
    $stmt->close();
    if (!$ok) out(false, ['error' => 'Update failed.'], 500);
    log_activity($db, 'user_updated', "Updated user #$id (role=$role, status=$status)");
    out(true, ['message' => 'User updated.']);

/* ── ACTIVITY LOG (admin only, own barangay) ───────────────── */
case 'activity_log':
    $admin = require_admin();
    $bid   = (int)$admin['barangay_id'];
    $limit = min(200, max(1, (int)($_GET['limit'] ?? 50)));
    $stmt  = $db->prepare(
        'SELECT user_name, action, detail, ip_address, created_at
           FROM activity_log
          WHERE barangay_id = ? OR barangay_id IS NULL
          ORDER BY created_at DESC
          LIMIT ?'
    );
    $stmt->bind_param('ii', $bid, $limit);
    $stmt->execute();
    $res = $stmt->get_result();
    $log = [];
    while ($r = $res->fetch_assoc()) $log[] = $r;
    $stmt->close();
    out(true, ['log' => $log]);

/* ── STAFF STATS (admin only) ──────────────────────────────── */
case 'staff_stats':
    $admin = require_admin();
    $bid   = (int)$admin['barangay_id'];
    // cases handled = complaints where this user is the assigned officer
    $stmt = $db->prepare(
        'SELECT u.id, u.full_name, u.role,
                COUNT(c.id)                                    AS total_cases,
                SUM(c.status = "Resolved")                     AS resolved_cases
           FROM users u
           LEFT JOIN complaints c
                  ON c.officer = u.full_name AND c.barangay_id = u.barangay_id
          WHERE u.barangay_id = ? AND u.role IN ("admin","staff")
          GROUP BY u.id, u.full_name, u.role
          ORDER BY total_cases DESC'
    );
    $stmt->bind_param('i', $bid);
    $stmt->execute();
    $res   = $stmt->get_result();
    $stats = [];
    while ($r = $res->fetch_assoc()) $stats[] = $r;
    $stmt->close();
    out(true, ['stats' => $stats]);

default:
    out(false, ['error' => 'Unknown action.'], 400);
}