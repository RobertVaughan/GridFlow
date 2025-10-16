<?php
/**
 * custom-nodes/runner.php
 * POST JSON: { "slug": "<pack-slug>", "payload": { ... forwarded to runner.py stdin ... } }
 * Runs: python /custom-nodes/<slug>/runner.py
 * Returns runner's JSON.
 */

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

$BASE = realpath(__DIR__);

function bad($msg, $code=400) {
  http_response_code($code);
  echo json_encode(["error"=>$msg], JSON_UNESCAPED_SLASHES);
  exit;
}
function isWindows(): bool {
  return strtoupper(substr(PHP_OS, 0, 3)) === 'WIN';
}

$raw = file_get_contents('php://input');
if ($raw === false || trim($raw)==="") bad("No input");
$req = json_decode($raw, true);
if (!$req) bad("Invalid JSON");
$slug = preg_replace('~[^a-zA-Z0-9._-]~','', $req["slug"] ?? "");
if ($slug === "") bad("Missing slug");

$dir = realpath($BASE . DIRECTORY_SEPARATOR . $slug);
if ($dir === false || !str_starts_with($dir, $BASE)) bad("Invalid pack");
$runner = $dir . DIRECTORY_SEPARATOR . "runner.py";
if (!is_file($runner)) bad("runner.py not found for pack '$slug'", 404);

$payload = $req["payload"] ?? [];

$candidates = isWindows() ? ['py -3', 'python', 'python3'] : ['python3', 'python'];
$python = null;
foreach ($candidates as $cand) {
  @exec($cand . ' -V', $o, $c);
  if ($c === 0) { $python = $cand; break; }
}
if (!$python) bad("No Python interpreter found on server", 500);

$desc = [
  0 => ['pipe','r'],
  1 => ['pipe','w'],
  2 => ['pipe','w']
];
$cmd = $python . " " . escapeshellarg($runner);

$proc = proc_open($cmd, $desc, $pipes, $dir);
if (!is_resource($proc)) bad("Failed to start runner", 500);

// stdin
fwrite($pipes[0], json_encode($payload));
fclose($pipes[0]);

stream_set_blocking($pipes[1], false);
stream_set_blocking($pipes[2], false);

$start = microtime(true);
$TIMEOUT = 120;
$out = '';
$err = '';

while (true) {
  $out .= stream_get_contents($pipes[1]) ?: '';
  $err .= stream_get_contents($pipes[2]) ?: '';

  $status = proc_get_status($proc);
  if (!$status['running']) break;

  if ((microtime(true) - $start) > $TIMEOUT) {
    proc_terminate($proc);
    echo json_encode(["error"=>"runner timeout", "stderr"=>$err]);
    exit;
  }
  usleep(30000);
}

fclose($pipes[1]); fclose($pipes[2]);
$code = proc_close($proc);

if ($code !== 0 && trim($out) === '') {
  echo json_encode(["error"=>"runner exited with code $code", "stderr"=>$err, "code"=>$code]);
  exit;
}

$decoded = json_decode($out, true);
if ($decoded === null) {
  echo json_encode(["error"=>"invalid JSON from runner", "raw"=>$out, "stderr"=>$err], JSON_UNESCAPED_SLASHES);
  exit;
}
echo json_encode($decoded, JSON_UNESCAPED_SLASHES);
