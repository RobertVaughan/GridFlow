<?php
// api/ollama_proxy.php
// DEV USE: forwards to local Ollama server at 127.0.0.1:11434
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Access-Control-Allow-Methods: GET,POST,OPTIONS");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$path = $_GET['path'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$base = "http://127.0.0.1:11434";

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $base . $path);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
if ($method === 'POST') {
  $body = file_get_contents('php://input');
  curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
  curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
}
$res = curl_exec($ch);
$err = curl_error($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($err) {
  http_response_code(502);
  echo json_encode(["error"=>"Proxy to Ollama failed", "detail"=>$err]);
  exit;
}
http_response_code($code ?: 200);
echo $res;