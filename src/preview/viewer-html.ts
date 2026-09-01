/**
 * Renders the build preview page: a single self-contained HTML document
 * (inline CSS/JS, no external requests) that fetches /api/build, renders
 * the current Y layer to a canvas, and lets the user switch layers,
 * zoom/pan, hover a cell for its coordinates + block id, and click a
 * cell to copy "x, y, z" to the clipboard.
 *
 * The color logic here intentionally duplicates src/preview/block-colors.ts
 * (see the design spec) so this page stays a single static file with no
 * server-side templating step.
 */
export function buildViewerHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>MC Schema Preview</title>
<style>
  html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; background: #1e1e1e; color: #eee; }
  #toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #2a2a2a; box-sizing: border-box; }
  #toolbar button { background: #3a3a3a; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 14px; }
  #toolbar button:hover { background: #4a4a4a; }
  #toolbar input { width: 70px; background: #1e1e1e; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 4px; }
  #status { margin-left: auto; font-size: 12px; color: #aaa; }
  #canvasWrap { position: relative; width: 100vw; height: calc(100vh - 49px); overflow: hidden; cursor: grab; }
  #canvasWrap.dragging { cursor: grabbing; }
  canvas { display: block; }
  #tooltip { position: fixed; pointer-events: none; background: rgba(0,0,0,0.85); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 12px; display: none; white-space: nowrap; z-index: 10; }
</style>
</head>
<body>
  <div id="toolbar">
    <strong id="projectName">-</strong>
    <button id="layerDown" title="Layer down">&#9664;</button>
    <span>Y:</span>
    <input id="layerInput" type="number" />
    <button id="layerUp" title="Layer up">&#9654;</button>
    <span id="status"></span>
  </div>
  <div id="canvasWrap">
    <canvas id="canvas"></canvas>
    <div id="tooltip"></div>
  </div>
