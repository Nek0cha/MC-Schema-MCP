import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { parseVoxelKey, type BuildProject } from '../core/build-project.js';
import type { ProjectManager } from '../core/project-manager.js';
import { buildViewerHtml } from './viewer-html.js';

export class PreviewServer {
  private readonly manager: ProjectManager;
  private server: Server | null = null;
  private port: number | null = null;
  private startPromise: Promise<number> | null = null;

  /**
   * `listenPort` defaults to 0 (OS-assigned, the normal production
   * behavior). Tests may pass a fixed port to deterministically force a
   * listen failure (e.g. by pre-occupying that port with another server),
   * to exercise ensureStarted()'s failure-recovery path.
   */
  constructor(
    manager: ProjectManager,
    private readonly listenPort = 0
  ) {
    this.manager = manager;
  }

  ensureStarted(): Promise<number> {
    if (this.port !== null) {
      return Promise.resolve(this.port);
    }
    if (!this.startPromise) {
      this.startPromise = new Promise<number>((resolve, reject) => {
        const server = createServer((req, res) => this.handleRequest(req, res));
        server.on('error', reject);
        server.listen(this.listenPort, '127.0.0.1', () => {
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
      }).catch((err: unknown) => {
        // Don't let a transient failure (EADDRINUSE, EMFILE, ...) wedge this
        // instance forever — clear the cached promise so the next
        // ensureStarted() call gets a fresh attempt instead of replaying the
        // same rejection for the life of the process.
        this.startPromise = null;
        throw err;
      });
    }
    return this.startPromise;
  }

  close(): Promise<void> {
    return (this.startPromise ?? Promise.resolve()).catch(() => {
      // A failed start has nothing listening to close; swallow it so
      // close() is always safe to call regardless of start outcome.
    }).then(() => {
      return new Promise((resolve) => {
        if (!this.server) {
          this.server = null;
          this.port = null;
          this.startPromise = null;
          resolve();
          return;
        }
        this.server.close(() => {
          this.server = null;
          this.port = null;
          this.startPromise = null;
          resolve();
        });
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildViewerHtml());
      return;
    }

    if (url.pathname === '/api/build') {
      this.handleApiBuild(url, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }

  private handleApiBuild(url: URL, res: ServerResponse): void {
    const projectName = url.searchParams.get('project');
    const project = projectName ? this.manager.getProject(projectName) : this.getActiveOrUndefined();

    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: projectName ? `Project "${projectName}" does not exist.` : 'No active project.'
        })
      );
      return;
    }

    const blocks = [...project.voxels].map(([key, block]) => {
      const pos = parseVoxelKey(key);
      return { x: pos.x, y: pos.y, z: pos.z, id: block.id };
    });

    const body = JSON.stringify({
      project: project.name,
      bounds: project.getBoundingBox(),
      blocks
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
  }

  private getActiveOrUndefined(): BuildProject | undefined {
    try {
      return this.manager.getActive();
    } catch {
      return undefined;
    }
  }
}
