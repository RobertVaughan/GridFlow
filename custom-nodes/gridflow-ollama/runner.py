<?php
/**
 * PHP bridge to Python runner (WAMP-friendly)
 *
 * POST JSON body → stdin of runner.py → JSON stdout
 *
 * Place this file next to runner.py:
 *   custom-nodes/gridflow-ollama/runner.php
 *   custom-nodes/gridflow-ollama/runner.py
 *
 * Security notes:
 *  - No user-controlled arguments are passed to the shell.
 *  - We send the entire JSON via STDIN.
 *  - Tight timeouts and basic error handling included.
 */

declare(strict_types=1);

// ---------- config ----------
$PYTHON_CANDIDATES = ['py -3', 'python3', 'python'];
$RUNNER_PATH = __DIR__ . DIRECTORY_SEPARATOR . 'runner.py';
$TIMEOUT_SEC = 60;

// ---------- read JSON ----------
$raw = file_get_contents('php://input');
if ($raw === false) {
  http_response_code(400);
  echo json_encode(['error' => 'No input']);
  exit;
}
$payload = $raw; // Keep as raw; python reads JSON from stdin

// ---------- choose python ----------
$python = null;
foreach ($PYTHON_CANDIDATES as $cand) {
  $cmd = isWindows() ? ($cand . ' -V') : ($cand . ' -V');
  @exec($cmd, $o, $code);
  if ($code === 0) { $python = $cand; break; }
}
if ($python === null) {
  http_response_code(500);
  echo json_encode(['error' => 'No Python interpreter found (tried py -3, python3, python)']);
  exit;
}

// ---------- ensure runner exists ----------
if (!is_file($RUNNER_PATH)) {
  http_response_code(500);
  echo json_encode(['error' => 'runner.py not found']);
  exit;
}

// ---------- run process ----------
$descriptors = [
  0 => ['pipe', 'r'], // stdin
  1 => ['pipe', 'w'], // stdout
  2 => ['pipe', 'w'], // stderr
];

$cmdline = $python . ' ' . escapeshellarg($RUNNER_PATH);

$proc = proc_open($cmdline, $descriptors, $pipes, __DIR__);
if (!is_resource($proc)) {
  http_response_code(500);
  echo json_encode(['error' => 'Failed to start runner']);
  exit;
}

// Write stdin (JSON)
fwrite($pipes[0], $payload);
fclose($pipes[0]);

// Read with timeout
stream_set_blocking($pipes[1], false);
stream_set_blocking($pipes[2], false);

$start = microtime(true);
$out = '';
$err = '';
while (true) {
  $out .= stream_get_contents($pipes[1]) ?: '';
  $err .= stream_get_contents($pipes[2]) ?: '';
  $elapsed = microtime(true) - $start;
  if ($elapsed > $TIMEOUT_SEC) {
    proc_terminate($proc);
    http_response_code(504);
    echo json_encode(['error' => 'runner timeout', 'stderr' => $err]);
    exit;
  }
  $status = proc_get_status($proc);
  if (!$status['running']) {
    // drain
    $out .= stream_get_contents($pipes[1]) ?: '';
    $err .= stream_get_contents($pipes[2]) ?: '';
    break;
  }
  usleep(20000);
}

fclose($pipes[1]);
fclose($pipes[2]);
$code = proc_close($proc);

// ---------- normalize response ----------
header('Content-Type: application/json; charset=utf-8');

if ($code !== 0 && trim($out) === '') {
  echo json_encode(['error' => 'runner exited with error', 'code' => $code, 'stderr' => $err]);
  exit;
}

// If Python already sent JSON, pass it through. If not, wrap it.
$json = json_decode($out, true);
if ($json === null) {
  echo json_encode(['error' => 'invalid JSON from runner', 'raw' => $out, 'stderr' => $err]);
  exit;
}

echo json_encode($json);
exit;

// ---------- helpers ----------
function isWindows(): bool {
  return strtoupper(substr(PHP_OS, 0, 3)) === 'WIN';
}
