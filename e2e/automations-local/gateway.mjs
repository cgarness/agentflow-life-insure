// Only GoTrue and PostgREST are reachable on the internal Docker network.
// A loopback API and local forwards preserve isolation on daemons that disable
// published ports on internal-only networks.
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';

const auth = process.env.LOCAL_AUTH_CONTAINER;
const rest = process.env.LOCAL_REST_CONTAINER;
if (!auth || !rest) throw Error('Local fixture container names required');
for (const [port, host, dest] of [[54333,auth,9999],[54334,rest,3000]]) {
  net.createServer(socket => {
    const child = spawn('docker',['exec','-i',auth,'nc',host,String(dest)]);
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
    child.on('close',() => socket.end());
    socket.on('close',() => child.kill());
    socket.on('error',() => socket.destroy());
    child.stdin.on('error',() => socket.destroy());
  }).listen(port,'127.0.0.1');
}
const routes = new Map([['/auth/v1',54333],['/rest/v1',54334]]);
http.createServer(async (req,res) => {
  const cors = {
    'Access-Control-Allow-Origin':'http://127.0.0.1:8089',
    'Access-Control-Allow-Headers':req.headers['access-control-request-headers'] || '*',
    'Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
    'Access-Control-Expose-Headers':'content-range,range,x-client-info',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204,cors).end(); return; }
  const prefix = [...routes.keys()].find(k => req.url.startsWith(k+'/'));
  if (!prefix) { res.writeHead(404,cors).end(); return; }
  // The client's streaming/keep-alive headers do not carry across these per-request tunnels.
  const forwarded = ['apikey','authorization','content-type','accept','prefer','range','accept-profile','content-profile'];
  const headers = Object.fromEntries(forwarded.filter(k => req.headers[k]).map(k=>[k,req.headers[k]]));
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  headers['content-length'] = body.length;
  const next = http.request({
    hostname:'127.0.0.1',port:routes.get(prefix),path:req.url.slice(prefix.length),
    method:req.method,headers:{...headers,connection:'close'},agent:false,
  }, response => {
    const outgoing = {...cors};
    for (const name of ['content-type','content-range','www-authenticate','location']) {
      if (response.headers[name]) outgoing[name] = response.headers[name];
    }
    res.writeHead(response.statusCode,outgoing);
    response.pipe(res);
  });
  next.on('error',()=>res.writeHead(502,cors).end());
  next.setTimeout(15000,()=>next.destroy(new Error('Local upstream timed out')));
  next.end(body);
}).listen(54340,'127.0.0.1');
