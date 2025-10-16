<?php
// api/list_projects.php — list saved projects
require_once __DIR__ . '/csp_headers.php';
header('Content-Type: application/json; charset=utf-8');
$dir = __DIR__ . '/data';
if(!is_dir($dir)) { echo json_encode(['items'=>[]]); exit; }
$items = [];
foreach(glob($dir.'/*.json') as $file){
  $j = json_decode(file_get_contents($file), true);
  $items[] = ['id'=>basename($file, '.json'), 'name'=>$j['graph']['name'] ?? 'Untitled', 'updatedAt'=>$j['graph']['updatedAt'] ?? null];
}
usort($items, function($a,$b){ return strcmp($b['updatedAt'] ?? '', $a['updatedAt'] ?? ''); });
echo json_encode(['items'=>$items]);
?>
