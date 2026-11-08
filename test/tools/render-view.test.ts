import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import { AssetStore } from '../../src/preview/assets/asset-store.js';
import {
  createDefaultLauncher,
  ViewRenderer,
  type BrowserLauncher,
  type PageLike
} from '../../src/preview/render-view.js';
import { createPreviewServerState, renderViewHandler, type PreviewServerState } from '../../src/tools/preview-tools.js';
import { buildToolDefs } from '../../src/tools/registry.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

interface Recorder {
  urls: string[];
  viewports: { width: number; height: number }[];
  closedPages: number;
  launches: number;
  closedBrowsers: number;
  previewError: string | undefined;
  waitTimeouts: number[];
}

function fakeLauncher(rec: Recorder): BrowserLauncher {
  return {
    async launch() {
      rec.launches++;
      return {
        async newPage(): Promise<PageLike> {
          return {
            async setViewportSize(size) {
              rec.viewports.push(size);
            },
            async goto(url) {
              rec.urls.push(url);
            },
            async waitForFunction(_expr, options) {
              rec.waitTimeouts.push(options.timeout);
            },
            async evaluate() {
              return rec.previewError;
            },
            async screenshot() {
              return PNG;
            },
            async close() {
              rec.closedPages++;
            }
          };
        },
        async close() {
          rec.closedBrowsers++;
        }
      };
    }
  };
}

function newRecorder(): Recorder {
  return { urls: [], viewports: [], closedPages: 0, launches: 0, closedBrowsers: 0, previewError: undefined, waitTimeouts: [] };
}

describe('ViewRenderer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the url at the requested size and returns the png', async () => {
    const rec = newRecorder();
    const renderer = new ViewRenderer({ launcher: fakeLauncher(rec) });
    const { png } = await renderer.render('http://127.0.0.1:1/?x=1', { width: 640, height: 480 }, 5000);
    expect(png).toBe(PNG);
    expect(rec.urls).toEqual(['http://127.0.0.1:1/?x=1']);
    expect(rec.viewports).toEqual([{ width: 640, height: 480 }]);
    expect(rec.waitTimeouts).toEqual([5000]);
    expect(rec.closedPages).toBe(1);
    await renderer.close();
  });

  it('turns window.__previewError into an error', async () => {
    const rec = newRecorder();
    rec.previewError = 'WebGL is not available: no context';
    const renderer = new ViewRenderer({ launcher: fakeLauncher(rec) });
    await expect(renderer.render('http://x/', { width: 10, height: 10 })).rejects.toThrow('WebGL is not available: no context');
    expect(rec.closedPages).toBe(1);
    await renderer.close();
  });

  it('reuses one browser for several renders', async () => {
    const rec = newRecorder();
    const renderer = new ViewRenderer({ launcher: fakeLauncher(rec) });
    await renderer.render('http://x/a', { width: 10, height: 10 });
    await renderer.render('http://x/b', { width: 10, height: 10 });
    expect(rec.launches).toBe(1);
    await renderer.close();
    expect(rec.closedBrowsers).toBe(1);
  });

  it('closes the browser after the idle time and launches a new one afterwards', async () => {
    vi.useFakeTimers();
    const rec = newRecorder();
    const renderer = new ViewRenderer({ launcher: fakeLauncher(rec), idleMs: 1000 });
    await renderer.render('http://x/a', { width: 10, height: 10 });
    expect(rec.closedBrowsers).toBe(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(rec.closedBrowsers).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(rec.closedBrowsers).toBe(1);
    await renderer.render('http://x/b', { width: 10, height: 10 });
    expect(rec.launches).toBe(2);
    await renderer.close();
  });
});

