<?php
// api/load_project.php — loads JSON by id
require_once __DIR__ . '/csp_headers.php';
header('Content-Type: application/json; charset=utf-8');

$input = json_decode(file_get_contents('php://input'), true);
if(!$input || !isset($input['id'])) { http_response_code(400); echo json_encode(['error'=>'Missing id']); exit; }
$id = preg_replace('/[^a-zA-Z0-9\-]/', '', $input['id']);

$path = __DIR__ . '/data/' . $id . '.json';
if(!file_exists($path)){ http_response_code(404); echo json_encode(['error'=>'Not found']); exit; }
echo file_get_contents($path);
?>
