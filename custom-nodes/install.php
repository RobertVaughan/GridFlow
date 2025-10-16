<?php
/**
 * custom-nodes/install.php
 * POST JSON: { "slug": "<pack-slug>" }
 * Runs: python -m pip install -r /custom-nodes/<slug>/requirements.txt
 *
 * Returns JSON: { ok:true, log:"...", code:0 } or { ok:false, error:"..." }
 */

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

$BASE = realpath(__DIR__);

function bad($msg, $code=400) {
  http_response_code($code);
  echo json_encode(["ok"=>false, "error"=>$msg], JSON_UNESCAPED_SLASHES);
  exit;
}
function isWindows(): bool {
  return strtoupper(substr(PHP_OS, 0, 3)) === 'WIN';
}

// Read input
$raw = file_get_contents('php://input');
if ($raw === false || trim($raw)==="") bad("No input");
$in = json_decode($raw, true);
if (!$in || !isset($in["slug"])) bad("Missing slug");
$slug = preg_replace('~[^a-zA-Z0-9._-]~','', $in["slug"]);
$dir = realpath($BASE . DIRECTORY_SEPARATOR . $slug);
if ($dir === false || !str_starts_with($dir, $BASE)) bad("Invalid pack");

// Check requirements
$req = $dir . DIRECTORY_SEPARATOR . "requirements.txt";
if (!is_file($req)) bad("No requirements.txt", 404);

// Choose python
$candidates = isWindows() ? ['py -3', 'python', 'python3'] : ['python3', 'python'];
$python = null;
foreach ($candidates as $cand) {
  @exec($cand . ' -V', $o, $c);
  if ($c === 0) { $python = $cand; break; }
}
if (!$python) bad("No Python interpreter found on server", 500);

// Build command
$cmd = $python . " -m pip install -r " . escapeshellarg($req);
// Use proc_open for better control
$desc = [
  0 => ['pipe','r'],
  1 => ['pipe','w'],
  2 => ['pipe','w'],
];
$proc = proc_open($cmd, $desc, $pipes, $dir);
if (!is_resource($proc)) bad("Failed to start pip", 500);

// no stdin
fclose($pipes[0]);

stream_set_blocking($pipes[1], false);
stream_set_blocking($pipes[2], false);

$start = microtime(true);
$log = '';
$err = '';
$TIMEOUT = 180; // 3 minutes

while (true) {
  $log .= stream_get_contents($pipes[1]) ?: '';
  $err .= stream_get_contents($pipes[2]) ?: '';

  $status = proc_get_status($proc);
  if (!$status['running']) break;

  if ((microtime(true) - $start) > $TIMEOUT) {
    proc_terminate($proc);
    echo json_encode(["ok"=>false, "error"=>"pip timeout", "log"=>$log, "stderr"=>$err]);
    exit;
  }
  usleep(50000);
}
fclose($pipes[1]); fclose($pipes[2]);
$exit = proc_close($proc);

if ($exit !== 0) {
  echo json_encode(["ok"=>false, "error"=>"pip exited with $exit", "log"=>$log, "stderr"=>$err, "code"=>$exit]);
  exit;
}
echo json_encode(["ok"=>true, "log"=>$log, "code"=>$exit]);
