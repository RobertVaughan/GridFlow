<?php
/**
 * custom-nodes/registry.php
 * Lists available custom node packs and their nodes by scanning:
 *   /custom-nodes/<pack>/{manifest.json, requirements.txt, runner.py}
 *
 * Response (JSON):
 * {
 *   "packs": [
 *     {
 *       "slug": "gridflow-ollama",
 *       "name": "Ollama",
 *       "version": "1.0.0",
 *       "runner": "runner.py",
 *       "has_requirements": true,
 *       "requirements_hash": "<sha1>",
 *       "nodes": [
 *         { "type":"ollama.model", "title":"Ollama Model", "inspector":[...], "inputs":[...], "outputs":[...] },
 *         ...
 *       ]
 *     },
 *     ...
 *   ]
 * }
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

$ROOT = realpath(__DIR__ . DIRECTORY_SEPARATOR . "..");               // /custom-nodes/..
$BASE = realpath(__DIR__);                                            // /custom-nodes
if ($BASE === false) { echo json_encode(["packs"=>[]]); exit; }

function is_safe_dir($dir) {
  global $BASE;
  $r = realpath($dir);
  return $r !== false && str_starts_with($r, $BASE);
}

function read_json($path) {
  if (!is_file($path)) return null;
  $s = @file_get_contents($path);
  if ($s === false) return null;
  $j = json_decode($s, true);
  return is_array($j) ? $j : null;
}

$packs = [];
$dirs = glob($BASE . DIRECTORY_SEPARATOR . "*", GLOB_ONLYDIR);
foreach ($dirs as $packDir) {
  if (!is_safe_dir($packDir)) continue;
  $manifestPath = $packDir . DIRECTORY_SEPARATOR . "manifest.json";
  $runnerPath   = $packDir . DIRECTORY_SEPARATOR . "runner.py";
  $reqPath      = $packDir . DIRECTORY_SEPARATOR . "requirements.txt";

  $manifest = read_json($manifestPath);
  if (!$manifest) continue;

  $slug = basename($packDir);
  $name = $manifest["name"] ?? $slug;
  $version = $manifest["version"] ?? "0.0.0";
  $nodes = $manifest["nodes"] ?? [];
  if (!is_array($nodes)) $nodes = [];

  // Basic normalization
  foreach ($nodes as &$n) {
    $n["type"] = $n["type"] ?? "";
    $n["title"] = $n["title"] ?? $n["type"];
    $n["pack"] = $name;
    $n["slug"] = $slug;
    $n["runner"] = $manifest["runner"] ?? "runner.py";
    $n["inspector"] = $n["inspector"] ?? [];
    $n["inputs"] = $n["inputs"] ?? [];
    $n["outputs"] = $n["outputs"] ?? [];
  }

  $requirements_hash = null;
  $has_requirements = is_file($reqPath);
  if ($has_requirements) {
    $buf = @file_get_contents($reqPath);
    if ($buf !== false) $requirements_hash = sha1($buf);
  }

  $packs[] = [
    "slug" => $slug,
    "name" => $name,
    "version" => $version,
    "runner" => is_file($runnerPath) ? "runner.py" : null,
    "has_requirements" => $has_requirements,
    "requirements_hash" => $requirements_hash,
    "nodes" => $nodes
  ];
}

echo json_encode(["packs" => $packs], JSON_UNESCAPED_SLASHES);