<script>
(function () {
  var MANUAL_COLORS = {
    'minecraft:air': '#2a2a2a',
    'minecraft:stone': '#8a8a8a',
    'minecraft:cobblestone': '#7a7a7a',
    'minecraft:dirt': '#7a5230',
    'minecraft:grass_block': '#5b8a3c',
    'minecraft:oak_planks': '#b98b52',
    'minecraft:oak_log': '#6b5233',
    'minecraft:sand': '#ded2a0',
    'minecraft:gravel': '#8d8478',
    'minecraft:water': '#3d6fd1',
    'minecraft:glass': '#bfe3f0',
    'minecraft:white_wool': '#e8e8e8',
    'minecraft:bricks': '#9a5040',
    'minecraft:iron_bars': '#a8a8a8',
    'minecraft:oak_fence': '#b98b52',
    'minecraft:cobblestone_wall': '#7a7a7a'
  };

  function hashString(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  function colorFor(id) {
    if (MANUAL_COLORS[id]) return MANUAL_COLORS[id];
    var hue = hashString(id) % 360;
    return 'hsl(' + hue + ', 55%, 55%)';
  }

  var params = new URLSearchParams(location.search);
  var projectParam = params.get('project');
  var apiUrl = '/api/build' + (projectParam ? ('?project=' + encodeURIComponent(projectParam)) : '');

  var canvasWrap = document.getElementById('canvasWrap');
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var tooltip = document.getElementById('tooltip');
  var layerInput = document.getElementById('layerInput');
  var statusEl = document.getElementById('status');
  var projectNameEl = document.getElementById('projectName');

  var state = {
    bounds: null,
    layers: {},
    currentY: 0,
    cellSize: 20,
    offsetX: 20,
    offsetZ: 20
  };

  function cellKey(x, z) { return x + ',' + z; }

  function resize() {
    canvas.width = canvasWrap.clientWidth;
    canvas.height = canvasWrap.clientHeight;
  }
  window.addEventListener('resize', function () { resize(); render(); });
  resize();

  fetch(apiUrl).then(function (res) {
    if (!res.ok) {
      return res.json().then(function (err) { throw new Error(err.error || 'Failed to load build.'); });
    }
    return res.json();
  }).then(function (data) {
    if (!data.bounds) {
      statusEl.textContent = 'No blocks in this project.';
      return;
    }
    projectNameEl.textContent = data.project;
    state.bounds = data.bounds;
    state.currentY = data.bounds.min.y;
    data.blocks.forEach(function (b) {
      if (!state.layers[b.y]) state.layers[b.y] = new Map();
      state.layers[b.y].set(cellKey(b.x, b.z), b.id);
    });
    layerInput.min = String(data.bounds.min.y);
    layerInput.max = String(data.bounds.max.y);
    layerInput.value = String(state.currentY);
    render();
  }).catch(function (err) {
    statusEl.textContent = err.message;
  });

  function render() {
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!state.bounds) return;

    var layer = state.layers[state.currentY];
    var minX = state.bounds.min.x, minZ = state.bounds.min.z;
    var maxX = state.bounds.max.x, maxZ = state.bounds.max.z;

    for (var x = minX; x <= maxX; x++) {
      for (var z = minZ; z <= maxZ; z++) {
        var id = layer ? layer.get(cellKey(x, z)) : undefined;
        var px = state.offsetX + (x - minX) * state.cellSize;
        var pz = state.offsetZ + (z - minZ) * state.cellSize;
        ctx.fillStyle = id ? colorFor(id) : '#2a2a2a';
        ctx.fillRect(px, pz, state.cellSize - 1, state.cellSize - 1);
      }
    }
  }

  function setLayer(y) {
    if (!state.bounds) return;
    y = Math.max(state.bounds.min.y, Math.min(state.bounds.max.y, y));
    state.currentY = y;
    layerInput.value = String(y);
    render();
  }

  document.getElementById('layerDown').addEventListener('click', function () { setLayer(state.currentY - 1); });
  document.getElementById('layerUp').addEventListener('click', function () { setLayer(state.currentY + 1); });
  layerInput.addEventListener('change', function () { setLayer(parseInt(layerInput.value, 10) || 0); });

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var factor = e.deltaY < 0 ? 1.1 : 0.9;
    state.cellSize = Math.max(2, Math.min(200, state.cellSize * factor));
    render();
  }, { passive: false });

  var dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('mousedown', function (e) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvasWrap.classList.add('dragging');
  });
  window.addEventListener('mouseup', function () {
    dragging = false;
    canvasWrap.classList.remove('dragging');
  });
  window.addEventListener('mousemove', function (e) {
    if (dragging) {
      state.offsetX += e.clientX - lastX;
      state.offsetZ += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      render();
      return;
    }
    handleHover(e);
  });

  function cellFromEvent(e) {
    if (!state.bounds) return null;
    var rect = canvas.getBoundingClientRect();
    var px = e.clientX - rect.left - state.offsetX;
    var pz = e.clientY - rect.top - state.offsetZ;
    var x = Math.floor(px / state.cellSize) + state.bounds.min.x;
    var z = Math.floor(pz / state.cellSize) + state.bounds.min.z;
    if (x < state.bounds.min.x || x > state.bounds.max.x || z < state.bounds.min.z || z > state.bounds.max.z) return null;
    return { x: x, z: z };
  }

  function handleHover(e) {
    var cell = cellFromEvent(e);
    if (!cell) {
      tooltip.style.display = 'none';
      return;
    }
    var layer = state.layers[state.currentY];
    var id = layer ? layer.get(cellKey(cell.x, cell.z)) : undefined;
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top = (e.clientY + 12) + 'px';
    tooltip.textContent = '(' + cell.x + ', ' + state.currentY + ', ' + cell.z + ') ' + (id || 'minecraft:air');
  }

  canvas.addEventListener('mouseleave', function () { tooltip.style.display = 'none'; });

  canvas.addEventListener('click', function (e) {
    var cell = cellFromEvent(e);
    if (!cell) return;
    var text = cell.x + ', ' + state.currentY + ', ' + cell.z;
    navigator.clipboard.writeText(text).then(function () {
      statusEl.textContent = 'Copied: ' + text;
      setTimeout(function () { statusEl.textContent = ''; }, 1500);
    });
  });
})();
</script>
</body>
</html>`;
}