describe('createDefaultLauncher', () => {
  const browser = { newPage: async () => ({}) as never, close: async () => {} };

  it('launches Edge headless with the software WebGL flags', async () => {
    const launch = vi.fn(async () => browser);
    await createDefaultLauncher({ launch }).launch();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith({
      channel: 'msedge',
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    });
  });

  it('falls back to Chrome when Edge cannot be launched', async () => {
    const launch = vi.fn(async (opts: { channel: string }) => {
      if (opts.channel === 'msedge') throw new Error('msedge not found');
      return browser;
    });
    await createDefaultLauncher({ launch }).launch();
    expect(launch.mock.calls.map((c) => c[0].channel)).toEqual(['msedge', 'chrome']);
  });

  it('explains that Edge or Chrome is required when both fail', async () => {
    const launch = vi.fn(async (opts: { channel: string }): Promise<typeof browser> => {
      throw new Error(`${opts.channel} missing`);
    });
    const promise = createDefaultLauncher({ launch }).launch();
    await expect(promise).rejects.toThrow('Microsoft Edge or Google Chrome is required for renderView; install one of them.');
    await expect(createDefaultLauncher({ launch }).launch()).rejects.toThrow(/msedge missing/);
  });
});

describe('renderViewHandler', () => {
  let state: PreviewServerState;
  let manager: ProjectManager;
  let rec: Recorder;

  beforeEach(() => {
    rec = newRecorder();
    manager = new ProjectManager();
    manager.createProject('city');
    manager.getActive().setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    manager.getActive().setBlock({ x: 4, y: 3, z: 5 }, { id: 'minecraft:definitely_not_a_block' });
    state = createPreviewServerState(
      new AssetStore({
        cacheDir: mkdtempSync(join(tmpdir(), 'mc-assets-')),
        version: 'test',
        fetchImpl: () => Promise.reject(new Error('offline'))
      }),
      fakeLauncher(rec)
    );
  });

  afterEach(async () => {
    await state.renderer.close();
    await state.server?.close();
  });

  it('passes the parameters in the url and returns an image plus a text', async () => {
    const result = await renderViewHandler(manager, state, {
      view: 'north',
      focus: { from: { x: 0, y: 0, z: 0 }, to: { x: 4, y: 3, z: 5 } },
      clipY: 2,
      width: 800,
      height: 600,
      ortho: true
    });
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' });
    expect(result.content[1].type).toBe('text');

    const url = new URL(rec.urls[0]);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.searchParams.get('project')).toBe('city');
    expect(url.searchParams.get('view')).toBe('north');
    expect(url.searchParams.get('focus')).toBe('0,0,0,4,3,5');
    expect(url.searchParams.get('clipY')).toBe('2');
    expect(url.searchParams.get('ui')).toBe('0');
    expect(url.searchParams.get('ortho')).toBe('1');
    expect(rec.viewports).toEqual([{ width: 800, height: 600 }]);
  });

  it('defaults to iso_se at 1280x800 and omits unset parameters', async () => {
    await renderViewHandler(manager, state, {});
    const url = new URL(rec.urls[0]);
    expect(url.searchParams.get('view')).toBe('iso_se');
    expect(url.searchParams.has('focus')).toBe(false);
    expect(url.searchParams.has('clipY')).toBe(false);
    expect(url.searchParams.has('ortho')).toBe(false);
    expect(rec.viewports).toEqual([{ width: 1280, height: 800 }]);
  });

  it('describes view, bounds, cut and asset state in the text', async () => {
    const result = await renderViewHandler(manager, state, { view: 'top', clipY: 1 });
    const text = (result.content[1] as { text: string }).text;
    expect(text).toContain('top');
    expect(text).toContain('clipY 1');
    expect(text).toContain('(0, 0, 0)');
    expect(text).toContain('(4, 3, 5)');
    expect(text).toMatch(/asset/i);
  });

  it('fails clearly for an unknown project and for an empty project', async () => {
    await expect(renderViewHandler(manager, state, { project: 'nope' })).rejects.toThrow(/nope/);
    manager.createProject('empty');
    await expect(renderViewHandler(manager, state, { project: 'empty' })).rejects.toThrow(/no blocks/);
  });

  it('is registered as a non-mutating, non-batchable tool', () => {
    const def = buildToolDefs().find((d) => d.name === 'renderView');
    expect(def).toBeDefined();
    expect(def?.mutating).toBe(false);
    expect(def?.batchable).toBe(false);
    expect(def?.description).toContain('clipY');
  });
});
