// Cloudflare Pages 會自動執行：npm install && npm run build
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import Babel from '@babel/standalone';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

const src = fs.readFileSync(path.join(ROOT, '_source.html'), 'utf8');
const m = src.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/);
if (!m) throw new Error('找不到 <script type="text/babel"> 區塊');

const compiled = Babel.transform(m[1], { presets: ['react'] }).code;
console.log(`JSX: ${m[1].length} → ${compiled.length} chars`);

execSync('npx tailwindcss -c tailwind.config.js -i tailwind-input.css -o dist/tailwind.css --minify', { cwd: ROOT, stdio: 'inherit' });
const tw = fs.readFileSync(path.join(DIST, 'tailwind.css'), 'utf8');

const lib = (n) => fs.readFileSync(path.join(ROOT, 'libs', n), 'utf8');
const react = lib('react.js');
const reactDom = lib('react-dom.js');
const chart = lib('chart.js');
const adapter = lib('adapter.js');

const scriptRepl = `<script>\n${react}\n</script>\n<script>\n${reactDom}\n</script>\n<script>\n${chart}\n</script>\n<script>\n${adapter}\n</script>\n<script>\n${compiled}\n</script>`;
let out = src.replace(/<\/style>/, () => `</style>\n<style>${tw}</style>`);
out = out.replace(/<script type="text\/babel"[^>]*>[\s\S]*?<\/script>/, () => scriptRepl);
fs.writeFileSync(path.join(DIST, 'index.html'), out);
fs.rmSync(path.join(DIST, 'tailwind.css'));
console.log(`✅ dist/index.html ${(out.length/1024).toFixed(1)} KB`);
