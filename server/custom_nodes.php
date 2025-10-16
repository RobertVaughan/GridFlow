<?php
// Minimal custom-node service for WAMP64 / shared hosting.
// Endpoints:
//   GET  ?action=list
//   GET  ?action=manifest&id=<pkgId>
//   POST ?action=run  body: { id, nodeType, inputs, state, metadata }

header('Content-Type: application/json');

$BASE = realpath(__DIR__ . '/../custom-nodes');
if ($BASE === false) {
  http_response_code(500);
  echo json_encode(["error"=>"custom-nodes folder missing"]);
  exit;
}

$action = $_GET['action'] ?? 'list';

function load_json_file($path) {
  if (!is_file($path)) return null;
  $txt = file_get_contents($path);
  return json_decode($txt, true);
}

function find_package_dir($id, $BASE) {
  // Each sub-folder may be a package (no central index needed for your structure)
  $dir = realpath($BASE . '/' . $id);
  if ($dir && str_starts_with($dir, $BASE)) return $dir;
  return null;
}

if ($action === 'list') {
  // List all subdirectories with a manifest.json
  $out = ["packages" => []];
  foreach (scandir($BASE) as $entry) {
    if ($entry === '.' || $entry === '..') continue;
    $dir = $BASE . '/' . $entry;
    if (is_dir($dir) && is_file($dir . '/manifest.json')) {
      $mf = load_json_file($dir . '/manifest.json');
      if ($mf && isset($mf['id'])) {
        $out["packages"][] = ["id" => $mf['id'], "title" => $mf['title'] ?? $mf['id']];
      }
    }
  }
  echo json_encode($out);
  exit;
}

if ($action === 'manifest') {
  $id = $_GET['id'] ?? '';
  $dir = find_package_dir($id, $BASE);
  if (!$dir) { http_response_code(404); echo json_encode(["error"=>"package not found"]); exit; }
  $mf = load_json_file($dir . '/manifest.json');
  if (!$mf) { http_response_code(404); echo json_encode(["error"=>"manifest missing"]); exit; }
  echo json_encode($mf);
  exit;
}

if ($action === 'run') {
  $input = json_decode(file_get_contents('php://input'), true);
  $id = $input['id'] ?? '';
  $nodeType = $input['nodeType'] ?? '';
  $nodeInputs = $input['inputs'] ?? [];
  $state = $input['state'] ?? [];
  $metadata = $input['metadata'] ?? [];

  $dir = find_package_dir($id, $BASE);
  if (!$dir) { http_response_code(404); echo json_encode(["error"=>"package not found"]); exit; }

  $mf = load_json_file($dir . '/manifest.json');
  if (!$mf) { http_response_code(404); echo json_encode(["error"=>"manifest missing"]); exit; }

  if (($mf['language'] ?? '') !== 'python') {
    http_response_code(400); echo json_encode(["error"=>"only python language supported in php runner"]); exit;
  }

  $entry = $dir . '/' . ($mf['entry'] ?? 'runner.py');
  if (!is_file($entry)) { http_response_code(404); echo json_encode(["error"=>"entry script not found"]); exit; }

  $python = 'python'; // Adjust to full path if needed on Windows

  $cmd = [$python, $entry];
  $descriptorspec = [
    0 => ["pipe", "r"], // stdin
    1 => ["pipe", "w"], // stdout
    2 => ["pipe", "w"]  // stderr
  ];
  $proc = proc_open($cmd, $descriptorspec, $pipes, $dir, null);
  if (!is_resource($proc)) { http_response_code(500); echo json_encode(["error"=>"proc_open failed"]); exit; }

  $payload = json_encode([
    "nodeType" => $nodeType,
    "inputs" => $nodeInputs,
    "state" => $state,
    "metadata" => $metadata
  ], JSON_UNESCAPED_SLASHES);

  fwrite($pipes[0], $payload);
  fclose($pipes[0]);

  $timeout = intval($mf['timeoutSec'] ?? 30);
  $start = time();
  $stdout = '';
  $stderr = '';
  stream_set_blocking($pipes[1], false);
  stream_set_blocking($pipes[2], false);

  while (true) {
    $stdout .= stream_get_contents($pipes[1]);
    $stderr .= stream_get_contents($pipes[2]);
    $status = proc_get_status($proc);
    if (!$status['running']) break;
    if (time() - $start > $timeout) {
      proc_terminate($proc, 9);
      http_response_code(504);
      echo json_encode(["error"=>"runner timeout", "stderr"=>$stderr]);
      fclose($pipes[1]); fclose($pipes[2]);
      exit;
    }
    usleep(20000);
  }

  fclose($pipes[1]); fclose($pipes[2]);
  $exitCode = proc_close($proc);
  if ($exitCode !== 0 && $stderr) {
    echo json_encode(["error"=>"runner exited with code $exitCode", "stderr"=>$stderr, "stdout"=>$stdout]);
    exit;
  }

  $decoded = json_decode($stdout, true);
  if ($decoded === null) {
    echo json_encode(["error"=>"invalid JSON from runner", "raw"=>$stdout, "stderr"=>$stderr]);
  } else {
    echo json_encode($decoded);
  }
  exit;
}

http_response_code(400);
echo json_encode(["error"=>"unknown action"]);