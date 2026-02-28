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
import type { AuditAction } from '../audit/types.js';
import { PolicyEngine } from '../policy/index.js';
import { attachWebSocket } from './ws.js';

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

async function serveStatic(
  res: ServerResponse,
  staticDir: string,
  urlPath: string,
): Promise<boolean> {
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
  const staticDir = join(import.meta.dirname ?? '.', '..', '..', 'dashboard');

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const path = url.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
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
        if (!agent) {
          json(res, { error: 'Not found' }, 404);
          return;
        }
        json(res, agent);
      } else if (path === '/api/audit') {
        const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
        const action = url.searchParams.get('action') ?? undefined;
        const entries = await auditStore.query({
          action: action as AuditAction | undefined,
          limit,
        });
        json(res, entries);
      } else if (path === '/api/policy') {
        const engine = await PolicyEngine.load();
        json(res, engine.getPolicy());
      } else if (path === '/api/health') {
        json(res, { status: 'ok', timestamp: new Date().toISOString() });
      } else if (
        path.startsWith('/api/agents/') &&
        path.endsWith('/restart') &&
        req.method === 'POST'
      ) {
        const id = path.split('/')[3];
        const agent = await store.get(id);
        if (!agent) {
          json(res, { error: 'Not found' }, 404);
          return;
        }
        // Import SSH and restart
        const { SshClient } = await import('../ssh/index.js');
        const ssh = new SshClient(agent.sshKeyPath);
        try {
          await ssh.connect(agent);
          const result = await ssh.exec(
            'systemctl --user restart openclaw-gateway.service 2>/dev/null || (source ~/.nvm/nvm.sh 2>/dev/null; openclaw gateway restart)',
          );
          const { audit: auditFn } = await import('../audit/index.js');
          await auditFn('agent.restart', { agentId: agent.id, agentName: agent.name });
          json(res, { success: true, output: result.stdout || result.stderr });
        } catch (err) {
          json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
        } finally {
          ssh.disconnect();
        }
      } else if (
        path.startsWith('/api/agents/') &&
        path.endsWith('/diagnose') &&
        req.method === 'POST'
      ) {
        const id = path.split('/')[3];
        const agent = await store.get(id);
        if (!agent) {
          json(res, { error: 'Not found' }, 404);
          return;
        }
        const { SshClient } = await import('../ssh/index.js');
        const ssh = new SshClient(agent.sshKeyPath);
        const checks: Array<{ name: string; stdout: string; code: number | null }> = [];
        try {
          await ssh.connect(agent);
          for (const [name, cmd] of [
            [
              'systemd',
              'systemctl --user is-active openclaw-gateway.service 2>/dev/null || echo unknown',
            ],
            ['uptime', 'uptime'],
            ['disk', 'df -h / 2>&1'],
            ['memory', 'free -h 2>&1 || echo N/A'],
          ]) {
            const r = await ssh.exec(cmd);
            checks.push({ name, stdout: r.stdout.trim(), code: r.code });
          }
          json(res, { agent: { id: agent.id, name: agent.name }, checks });
        } catch (err) {
          json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
        } finally {
          ssh.disconnect();
        }
      } else if (
        path.startsWith('/api/agents/') &&
        path.endsWith('/logs') &&
        req.method === 'GET'
      ) {
        const id = path.split('/')[3];
        const agent = await store.get(id);
        if (!agent) {
          json(res, { error: 'Not found' }, 404);
          return;
        }
        const lines = parseInt(url.searchParams.get('lines') ?? '100', 10);
        const { SshClient } = await import('../ssh/index.js');
        const ssh = new SshClient(agent.sshKeyPath);
        try {
          await ssh.connect(agent);
          const result = await ssh.exec(
            `tail -n ${lines} /tmp/openclaw/*.log 2>/dev/null || journalctl --user -u openclaw-gateway.service -n ${lines} --no-pager 2>/dev/null || echo "No logs found"`,
          );
          json(res, { logs: result.stdout });
        } catch (err) {
          json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
        } finally {
          ssh.disconnect();
        }
      } else if (
        path.startsWith('/api/agents/') &&
        path.endsWith('/config') &&
        req.method === 'GET'
      ) {
        const id = path.split('/')[3];
        const agent = await store.get(id);
        if (!agent) {
          json(res, { error: 'Not found' }, 404);
          return;
        }
        const { SshClient } = await import('../ssh/index.js');
        const ssh = new SshClient(agent.sshKeyPath);
        try {
          await ssh.connect(agent);
          const configRes = await ssh.exec(
            'cat ~/.openclaw/openclaw.json 2>/dev/null || echo "{}"',
          );
          const statusRes = await ssh.exec(
            'source ~/.nvm/nvm.sh 2>/dev/null; openclaw status --json 2>/dev/null || echo "{}"',
          );
          let config = {};
          let status = {};
          try {
            config = JSON.parse(configRes.stdout);
          } catch {
            // non-JSON output, keep empty object
          }
          try {
            status = JSON.parse(statusRes.stdout);
          } catch {
            // non-JSON output, keep empty object
          }
          json(res, { config, status });
        } catch (err) {
          json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
        } finally {
          ssh.disconnect();
        }
      } else if (
        path.startsWith('/api/agents/') &&
        path.endsWith('/health-history') &&
        req.method === 'GET'
      ) {
        const id = path.split('/')[3];
        const agent = await store.get(id);
        if (!agent) {
          json(res, { error: 'Not found' }, 404);
          return;
        }
        // Pull health history from audit log
        const entries = await auditStore.query({ action: 'agent.status', limit: 100 });
        const agentEntries = entries.filter(
          (e: { detail?: { agentId?: string } }) => e.detail?.agentId === id,
        );
        json(res, agentEntries);
      } else if (path.startsWith('/api/agents/') && path.endsWith('/workspace') && req.method === 'GET') {
        const id = path.split('/')[3];
        const agent = await store.get(id);
        if (!agent) { json(res, { error: 'Not found' }, 404); return; }
        const { SshClient } = await import('../ssh/index.js');
        const ssh = new SshClient(agent.sshKeyPath);
        try {
          await ssh.connect(agent);
          const ws = '~/.openclaw/workspace';

          const tree = await ssh.exec(
            "find " + ws + " -maxdepth 3 ! -path '*/node_modules/*' ! -path '*/.git/*' ! -name '.env*' ! -path '*/credentials/*' ! -name '*.key' ! -name '*.pem' 2>/dev/null | sort | head -200"
          );
          const skills = await ssh.exec("ls -1 " + ws + "/skills/ 2>/dev/null || echo ''");
          const skillConfig = await ssh.exec(
            "source ~/.nvm/nvm.sh 2>/dev/null; node -e \"try{const c=JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.openclaw/openclaw.json'));(c.skills?.entries||[]).forEach(s=>console.log(s.name||'?'))}catch{}\" 2>/dev/null || echo ''"
          );
          const memoryFiles = await ssh.exec(
            "find " + ws + "/memory -type f \\( -name '*.md' -o -name '*.json' \\) 2>/dev/null | while read f; do sz=$(du -h \"$f\" | cut -f1); echo \"$sz $f\"; done | sort -k2 | head -100"
          );
          const soul = await ssh.exec("cat " + ws + "/SOUL.md 2>/dev/null | head -50 || echo ''");
          const identity = await ssh.exec("cat " + ws + "/IDENTITY.md 2>/dev/null | head -20 || echo ''");
          const memoryMd = await ssh.exec("cat " + ws + "/MEMORY.md 2>/dev/null | head -30 || echo ''");
          const kbFiles = await ssh.exec("ls -1 " + ws + "/knowledge-base/ 2>/dev/null | head -50 || echo ''");

          const redact = (s: string) => s.replace(/(api.?key|token|password|secret|auth)[^\n]*[:=][^\n]*/gi, '$1: [REDACTED]');

          json(res, {
            tree: tree.stdout.trim().split('\n').filter(Boolean),
            skills: [...new Set([
              ...skills.stdout.trim().split('\n').filter(Boolean),
              ...skillConfig.stdout.trim().split('\n').filter(Boolean),
            ])],
            memoryFiles: memoryFiles.stdout.trim().split('\n').filter(Boolean),
            soul: soul.stdout,
            identity: identity.stdout,
            memoryMdPreview: redact(memoryMd.stdout),
            knowledgeBase: kbFiles.stdout.trim().split('\n').filter(Boolean),
          });
        } catch (err) {
          json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
        } finally {
          ssh.disconnect();
        }
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

  attachWebSocket(server);

  server.listen(port, '0.0.0.0', () => {
    console.log(`Dashboard API running on http://0.0.0.0:${port}`);
    console.log(`WebSocket available on ws://0.0.0.0:${port}`);
  });
}
