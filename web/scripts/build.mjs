import { build } from 'esbuild';
import { mkdir, readFile, readdir, rm, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
await mkdir('.generated', { recursive: true });
const data = {};
for (const dir of ['cmaps', 'standard_fonts']) {
  data[dir] = {};
  for (const file of (await readdir(`node_modules/pdfjs-dist/${dir}`)).sort()) {
    if (file.endsWith('.bcmap') || /\.(pfb|ttf)$/.test(file)) {
      data[dir][file] = (await readFile(`node_modules/pdfjs-dist/${dir}/${file}`)).toString('base64');
    }
  }
}
await writeFile('.generated/pdf-data.js', `export default ${JSON.stringify(data)};\n`);
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({ entryPoints: { app: 'src/app.js', worker: 'src/worker.js' }, outdir: 'dist', bundle: true,
  minify: true, sourcemap: false, platform: 'browser', format: 'esm', target: ['chrome120', 'edge120'],
  legalComments: 'external', define: { 'process.env.NODE_ENV': '"production"' } });
for (const file of ['index.html', 'style.css', 'privacy.html']) await copyFile(file, path.join('dist', file));
await writeFile('dist/.nojekyll', '');
await copyFile('README.md', 'dist/DEPLOYMENT.md');
await mkdir('dist/licenses', { recursive: true });
for (const [label, dir] of Object.entries({
  pdfjs: 'node_modules/pdfjs-dist', pdf_cmaps: 'node_modules/pdfjs-dist/cmaps', pdf_fonts: 'node_modules/pdfjs-dist/standard_fonts',
  exceljs: 'node_modules/exceljs', xmldom: 'node_modules/@xmldom/xmldom', decimal: 'node_modules/decimal.js', fflate: 'node_modules/fflate',
})) for (const file of await readdir(dir, { withFileTypes: true })) {
  if (file.isFile() && /^licen[cs]e/i.test(file.name)) await copyFile(path.join(dir, file.name), `dist/licenses/${label}-${file.name}`);
}
// 코드/리소스는 함께 배포하며 시험 파일이나 결과는 포함하지 않는다.
console.log('정적 웹 빌드 완료: web/dist (외부 CDN/서버 API 불필요)');

