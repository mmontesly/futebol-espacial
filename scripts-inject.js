// Injeta tags de ícone/PWA para iOS no index.html exportado
const fs = require('fs'); const f = 'dist/index.html'; let h = fs.readFileSync(f, 'utf8');
const tags = '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=1"><link rel="manifest" href="/manifest.webmanifest"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Futebol Espacial"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">';
if (!h.includes('apple-touch-icon')) h = h.replace('</head>', tags + '</head>');
fs.writeFileSync(f, h);
