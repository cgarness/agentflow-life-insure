import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';

export async function serveCutover(output) {
  let candidate = false;
  const mime = {'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json',
    '.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webp':'image/webp','.woff2':'font/woff2'};
  const server = createServer(async (req,res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
      const current = candidate ? 'candidate' : 'legacy';
      const asset = extname(pathname) ? pathname.slice(1) : 'index.html';
      const roots = candidate && asset.startsWith('assets/') ? ['candidate','legacy'] : [current];
      for (const name of roots) {
        const root = resolve(output,name+'-dist');
        const path = resolve(root,asset);
        if (!path.startsWith(root+sep)) break;
        try {
          const data = await readFile(path);
          res.writeHead(200,{'Content-Type':mime[extname(path)] ?? 'application/octet-stream',
            'Cache-Control':'no-store','X-Local-Test-Build':name}).end(data);
          return;
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      res.writeHead(404).end();
    } catch { res.writeHead(400).end(); }
  });
  await new Promise((done,fail) => server.once('error',fail).listen(8089,'127.0.0.1',done));
  return {promote: () => {candidate=true;}, close: () => new Promise(resolve => server.close(resolve))};
}
