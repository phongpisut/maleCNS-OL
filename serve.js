// Tiny static server: node serve.js  (PORT env var, default 5173)
const http = require('http'), fs = require('fs'), path = require('path');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = +process.env.PORT || 5173;
http.createServer((req, res) => {
  const p = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log(`Fruity OL on http://localhost:${port}`));
