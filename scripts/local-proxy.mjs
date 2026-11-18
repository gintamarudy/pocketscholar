// Local unauthenticated forward proxy -> VM egress proxy (auth added here).
// Chromium rejects the egress proxy URL with embedded credentials
// (ERR_NO_SUPPORTED_PROXIES) and fails CONNECT without auth
// (ERR_TUNNEL_CONNECTION_FAILED), so this shim sits on 127.0.0.1:3129
// and injects Proxy-Authorization itself. Local-only, test tooling only.
// Plain-HTTP forwarding is done over a raw socket because Node 24's
// http client rejects a Host header that differs from the proxy authority.
// Usage: HTTPS_PROXY env must be set; node scripts/local-proxy.mjs
import http from 'node:http';
import net from 'node:net';

const upstream = new URL(process.env.HTTPS_PROXY || process.env.https_proxy || '');
if (!upstream.hostname) throw new Error('HTTPS_PROXY not set');
const auth = upstream.username
  ? 'Basic ' + Buffer.from(`${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`).toString('base64')
  : '';
const UP_HOST = upstream.hostname;
const UP_PORT = Number(upstream.port || 3128);

const server = http.createServer((req, res) => {
  // Plain HTTP proxy request (absolute URI) — forward over a raw socket.
  try {
    const target = new URL(req.url);
    const sock = net.connect(UP_PORT, UP_HOST, () => {
      const headers = [`${req.method} ${req.url} HTTP/1.1`, `Host: ${target.host}`];
      for (const [k, v] of Object.entries(req.headers)) {
        if (k.toLowerCase() === 'host' || k.toLowerCase() === 'proxy-authorization') continue;
        headers.push(`${k}: ${v}`);
      }
      headers.push(`Proxy-Authorization: ${auth}`, 'Connection: close', '', '');
      sock.write(headers.join('\r\n'));
      req.pipe(sock);
    });
    sock.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end('proxy error');
    });
    // Pipe the upstream response back, stripping hop-by-hop handling:
    // simplest correct-enough approach for test traffic — stream raw bytes
    // after the status line+headers are parsed by Node's parser on res side
    // is complex; instead use a second http parse via raw forwarding:
    // we forward the raw response through Node's http parser by responding
    // manually. To keep this simple and robust, buffer the response head.
    let buf = Buffer.alloc(0);
    let headDone = false;
    sock.on('data', (chunk) => {
      if (headDone) {
        res.write(chunk);
        return;
      }
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      headDone = true;
      const head = buf.subarray(0, idx).toString('utf8');
      const lines = head.split('\r\n');
      const status = parseInt(lines[0].split(' ')[1], 10) || 502;
      const outHeaders = {};
      for (const line of lines.slice(1)) {
        const c = line.indexOf(':');
        if (c === -1) continue;
        const k = line.slice(0, c).trim().toLowerCase();
        if (k === 'proxy-connection' || k === 'connection' || k === 'transfer-encoding') continue;
        outHeaders[k] = line.slice(c + 1).trim();
      }
      res.writeHead(status, outHeaders);
      const rest = buf.subarray(idx + 4);
      if (rest.length) res.write(rest);
    });
    sock.on('end', () => res.end());
    sock.on('close', () => {
      if (!res.writableEnded) res.end();
    });
  } catch (e) {
    if (!res.headersSent) res.writeHead(400);
    res.end('bad request: ' + e.message);
  }
});
server.on('clientError', (_err, sock) => sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'));

server.on('connect', (req, clientSocket, head) => {
  // CONNECT host:port -> ask upstream proxy to tunnel, with auth.
  const upstreamSock = net.connect(UP_PORT, UP_HOST, () => {
    upstreamSock.write(
      `CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\nProxy-Authorization: ${auth}\r\n\r\n`,
    );
  });
  let established = false;
  let buf = Buffer.alloc(0);
  upstreamSock.on('data', (chunk) => {
    if (established) return; // piped below
    buf = Buffer.concat([buf, chunk]);
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) return;
    const headStr = buf.subarray(0, idx).toString('utf8');
    if (!/^HTTP\/1\.[01] 200/.test(headStr)) {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      upstreamSock.destroy();
      return;
    }
    established = true;
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const rest = buf.subarray(idx + 4);
    if (head && head.length) upstreamSock.write(head);
    if (rest.length) clientSocket.write(rest);
    upstreamSock.pipe(clientSocket);
    clientSocket.pipe(upstreamSock);
  });
  upstreamSock.on('error', () => clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
  clientSocket.on('error', () => upstreamSock.destroy());
});

server.listen(3129, '127.0.0.1', () => {
  console.log(`local proxy listening on 127.0.0.1:3129 -> ${UP_HOST}:${UP_PORT}`);
});
