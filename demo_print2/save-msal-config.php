<?php
// Restrict to localhost only (basic safety)
$remote = $_SERVER['REMOTE_ADDR'] ?? '';
if (!in_array($remote, ['127.0.0.1', '::1'])) {
  http_response_code(403);
  echo "Forbidden";
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo "Method Not Allowed";
  exit;
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!$data) {
  http_response_code(400);
  echo "Invalid JSON";
  exit;
}

// Minimal validation
$required = ['clientId','tenantId','redirectUri','scopes','senderMailbox','saveToSentItems'];
foreach ($required as $k) {
  if (!array_key_exists($k, $data)) {
    http_response_code(400);
    echo "Missing: $k";
    exit;
  }
}

file_put_contents(__DIR__ . '/msal-config.json', json_encode($data, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES));
echo "OK";