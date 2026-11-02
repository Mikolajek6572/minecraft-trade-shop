// Tworzy admina albo zmienia mu haslo w bazie na Cloudflare:
//   npm run admin -- <login>            (zapyta o haslo, nie wyswietla go)
//   npm run admin -- <login> --local    (baza lokalna do wrangler dev)
// Haslo jest hashowane tutaj, na Twoim komputerze. Do Cloudflare idzie tylko hash.
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ITER = 100_000;

function askHidden(question) {
  process.stdout.write(question);
  return new Promise((resolve) => {
    let value = '';
    const stdin = process.stdin;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') process.exit(1);
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const args = process.argv.slice(2);
const local = args.includes('--local');
const username = args.find((a) => !a.startsWith('--'));
if (!username || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
  console.log('Uzycie: npm run admin -- <login> [--local]   (login: 3-32 znaki, litery, cyfry, _ . -)');
  process.exit(1);
}

const password = await askHidden('Haslo (min 10 znakow): ');
if (password.length < 10) { console.error('Haslo musi miec min 10 znakow'); process.exit(1); }
const again = await askHidden('Powtorz haslo: ');
if (again !== password) { console.error('Hasla sie roznia'); process.exit(1); }

const salt = crypto.randomBytes(16);
const hash = `pbkdf2$${ITER}$${salt.toString('hex')}$${crypto.pbkdf2Sync(password, salt, ITER, 32, 'sha256').toString('hex')}`;

// Plik SQL zamiast --command, zeby nic nie trafilo do historii konsoli
const dir = mkdtempSync(join(tmpdir(), 'mts-'));
const file = join(dir, 'admin.sql');
writeFileSync(file, `INSERT INTO admins (username, password_hash) VALUES ('${username}', '${hash}')
  ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash;
DELETE FROM sessions WHERE admin_id = (SELECT id FROM admins WHERE username = '${username}');
`);
const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'minecraft-trade-shop', local ? '--local' : '--remote', `--file=${file}`, '--yes'],
  { stdio: 'inherit', shell: true });
unlinkSync(file);
if (r.status === 0) console.log(`\nGotowe: admin "${username}" moze sie logowac.`);
process.exit(r.status ?? 1);
