import type { Plugin } from 'vite';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getErrorCause(error: unknown) {
  if (!(error instanceof Error) || !('cause' in error)) {
    return '';
  }

  const cause = error.cause as { message?: string; code?: string } | undefined;
  return cause?.message || cause?.code || '';
}

export function apiCorsProxyPlugin(): Plugin {
  return {
    name: 'api-cors-proxy',
    configureServer(server) {
      server.middlewares.use('/__api_proxy', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': '*',
          });
          res.end();
          return;
        }

        const urlParam = new URL(req.url || '', 'http://localhost').searchParams.get('url');
        if (!urlParam) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
          return;
        }

        try {
          const bodyChunks: Buffer[] = [];
          for await (const chunk of req) {
            bodyChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          }
          const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : undefined;

          const proxyHeadersRaw = req.headers['x-proxy-headers'];
          let forwardHeaders: Record<string, string> = {};
          if (typeof proxyHeadersRaw === 'string') {
            try {
              forwardHeaders = JSON.parse(proxyHeadersRaw);
            } catch {
              forwardHeaders = {};
            }
          }

          const response = await fetch(urlParam, {
            method: req.method || 'GET',
            headers: forwardHeaders,
            body: req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
          });

          const respBody = await response.arrayBuffer();
          const headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*' };
          const contentType = response.headers.get('content-type');
          if (contentType) {
            headers['Content-Type'] = contentType;
          }

          res.writeHead(response.status, headers);
          res.end(Buffer.from(respBody));
        } catch (error) {
          const message = getErrorMessage(error);
          const cause = getErrorCause(error);
          console.error(`[api-cors-proxy] Unexpected error: ${message}${cause ? ` | cause: ${cause}` : ''}`);
          res.writeHead(502, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(JSON.stringify({ error: 'Proxy request failed', detail: message, cause }));
        }
      });
    },
  };
}
