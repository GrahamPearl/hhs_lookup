<?php
/**
 * Teacher Print Queue — PHP API
 * Single-file REST API for cross-machine shared state.
 *
 * Endpoints:
 *   GET    /api/?resource=jobs            → all jobs array
 *   POST   /api/?resource=jobs            → replace entire jobs array + idcounter
 *   GET    /api/?resource=settings        → settings object
 *   POST   /api/?resource=settings        → replace settings object
 *   GET    /api/?resource=notes           → all notes object  {ref: text}
 *   POST   /api/?resource=notes           → replace notes object
 *   GET    /api/?resource=teachers        → teachers array
 *   POST   /api/?resource=teachers        → replace teachers array
 *   GET    /api/?resource=teacher_emails  → teacher→email map
 *   POST   /api/?resource=teacher_emails  → replace teacher→email map
 *   GET    /api/?resource=grade_list      → grade list array
 *   POST   /api/?resource=grade_list      → replace grade list
 *   GET    /api/?resource=audit_log       → audit log array
 *   POST   /api/?resource=audit_log       → append entry to audit log
 *   GET    /api/?resource=deletion_log    → deletion log array
 *   POST   /api/?resource=deletion_log    → append entry to deletion log
 *   GET    /api/?resource=ping            → {"ok":true, "ts": <ms>}
 */

/* ── CORS — allow same-origin and LAN requests ── */
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ── Data directory (one level above webroot is ideal; adjust if needed) ── */
define('DATA_DIR', __DIR__ . '/data/');

if (!is_dir(DATA_DIR)) {
    mkdir(DATA_DIR, 0755, true);
}

/* ── Helpers ── */
function dataFile(string $name): string {
    // Whitelist resource names → filenames
    $map = [
        'jobs'           => 'jobs.json',
        'settings'       => 'settings.json',
        'notes'          => 'notes.json',
        'teachers'       => 'teachers.json',
        'teacher_emails' => 'teacher_emails.json',
        'grade_list'     => 'grade_list.json',
        'audit_log'      => 'audit_log.json',
        'deletion_log'   => 'deletion_log.json',
        'idcounter'      => 'idcounter.json',
    ];
    if (!isset($map[$name])) return '';
    return DATA_DIR . $map[$name];
}

function readData(string $resource, $default = null) {
    $file = dataFile($resource);
    if (!$file || !file_exists($file)) return $default;
    $raw = file_get_contents($file);
    $decoded = json_decode($raw, true);
    return ($decoded !== null) ? $decoded : $default;
}

function writeData(string $resource, $data): bool {
    $file = dataFile($resource);
    if (!$file) return false;
    // Atomic write via temp file
    $tmp = $file . '.tmp.' . getmypid();
    $ok  = file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    if ($ok === false) return false;
    return rename($tmp, $file);
}

function jsonBody(): ?array {
    $raw = file_get_contents('php://input');
    if (!$raw) return null;
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : null;
}

function respond(int $code, $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/* ── Router ── */
$resource = trim($_GET['resource'] ?? '');
$method   = $_SERVER['REQUEST_METHOD'];

/* Ping — health check */
if ($resource === 'ping') {
    respond(200, ['ok' => true, 'ts' => round(microtime(true) * 1000)]);
}

/* Validate resource */
$valid = ['jobs','settings','notes','teachers','teacher_emails','grade_list','audit_log','deletion_log'];
if (!in_array($resource, $valid, true)) {
    respond(400, ['error' => 'Unknown resource: ' . htmlspecialchars($resource)]);
}

/* ── GET ── */
if ($method === 'GET') {
    $defaults = [
        'jobs'           => [],
        'settings'       => (object)[],
        'notes'          => (object)[],
        'teachers'       => [],
        'teacher_emails' => (object)[],
        'grade_list'     => [],
        'audit_log'      => [],
        'deletion_log'   => [],
    ];
    $data = readData($resource, $defaults[$resource]);
    respond(200, ['ok' => true, 'data' => $data]);
}

/* ── POST ── */
if ($method === 'POST') {
    $body = jsonBody();
    if ($body === null) {
        respond(400, ['error' => 'Invalid or missing JSON body']);
    }

    /* Append-only resources */
    if (in_array($resource, ['audit_log', 'deletion_log'], true)) {
        // Body should be a single entry object with an "entry" key,
        // OR the full log array for a bulk replace.
        if (isset($body['entry']) && is_array($body['entry'])) {
            $log = readData($resource, []);
            $log[] = $body['entry'];
            // Keep logs bounded
            $limit = ($resource === 'audit_log') ? 2000 : 500;
            if (count($log) > $limit) {
                array_splice($log, 0, count($log) - $limit);
            }
            writeData($resource, $log);
            respond(200, ['ok' => true]);
        }
        // Fall through: allow full replace (used during sync)
    }

    /* Jobs: also persist idcounter alongside */
    if ($resource === 'jobs') {
        if (!isset($body['jobs']) || !is_array($body['jobs'])) {
            respond(400, ['error' => 'Expected {jobs: [], idcounter: n}']);
        }
        writeData('jobs', $body['jobs']);
        if (isset($body['idcounter'])) {
            writeData('idcounter', intval($body['idcounter']));
        }
        respond(200, ['ok' => true]);
    }

    /* Generic full-replace for all other resources */
    if (!isset($body['data'])) {
        respond(400, ['error' => 'Expected {data: ...}']);
    }
    writeData($resource, $body['data']);
    respond(200, ['ok' => true]);
}

respond(405, ['error' => 'Method not allowed']);
