import { describe, expect, it } from 'vitest';
import { buildViewer3dHtml } from '../../src/preview/viewer3d-html.js';

describe('buildViewer3dHtml', () => {
  const html = buildViewer3dHtml();

  it('has an import map for three and three/addons/', () => {
    const match = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
    expect(match).not.toBeNull();
    const map = JSON.parse((match as RegExpExecArray)[1]);
    expect(map.imports.three).toBe('/vendor/three/build/three.module.js');
    expect(map.imports['three/addons/']).toBe('/vendor/three/examples/jsm/');
  });

  it('loads the viewer script as a module', () => {
    expect(html).toContain('<script type="module" src="/client/viewer.js"></script>');
  });

  it('links to the 2D viewer and has the elements the viewer script needs', () => {
    expect(html).toContain('href="/2d');
    for (const id of ['canvas', 'presets', 'clip', 'tooltip', 'unresolved', 'assets', 'markersToggle']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('leaves URL parameters (project, view, clipY, focus, margin, ui, ortho) to the viewer script', () => {
    // The page is static; the script reads location.search. The 2D link must carry the project over.
    expect(html).toContain('URLSearchParams');
  });
});
