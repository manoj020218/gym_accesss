import type { WebSocket } from 'ws';

class EventBroadcaster {
  private clients = new Set<WebSocket>();

  add(ws: WebSocket): void {
    this.clients.add(ws);
  }

  remove(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  /** Broadcast a typed message to all connected browser clients. */
  broadcast(type: string, payload: unknown): void {
    const data = JSON.stringify({ type, data: payload, ts: Date.now() });
    for (const ws of this.clients) {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(data);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

export const broadcaster = new EventBroadcaster();
