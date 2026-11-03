// Podbija ?v= przy plikach CSS/JS w index.html i admin.html, zeby przegladarki
// nie braly starych plikow z pamieci po aktualizacji strony (GitHub Pages trzyma je 10 min).
// Uzycie (z folderu projektu): node docs/wersja.js
const fs = require('node:fs');
const path = require('node:path');

const v = Date.now().toString(36);
for (const file of ['index.html', 'admin.html']) {
  const p = path.join(__dirname, file);
  const html = fs.readFileSync(p, 'utf8')
    .replace(/((?:href|src)="(?:css|js)\/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?"/g, `$1?v=${v}"`);
  fs.writeFileSync(p, html);
}
console.log(`Wersja plikow: ${v}`);
