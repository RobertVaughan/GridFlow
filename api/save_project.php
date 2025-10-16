<?php
// api/save_project.php — stores JSON to disk with simple RBAC placeholder
require_once __DIR__ . '/csp_headers.php';
header('Content-Type: application/json; charset=utf-8');

$input = json_decode(file_get_contents('php://input'), true);
if(!$input || !isset($input['graph'])) { http_response_code(400); echo json_encode(['error'=>'Missing graph']); exit; }

$graph = $input['graph'];
if(!isset($graph['id'])) { http_response_code(400); echo json_encode(['error'=>'Graph.id required']); exit; }

$dir = __DIR__ . '/data';
if(!is_dir($dir)) mkdir($dir, 0775, true);

$id = preg_replace('/[^a-zA-Z0-9\-]/', '', $graph['id']);
$path = $dir . '/' . $id . '.json';

$graph['updatedAt'] = date('c');
file_put_contents($path, json_encode(['graph'=>$graph], JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES));

echo json_encode(['ok'=>true, 'id'=>$id, 'name'=>($graph['name']??'Untitled')]);
?>
