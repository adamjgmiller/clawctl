/**
 * Lightweight dashboard API server.
 * Serves a fleet overview as JSON endpoints that a frontend can consume.
 * Also serves static files from dashboard/dist if present.
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { JsonAgentStore } from '../registry/index.js';
import { JsonAuditStore } from '../audit/json-store.js';
import { PolicyEngine } from '../policy/index.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

async function serveStatic(res: ServerResponse, staticDir: string, urlPath: string): Promise<boolean> {
  let filePath = join(staticDir, urlPath === '/' ? 'index.html' : urlPath);
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

export async function startDashboard(port: number): Promise<void> {
  const store = new JsonAgentStore();
  const auditStore = new JsonAuditStore();
  const staticDir = join(import.meta.dirname ?? '.', '..', '..', 'dashboard', 'dist');

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const path = url.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
      res.end();
      return;
    }

    try {
      // API routes
      if (path === '/api/agents') {
        const agents = await store.list();
        json(res, agents);
      } else if (path.startsWith('/api/agents/') && path.split('/').length === 4) {
        const id = path.split('/')[3];
        const agent = await store.get(id);
        if (!agent) { json(res, { error: 'Not found' }, 404); return; }
        json(res, agent);
      } else if (path === '/api/audit') {
        const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
        const action = url.searchParams.get('action') ?? undefined;
        const entries = await auditStore.query({ action: action as any, limit });
        json(res, entries);
      } else if (path === '/api/policy') {
        const engine = await PolicyEngine.load();
        json(res, engine.getPolicy());
      } else if (path === '/api/health') {
        json(res, { status: 'ok', timestamp: new Date().toISOString() });
      } else {
        // Try static files
        const served = await serveStatic(res, staticDir, path);
        if (!served) {
          // SPA fallback
          const indexServed = await serveStatic(res, staticDir, '/');
          if (!indexServed) {
            json(res, { error: 'Not found' }, 404);
          }
        }
      }
    } catch (err) {
      json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Dashboard API running on http://0.0.0.0:${port}`);
  });
}
