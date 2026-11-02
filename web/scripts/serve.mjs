// 개발/검증 전용 정적 서버. 파일 업로드/POST/API/문서 저장 경로가 없다.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf':'application/pdf', '.png':'image/png', '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  try {
    const url = new URL(req.url, 'http://local.invalid');
    const pathname = decodeURIComponent(url.pathname);
    const target = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    if (!(await stat(target)).isFile()) throw new Error('not file');
    res.setHeader('Content-Type', types[path.extname(target)] ?? 'application/octet-stream');
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? undefined : await readFile(target));
  } catch { res.writeHead(404); res.end(); }
}).listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log('정적 검증 서버 준비 완료'));

