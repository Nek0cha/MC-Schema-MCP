import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ProjectManager } from '../core/project-manager.js';
import { buildViewerHtml } from './viewer-html.js';

export class PreviewServer {
  private readonly manager: ProjectManager;
  private server: Server | null = null;
  private port: number | null = null;

  constructor(manager: ProjectManager) {
    this.manager = manager;
  }

  ensureStarted(): Promise<number> {
    if (this.port !== null) {
      return Promise.resolve(this.port);
    }
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handleRequest(req, res));
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('Failed to determine the preview server port.'));
          return;
        }
        // Don't let this server keep the MCP process alive on its own —
        // it's a passive viewer, not something that should block a clean
        // shutdown once stdio closes.
        server.unref();
        this.server = server;
        this.port = address.port;
        resolve(this.port);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildViewerHtml());
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}
