/**
 * Screenshots the 3D preview with a headless Edge/Chrome driven by playwright-core.
 * One browser is shared by all renders and closed after a quiet period.
 */

/** What ViewRenderer needs from a browser page (a thin adapter over playwright's Page). */
export interface PageLike {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  goto(url: string): Promise<unknown>;
  /** Resolves once the JavaScript expression is truthy; rejects after `timeout` ms. */
  waitForFunction(expression: string, options: { timeout: number }): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
  screenshot(): Promise<Buffer>;
  close(): Promise<void>;
}

export interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

/** The seam tests replace so no real browser is started. */
export interface BrowserLauncher {
  launch(): Promise<BrowserLike>;
}

/** The subset of playwright's Page that the default launcher adapts. */
interface RawPage {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'commit' }): Promise<unknown>;
  waitForFunction(expression: string, arg?: unknown, options?: { timeout?: number }): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
  screenshot(options?: { type?: 'png' }): Promise<Buffer>;
  close(): Promise<void>;
}
interface RawBrowser {
  newPage(): Promise<RawPage>;
  close(): Promise<void>;
}
export interface ChromiumLike {
  launch(options: { channel: string; headless: boolean; args: string[] }): Promise<RawBrowser>;
}

export const BROWSER_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

function adaptBrowser(raw: RawBrowser): BrowserLike {
  return {
    async newPage() {
      const page = await raw.newPage();
      return {
        setViewportSize: (size) => page.setViewportSize(size),
        goto: (url) => page.goto(url, { waitUntil: 'load' }),
        waitForFunction: (expression, options) => page.waitForFunction(expression, undefined, { timeout: options.timeout }),
        evaluate: (expression) => page.evaluate(expression),
        screenshot: () => page.screenshot({ type: 'png' }),
        close: () => page.close()
      };
    },
    close: () => raw.close()
  };
}

/** Edge first, then Chrome; both missing gives an error that says what to install. */
export function createDefaultLauncher(chromium?: ChromiumLike): BrowserLauncher {
  return {
    async launch() {
      const driver = chromium ?? ((await import('playwright-core')).chromium as unknown as ChromiumLike);
      const reasons: string[] = [];
      for (const channel of ['msedge', 'chrome']) {
        try {
          return adaptBrowser(await driver.launch({ channel, headless: true, args: BROWSER_ARGS }));
        } catch (err) {
          reasons.push(`${channel}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
        }
      }
      throw new Error(`Microsoft Edge or Google Chrome is required for renderView; install one of them. (${reasons.join('; ')})`);
    }
  };
}

export interface ViewRendererOptions {
  launcher?: BrowserLauncher;
  /** Close the shared browser after this long without a render (default 5 minutes). */
  idleMs?: number;
}

export class ViewRenderer {
  private readonly launcher: BrowserLauncher;
  private readonly idleMs: number;
  private browser: Promise<BrowserLike> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private active = 0;

  constructor(options: ViewRendererOptions = {}) {
    this.launcher = options.launcher ?? createDefaultLauncher();
    this.idleMs = options.idleMs ?? 300_000;
  }

  async render(
    url: string,
    size: { width: number; height: number },
    timeoutMs = 120_000
  ): Promise<{ png: Buffer }> {
    this.active++;
    this.clearIdle();
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      try {
        await page.setViewportSize(size);
        await page.goto(url);
        await page.waitForFunction('window.__previewReady === true || Boolean(window.__previewError)', {
          timeout: timeoutMs
        });
        const error = await page.evaluate('window.__previewError');
        if (typeof error === 'string' && error !== '') throw new Error(error);
        return { png: await page.screenshot() };
      } finally {
        await page.close().catch(() => {});
      }
    } finally {
      this.active--;
      if (this.active === 0) this.armIdle();
    }
  }

  async close(): Promise<void> {
    this.clearIdle();
    const pending = this.browser;
    this.browser = undefined;
    if (pending) await pending.then((b) => b.close()).catch(() => {});
  }

  private getBrowser(): Promise<BrowserLike> {
    if (!this.browser) {
      const launching = this.launcher.launch();
      this.browser = launching;
      // A failed launch must not be cached: the next render tries again.
      launching.catch(() => {
        if (this.browser === launching) this.browser = undefined;
      });
    }
    return this.browser;
  }

  private armIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      void this.close();
    }, this.idleMs);
    this.idleTimer.unref?.();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }
}
