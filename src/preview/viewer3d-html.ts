/**
 * The 3D viewer page. It is static: the module script at /client/viewer.js reads
 * the URL parameters (project, view, clipY, focus, margin, ui, ortho) itself.
 * three.js is resolved through the import map from /vendor/three/.
 */
export function buildViewer3dHtml(): string {
  const importMap = {
    imports: {
      three: '/vendor/three/build/three.module.js',
      'three/addons/': '/vendor/three/examples/jsm/'
    }
  };
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>MC Schema 3D Preview</title>
<style>
  html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; background: #1e1e1e; color: #eee; overflow: hidden; }
  #toolbar { position: fixed; top: 0; left: 0; right: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 12px; background: rgba(42,42,42,0.9); box-sizing: border-box; z-index: 5; font-size: 13px; }
  #toolbar button, #toolbar a.btn { background: #3a3a3a; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 3px 9px; cursor: pointer; font-size: 13px; text-decoration: none; }
  #toolbar button:hover, #toolbar a.btn:hover { background: #4a4a4a; }
  #toolbar button.active { background: #2f6fb0; border-color: #5aa0e0; }
  #toolbar input[type=range] { width: 160px; }
  #presets { display: flex; gap: 4px; flex-wrap: wrap; }
  .muted { color: #aaa; }
  #assets.bad { color: #ffb36b; }
  #canvas { position: fixed; inset: 0; display: block; width: 100vw; height: 100vh; }
  #tooltip { position: fixed; pointer-events: none; background: rgba(0,0,0,0.85); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 12px; display: none; white-space: nowrap; z-index: 10; }
  #unresolved { position: fixed; left: 12px; bottom: 12px; max-width: 40vw; max-height: 30vh; overflow: auto; background: rgba(60,0,60,0.85); border: 1px solid #f800f8; border-radius: 4px; padding: 6px 10px; font-size: 12px; display: none; z-index: 5; }
  #message { position: fixed; right: 12px; bottom: 12px; font-size: 12px; color: #ddd; background: rgba(0,0,0,0.6); padding: 4px 8px; border-radius: 4px; display: none; z-index: 5; }
  body.no-ui .ui { display: none !important; }
</style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <div id="toolbar" class="ui">
    <strong id="projectName">-</strong>
    <span class="muted">rev <span id="revision">0</span></span>
    <span id="assets" class="muted"></span>
    <span id="presets"></span>
    <button id="ortho" title="Orthographic projection (top view)">Ortho</button>
    <label class="muted">Cut above Y: <input id="clip" type="range" min="0" max="0" value="0"> <span id="clipLabel">off</span></label>
    <a class="btn" id="link2d" href="/2d">2D layers</a>
  </div>
  <div id="tooltip"></div>
  <div id="unresolved" class="ui"></div>
  <div id="message" class="ui"></div>
<script>
  (function () {
    var params = new URLSearchParams(location.search);
    var project = params.get('project');
    document.getElementById('link2d').href = '/2d' + (project ? '?project=' + encodeURIComponent(project) : '');
  })();
</script>
<script type="importmap">${JSON.stringify(importMap)}</script>
<script type="module" src="/client/viewer.js"></script>
</body>
</html>`;
}
