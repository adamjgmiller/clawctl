import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import { JsonAgentStore } from '../registry/index.js';
import { JsonAuditStore } from '../audit/json-store.js';

interface WsClient {
  ws: WebSocket;
  subscriptions: Set<string>;
}

const clients: WsClient[] = [];
let lastAgentHash = '';
let lastAuditHash = '';
let pollingStarted = false;

export function attachWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    const client: WsClient = { ws, subscriptions: new Set(['fleet', 'audit']) };
    clients.push(client);
    console.log(`[ws] client connected (${clients.length} total)`);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'subscribe' && msg.channel) {
          client.subscriptions.add(msg.channel);
        } else if (msg.type === 'unsubscribe' && msg.channel) {
          client.subscriptions.delete(msg.channel);
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      const idx = clients.indexOf(client);
      if (idx !== -1) clients.splice(idx, 1);
      console.log(`[ws] client disconnected (${clients.length} total)`);
    });

    // Send initial state
    sendInitState(ws);

    if (!pollingStarted) {
      pollingStarted = true;
      setInterval(poll, 3000);
    }
  });
}

function broadcast(channel: string, data: unknown): void {
  const msg = JSON.stringify({ type: 'update', channel, data, ts: Date.now() });
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN && client.subscriptions.has(channel)) {
      client.ws.send(msg);
    }
  }
}

async function sendInitState(ws: WebSocket): Promise<void> {
  try {
    const store = new JsonAgentStore();
    const agents = await store.list();
    const auditStore = new JsonAuditStore();
    const audit = await auditStore.query({ limit: 30 });

    // Update hashes to prevent duplicate broadcast on first poll
    lastAgentHash = JSON.stringify(
      agents.map((a) => ({ id: a.id, status: a.status, updatedAt: a.updatedAt })),
    );
    lastAuditHash = JSON.stringify(audit.map((a: { timestamp?: string }) => a.timestamp));

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'init', data: { agents, audit }, ts: Date.now() }));
      console.log('[ws] sent init state');
    }
  } catch (err) {
    console.error('[ws] sendInitState error:', err);
  }
}

async function poll(): Promise<void> {
  try {
    const store = new JsonAgentStore();
    const agents = await store.list();
    const agentHash = JSON.stringify(
      agents.map((a) => ({ id: a.id, status: a.status, updatedAt: a.updatedAt })),
    );

    if (agentHash !== lastAgentHash) {
      lastAgentHash = agentHash;
      broadcast('fleet', { agents });
    }

    const auditStore = new JsonAuditStore();
    const audit = await auditStore.query({ limit: 10 });
    const auditHash = JSON.stringify(audit.map((a: { timestamp?: string }) => a.timestamp));
    if (auditHash !== lastAuditHash) {
      lastAuditHash = auditHash;
      broadcast('audit', { audit });
    }
  } catch (err) {
    console.error('[ws] poll error:', err);
  }
}
