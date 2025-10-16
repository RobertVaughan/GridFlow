<?php
// api/csp_headers.php — Strict CSP for API responses
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
header("X-Content-Type-Options: nosniff");
header("X-Frame-Options: DENY");
header("Referrer-Policy: no-referrer");
header("Cross-Origin-Opener-Policy: same-origin");
header("Cross-Origin-Resource-Policy: same-origin");
header("Cross-Origin-Embedder-Policy: require-corp");
?>