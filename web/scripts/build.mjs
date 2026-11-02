import { build } from 'esbuild';
import { mkdir, readFile, readdir, rm, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
const versionHash = createHash('sha256');
for (const file of ['index.html','style.css','package-lock.json',...(await readdir('src')).filter(n=>n.endsWith('.js')).sort().map(n=>'src/'+n)]) {
  versionHash.update(file); versionHash.update(await readFile(file));
}
const version = versionHash.digest('hex').slice(0,16);
await build({ entryPoints: { app: 'src/app.js', worker: 'src/worker.js' }, outdir: 'dist', bundle: true,
  splitting: true, chunkNames: 'shared-[hash]', minify: true, sourcemap: false, platform: 'browser', format: 'esm', target: ['chrome120', 'edge120'],
  legalComments: 'external', define: { 'process.env.NODE_ENV': '"production"', '__APP_VERSION__':JSON.stringify(version) } });
await copyFile('style.css','dist/style.css');
for (const file of ['index.html','privacy.html']) {
  const content = (await readFile(file,'utf8')).replace('href="./style.css"',`href="./style.css?v=${version}"`).replace('src="./app.js"',`src="./app.js?v=${version}"`);
  await writeFile(path.join('dist',file),content);
}
await writeFile('dist/.nojekyll', '');
await copyFile('README.md', 'dist/DEPLOYMENT.md');
await copyFile('AI-REVIEW.md', 'dist/AI-REVIEW.md');
await mkdir('dist/samples', {recursive:true});
for (const file of ['ai_review_fixture.pdf','ai_review_fixture.png','ai_info_fixture.xlsx']) await copyFile('../samples/'+file,'dist/samples/'+file);
await mkdir('dist/licenses', { recursive: true });
for (const [label, dir] of Object.entries({
  pdfjs: 'node_modules/pdfjs-dist', pdf_cmaps: 'node_modules/pdfjs-dist/cmaps', pdf_fonts: 'node_modules/pdfjs-dist/standard_fonts',
  exceljs: 'node_modules/exceljs', xmldom: 'node_modules/@xmldom/xmldom', decimal: 'node_modules/decimal.js', fflate: 'node_modules/fflate',
  hwp_convert:'node_modules/hwp-convert', cfb:'node_modules/cfb',
})) for (const file of await readdir(dir, { withFileTypes: true })) {
  if (file.isFile() && /^(licen[cs]e|notice)/i.test(file.name)) await copyFile(path.join(dir, file.name), `dist/licenses/${label}-${file.name}`);
}
// 코드/리소스는 함께 배포하며 시험 파일이나 결과는 포함하지 않는다.
console.log(`정적 웹 빌드 완료: web/dist · ${version} (문서 대조는 로컬 / Gemini 검토는 명시적 선택 시 Google API)`);

