// DocGraph 3D - Option 1: 3-Column Knowledge Studio Layout
// Left: Explorer | Center: Markdown Content | Right: 3D Galaxy & Connected Links

let Graph = null;
let rawData = { nodes: [], links: [] };
let filteredData = { nodes: [], links: [] };
let masterGraphData = { nodes: [], links: [] };
let allProjectsList = [];
const selectedProjects = new Set();
// Explorer checkbox selection persists across reloads/refresh (galaxy-style)
const PROJECTS_SEL_KEY = 'docgraphical-selected-projects';

const highlightNodes = new Set();
const highlightLinks = new Set();
let activeNode = null;
let selectedTreeNodeEl = null;
let isTreeOpen = true;
let isRotating = false;
let currentLanguage = 'en';

// Mode & Filter States
let currentLOD = 'all'; // 'arch', 'standard', 'all', 'custom'
const hiddenKinds = new Set(['heading_2', 'heading_3', 'heading_4', 'heading_5', 'heading_6']);
const hiddenEdgeKinds = new Set();

const KIND_COLORS = {
  file: '#f0883e',       // Document (Warm Cyber Orange)
  heading_1: '#58a6ff',  // H1 Primary (Electric Blue)
  heading_2: '#3fb950',  // H2 Major (Emerald Green)
  heading_3: '#bc8cff',  // H3 Subsection (Vivid Purple)
  heading_4: '#ff7bba',  // H4 Detail (Vibrant Rose Pink)
  heading_5: '#00d2d3',  // H5 Fine (Cyan / Turquoise)
  heading_6: '#ffd700'   // H6 Micro (Bright Gold)
};

const KIND_SIZES = {
  file: 3.0,       // Document (Warm Cyber Orange) - scaled down for compact 3D view
  heading_1: 2.0,  // H1 Primary (Electric Blue)
  heading_2: 1.4,  // H2 Major (Emerald Green)
  heading_3: 0.95, // H3 Subsection (Vivid Purple)
  heading_4: 0.65, // H4 Detail (Vibrant Rose Pink)
  heading_5: 0.45, // H5 Fine (Cyan / Turquoise)
  heading_6: 0.3   // H6 Micro (Bright Gold)
};

const EDGE_COLORS = {
  parent_child: '#388bfd',
  doc_link: '#00ffaa'
};

document.addEventListener('DOMContentLoaded', () => {
  try { init3DGraph(); } catch (e) { console.error('init3DGraph error:', e); }
  try { init3DNavControls(); } catch (e) { console.error('initCyberControls error:', e); }
  try { initAutoRotate(); } catch (e) { console.error('initAutoRotate error:', e); }
  try { initColumnResizers(); } catch (e) { console.error('initColumnResizers error:', e); }
  try { loadProjects(); } catch (e) { console.error('loadProjects error:', e); }
  try { checkElectronNative(); } catch (e) { console.error('checkElectronNative error:', e); }
  try { updateHealthIndicator(); } catch (e) { console.error('health error:', e); }
  try { initTreeCtxMenu(); } catch (e) { console.error('ctxmenu error:', e); }
});

// ─── 1. 3D WebGL Scene & Node Rendering ───────────────────────────
function updateGraphSize() {
  if (!Graph) return;
  const pane3D = document.getElementById('viewport-3d-pane');
  const graphEl = document.getElementById('3d-graph');
  if (!pane3D || !graphEl) return;

  const header = pane3D.querySelector('.graph-pane-header');
  const headerH = header ? header.offsetHeight : 30;

  // Strictly measure ONLY the upper 3D pane, never the drawer below!
  const w = pane3D.clientWidth;
  const h = Math.max(100, pane3D.clientHeight - headerH);

  Graph.width(w);
  Graph.height(h);
}

// ─── Ancestor Resolution & SpriteText Shrine Logic ───────────────

function findImmediateAncestor(node, gNodes) {
  if (!node) return null;
  const nodesList = gNodes || (Graph && Graph.graphData ? Graph.graphData().nodes : rawData.nodes) || [];
  const rawLinks = rawData.links || [];

  // 1. Direct parent link (parent_child where target === node.id)
  let parentId = null;
  for (const l of rawLinks) {
    if (l.kind === 'parent_child') {
      const sId = typeof l.source === 'object' ? l.source.id : l.source;
      const tId = typeof l.target === 'object' ? l.target.id : l.target;
      if (tId === node.id) {
        parentId = sId;
        break;
      }
    }
  }

  // 2. If direct 1-level parent exists in active 3D nodes, return it immediately (真·近祖!)
  if (parentId) {
    const parentNode = nodesList.find(n => n.id === parentId);
    if (parentNode && parentNode.x !== undefined) {
      return parentNode;
    }
  }

  // 3. If direct parent is not active, step-by-step trace upward for nearest visible ancestor
  let currId = parentId;
  const visited = new Set([node.id, currId]);
  while (currId) {
    let nextParentId = null;
    for (const l of rawLinks) {
      if (l.kind === 'parent_child') {
        const sId = typeof l.source === 'object' ? l.source.id : l.source;
        const tId = typeof l.target === 'object' ? l.target.id : l.target;
        if (tId === currId && !visited.has(sId)) {
          nextParentId = sId;
          visited.add(sId);
          break;
        }
      }
    }
    if (nextParentId) {
      const ancNode = nodesList.find(n => n.id === nextParentId);
      if (ancNode && ancNode.x !== undefined) {
        return ancNode;
      }
      currId = nextParentId;
    } else {
      break;
    }
  }

  // 4. Fallback: owner Document file node
  if (node.file) {
    const cleanPath = (node.file || '').replace(/\\/g, '/');
    const fileNode = nodesList.find(n => n.kind === 'file' && ((n.file || '').replace(/\\/g, '/') === cleanPath || n.id === `file::${cleanPath}`));
    if (fileNode && fileNode.x !== undefined) return fileNode;
  }

  return node;
}

function createFileLabelSprite(n) {
  if (!n) return null;

  const isFile = (n.kind === 'file');
  const labelText = isFile ? (n.file || n.name || '').split(/[\\/]/).pop() : (n.name || '');
  if (!labelText) return null;

  const color = KIND_COLORS[n.kind] || '#58a6ff';

  if (typeof SpriteText !== 'undefined') {
    try {
      const sprite = new SpriteText(labelText);
      sprite.color = color;
      sprite.textHeight = isFile ? 1.6 : 1.3;
      sprite.backgroundColor = 'rgba(10, 14, 20, 0.85)';
      sprite.borderWidth = 0;
      sprite.borderRadius = 2;
      sprite.padding = [0.7, 0.16];
      sprite.position.set(0, (KIND_SIZES[n.kind] || 1.5) + 2.4, 0);
      if (sprite.material) {
        sprite.material.depthWrite = false;
        sprite.material.transparent = true;
        sprite.material.opacity = isFile ? 0.95 : 0.0;
      }
      n.__labelSprite = sprite;
      return sprite;
    } catch (err) {
      console.warn('SpriteText creation failed:', err);
    }
  }

  return null;
}

function init3DGraph() {
  const elem = document.getElementById('3d-graph');
  const pane3D = document.getElementById('viewport-3d-pane');
  if (!elem || !pane3D) return;

  const header = pane3D.querySelector('.graph-pane-header');
  const headerH = header ? header.offsetHeight : 30;
  const width = pane3D.clientWidth || 400;
  const height = Math.max(100, (pane3D.clientHeight || 350) - headerH);

  Graph = ForceGraph3D()(elem)
    .width(width)
    .height(height)
    .backgroundColor('#090d13')
    .nodeId('id')
    .nodeLabel(n => {
      const typeLabel = n.kind === 'file' ? 'Document' : `H${n.level || 1} Section`;
      const fileName = (n.file || '').split(/[\\/]/).pop();
      const nodeColor = KIND_COLORS[n.kind] || '#58a6ff';
      return `<div class="scene-tooltip">
        <div class="tooltip-title" style="color:${nodeColor};">${escapeHtml(n.name)}</div>
        <div class="tooltip-sub">${typeLabel} · ${escapeHtml(fileName)} · Line ${n.line || 1}</div>
      </div>`;
    })
    .nodeColor(n => {
      if (highlightNodes.size > 0) {
        return highlightNodes.has(n.id) ? (KIND_COLORS[n.kind] || '#58a6ff') : '#1c212888';
      }
      return KIND_COLORS[n.kind] || '#58a6ff';
    })
    .nodeVal(n => {
      let base = KIND_SIZES[n.kind] || 1.0;
      if (highlightNodes.has(n.id)) return base * 1.4;
      return base;
    })
    .nodeRelSize(1.8)
    .nodeResolution(16)
    .nodeThreeObjectExtend(true)
    .nodeThreeObject(n => createFileLabelSprite(n))
    .linkOpacity(l => {
      if (highlightNodes.size > 0) {
        return highlightLinks.has(l) ? 0.95 : 0.08;
      }
      return l.kind === 'doc_link' ? 0.6 : 0.35;
    })
    .linkColor(l => {
      if (highlightNodes.size > 0) {
        return highlightLinks.has(l) ? (l.kind === 'doc_link' ? '#00ffaa' : '#58a6ff') : '#21262d22';
      }
      return EDGE_COLORS[l.kind] || '#58a6ff';
    })
    .linkWidth(l => {
      if (highlightNodes.size > 0) {
        return highlightLinks.has(l) ? 1.2 : 0.15;
      }
      return l.kind === 'doc_link' ? 0.7 : 0.3;
    })
    .linkDirectionalParticles(l => {
      if (highlightNodes.size > 0) {
        return highlightLinks.has(l) ? 2 : 0;
      }
      return l.kind === 'doc_link' ? 1 : 0;
    })
    .linkDirectionalParticleWidth(l => highlightLinks.has(l) ? 1.0 : 0.6)
    .linkDirectionalParticleSpeed(l => highlightLinks.has(l) ? 0.005 : 0.0025)
    .d3AlphaDecay(0.03)
    .d3VelocityDecay(0.35)
    .onNodeClick(node => {
      highlightScope('node', node);
      focusOnNode(node);
      selectActiveNode(node);
      syncExplorerSelection(node);
    })
    .onBackgroundClick(() => {
      clearHighlight();
    });

  // Balanced lighting preserves rich AST colors, preventing MeshLambertMaterial white blowout
  if (typeof THREE !== 'undefined' && Graph.lights) {
    Graph.lights([
      new THREE.AmbientLight(0xffffff, 0.55),
      new THREE.DirectionalLight(0xffffff, 0.45)
    ]);
  }

  // Configure tight d3 forces: small distance and controlled repulsion for compact 3D viewport
  if (Graph.d3Force('link')) {
    Graph.d3Force('link')
      .distance(l => (l.kind === 'doc_link' ? 22 : 7))
      .strength(l => (l.kind === 'doc_link' ? 0.35 : 0.85));
  }
  if (Graph.d3Force('charge')) {
    Graph.d3Force('charge')
      .strength(-14)
      .distanceMax(100);
  }

  // Dynamic ResizeObserver strictly measures ONLY the 3D pane viewport
  if (pane3D && window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      updateGraphSize();
    });
    ro.observe(pane3D);
  }
}

function updateLabelsVisibility() {
  const gNodes = (Graph && Graph.graphData) ? (Graph.graphData().nodes || []) : (rawData.nodes || []);
  const hasFilter = highlightNodes.size > 0;

  // Determine which node's "牌位" (SpriteText) should be revealed
  let revealedNodeId = null;
  if (activeNode) {
    if (!hiddenKinds.has(activeNode.kind) && gNodes.some(n => n.id === activeNode.id)) {
      revealedNodeId = activeNode.id;
    } else {
      // If activeNode's layer is not shown, reveal closest visible ancestor's "牌位"
      const nearAnc = findImmediateAncestor(activeNode, gNodes);
      if (nearAnc) revealedNodeId = nearAnc.id;
    }
  }

  gNodes.forEach(n => {
    if (n.__labelSprite) {
      const isFile = n.kind === 'file';
      const isRevealed = (n.id === revealedNodeId);
      const isHighlighted = highlightNodes.has(n.id);

      n.__labelSprite.visible = true; // Never completely remove

      if (!hasFilter) {
        if (n.__labelSprite.material) {
          n.__labelSprite.material.opacity = isFile ? 0.95 : 0.0;
        }
        n.__labelSprite.color = KIND_COLORS[n.kind] || '#58a6ff';
        n.__labelSprite.backgroundColor = 'rgba(10, 14, 20, 0.85)';
      } else {
        if (isRevealed) {
          // Revealed Shrine: Strictly preserve original AST kind color (H1=blue, H2=green, H3=purple, File=orange, etc.)
          if (n.__labelSprite.material) n.__labelSprite.material.opacity = 1.0;
          n.__labelSprite.color = KIND_COLORS[n.kind] || '#58a6ff';
          n.__labelSprite.backgroundColor = 'rgba(10, 14, 20, 0.92)';
        } else if (isHighlighted && isFile) {
          if (n.__labelSprite.material) n.__labelSprite.material.opacity = 0.92;
          n.__labelSprite.color = KIND_COLORS[n.kind] || '#f0883e';
          n.__labelSprite.backgroundColor = 'rgba(10, 14, 20, 0.85)';
        } else if (isHighlighted) {
          if (n.__labelSprite.material) n.__labelSprite.material.opacity = 0.75;
          n.__labelSprite.color = KIND_COLORS[n.kind] || '#58a6ff';
          n.__labelSprite.backgroundColor = 'rgba(10, 14, 20, 0.75)';
        } else {
          // Unselected background nodes: 低調透明跟edge一樣
          if (n.__labelSprite.material) n.__labelSprite.material.opacity = isFile ? 0.12 : 0.0;
          n.__labelSprite.color = '#6e7681';
          n.__labelSprite.backgroundColor = 'rgba(10, 14, 20, 0.15)';
        }
      }
    }
  });
}

function focusOnNode(node) {
  if (!node) return;

  let liveNode = node;
  if (liveNode.x === undefined || liveNode.y === undefined || liveNode.z === undefined) {
    if (Graph && Graph.graphData) {
      const gNodes = Graph.graphData().nodes || [];
      liveNode = gNodes.find(n => n.id === node.id) || (rawData.nodes || []).find(n => n.id === node.id) || node;
    }
  }

  if (!liveNode) return;
  activeNode = liveNode;

  // 1. 真·近祖置中 (Focus on 1-level Direct Immediate Parent for sections, NEVER skip to root file!)
  let centerNode = liveNode;
  if (liveNode.kind !== 'file') {
    const gNodes = (Graph && Graph.graphData) ? (Graph.graphData().nodes || []) : (rawData.nodes || []);
    const nearAncestor = findImmediateAncestor(liveNode, gNodes);
    if (nearAncestor && nearAncestor.x !== undefined) {
      centerNode = nearAncestor;
    }
  }

  if (centerNode.x === undefined) centerNode = liveNode;
  if (centerNode.x === undefined) return;

  if (Graph) {
    const targetPos = { x: Number(centerNode.x) || 0, y: Number(centerNode.y) || 0, z: Number(centerNode.z) || 0 };
    const camera = Graph.camera();
    const controls = Graph.controls();

    let camPos;
    if (camera && controls && typeof THREE !== 'undefined') {
      const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
      if (dir.lengthSq() < 0.001) dir.set(0, 0, 1);
      const focusDist = 45; // comfortable viewing distance for ancestor & child framing
      dir.normalize().multiplyScalar(focusDist);
      camPos = {
        x: targetPos.x + dir.x,
        y: targetPos.y + dir.y,
        z: targetPos.z + dir.z
      };
    } else {
      const distance = 45;
      const distRatio = 1 + distance / Math.hypot(targetPos.x || 1, targetPos.y || 1, targetPos.z || 1);
      camPos = {
        x: targetPos.x * distRatio,
        y: targetPos.y * distRatio,
        z: targetPos.z * distRatio
      };
    }

    Graph.cameraPosition(camPos, targetPos, 1000);
  }
}

function highlightScope(scopeType, targetObj) {
  highlightNodes.clear();
  highlightLinks.clear();

  const rawLinks = rawData.links || [];

  if (scopeType === 'project') {
    rawData.nodes.forEach(n => highlightNodes.add(n.id));
    rawLinks.forEach(l => highlightLinks.add(l));
    if (Graph) Graph.zoomToFit(600, 15);
  } else if (scopeType === 'dir') {
    const dirPrefix = (targetObj.dir_path || '').replace(/^\/+/, '');
    rawData.nodes.filter(n => {
      const f = (n.file || '').replace(/\\/g, '/').replace(/^\/+/, '');
      return f.startsWith(dirPrefix);
    }).forEach(n => highlightNodes.add(n.id));

    rawLinks.forEach(l => {
      const sId = typeof l.source === 'object' ? l.source.id : l.source;
      const tId = typeof l.target === 'object' ? l.target.id : l.target;
      if (highlightNodes.has(sId) || highlightNodes.has(tId)) {
        highlightLinks.add(l);
      }
    });
    if (Graph) Graph.zoomToFit(600, 15);
  } else if (scopeType === 'file') {
    const fileNode = targetObj.node;
    if (fileNode) highlightNodes.add(fileNode.id);
    (targetObj.symbols || targetObj.headings || []).forEach(h => highlightNodes.add(h.id));

    rawLinks.forEach(l => {
      const sId = typeof l.source === 'object' ? l.source.id : l.source;
      const tId = typeof l.target === 'object' ? l.target.id : l.target;
      if (highlightNodes.has(sId) || highlightNodes.has(tId)) {
        highlightLinks.add(l);
        highlightNodes.add(sId);
        highlightNodes.add(tId);
      }
    });

    if (fileNode && fileNode.x !== undefined) focusOnNode(fileNode);
  } else if (scopeType === 'node') {
    const node = targetObj;
    highlightNodes.add(node.id);

    // 1. Trace ALL Ancestors recursively up to the Root Document / File node
    let currentAncestors = [node.id];
    const visitedAncestors = new Set([node.id]);

    while (currentAncestors.length > 0) {
      const nextAncestors = [];
      currentAncestors.forEach(currId => {
        rawLinks.forEach(l => {
          if (l.kind === 'parent_child') {
            const sId = typeof l.source === 'object' ? l.source.id : l.source;
            const tId = typeof l.target === 'object' ? l.target.id : l.target;
            if (tId === currId && !visitedAncestors.has(sId)) {
              visitedAncestors.add(sId);
              highlightNodes.add(sId);
              highlightLinks.add(l);
              nextAncestors.push(sId);
            }
          }
        });
      });
      currentAncestors = nextAncestors;
    }

    // 2. Ensure owner Document / File node is 100% included in ancestor chain
    if (node.file) {
      const cleanPath = (node.file || '').replace(/\\/g, '/');
      const fileNode = rawData.nodes.find(n => n.kind === 'file' && ((n.file || '').replace(/\\/g, '/') === cleanPath || n.id === `file::${cleanPath}`));
      if (fileNode) {
        highlightNodes.add(fileNode.id);
        rawLinks.forEach(l => {
          const sId = typeof l.source === 'object' ? l.source.id : l.source;
          const tId = typeof l.target === 'object' ? l.target.id : l.target;
          if (sId === fileNode.id && highlightNodes.has(tId)) {
            highlightLinks.add(l);
          }
        });
      }
    }

    // 3. Highlight direct children (subsections) & direct doc_links (references)
    rawLinks.forEach(l => {
      const sId = typeof l.source === 'object' ? l.source.id : l.source;
      const tId = typeof l.target === 'object' ? l.target.id : l.target;
      if (sId === node.id) {
        highlightLinks.add(l);
        highlightNodes.add(tId);
      } else if (tId === node.id) {
        highlightLinks.add(l);
        highlightNodes.add(sId);
      }
    });
  }

  // Refresh 3D Graph elements and sync label visibility
  if (Graph) {
    Graph.nodeColor(Graph.nodeColor())
      .linkColor(Graph.linkColor())
      .linkWidth(Graph.linkWidth())
      .linkDirectionalParticles(Graph.linkDirectionalParticles());
  }
  updateLabelsVisibility();
}

function clearHighlight() {
  highlightNodes.clear();
  highlightLinks.clear();
  activeNode = null;
  if (selectedTreeNodeEl) {
    selectedTreeNodeEl.classList.remove('selected');
    selectedTreeNodeEl = null;
  }
  if (Graph) {
    Graph.nodeColor(Graph.nodeColor())
      .linkColor(Graph.linkColor())
      .linkWidth(Graph.linkWidth())
      .linkDirectionalParticles(Graph.linkDirectionalParticles());
  }
  updateLabelsVisibility();
}

// ─── 2. Auto Rotate ───────────────────────────────────────────────
function initAutoRotate() {
  const btn = document.getElementById('btn-rotate');
  if (!btn) return;
  btn.addEventListener('click', () => {
    isRotating = !isRotating;
    btn.classList.toggle('active', isRotating);
    btn.style.color = isRotating ? '#3fb950' : '';
    btn.style.borderColor = isRotating ? '#238636' : '';

    if (isRotating) {
      let angle = 0;
      const distance = 130; // Compact orbital distance
      window._rotateTimer = setInterval(() => {
        if (!isRotating) { clearInterval(window._rotateTimer); return; }
        angle += Math.PI / 800;
        if (Graph) {
          Graph.cameraPosition({
            x: distance * Math.sin(angle),
            z: distance * Math.cos(angle)
          });
        }
      }, 20);
    } else {
      clearInterval(window._rotateTimer);
    }
  });
}


function autoFrameGraph() {
  if (!Graph) return;
  updateGraphSize();
  const nodes = (filteredData.nodes || []);
  if (nodes.length === 0) return;

  if (nodes.length === 1) {
    const singleNode = nodes[0];
    const tx = singleNode.x || 0;
    const ty = singleNode.y || 0;
    const tz = singleNode.z || 0;
    // Aim directly at the single node and frame it dead-center in the 3D viewport
    Graph.cameraPosition(
      { x: tx, y: ty, z: tz + 90 },
      { x: tx, y: ty, z: tz },
      600
    );
  } else if (nodes.length <= 4) {
    Graph.zoomToFit(600, 45);
  } else {
    Graph.zoomToFit(600, 22);
  }
}

function resetCamera() {
  clearHighlight();
  autoFrameGraph();
}


function getNodeProject(n) {
  if (n.project) return n.project;
  const f = (n.file || n.abs_path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  for (const p of allProjectsList) {
    if (p.name === 'PythonCode') continue;
    if (f === p.name || f.startsWith(p.name + '/')) {
      return p.name;
    }
  }
  return 'PythonCode';
}

function getNodeRelativePathInProject(n, projName) {
  let f = (n.file || n.abs_path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (projName !== 'PythonCode' && f.startsWith(projName + '/')) {
    f = f.substring(projName.length + 1);
  }
  return f;
}

// ─── 3. Project & Graph Data Loading ──────────────────────────────
function persistSelectedProjects() {
  try { localStorage.setItem(PROJECTS_SEL_KEY, JSON.stringify(Array.from(selectedProjects))); } catch (e) { /* ignore */ }
}

function loadProjects(opts = {}) {
  const bPreserve = !!opts.preserve;
  const vPrev = bPreserve ? Array.from(selectedProjects) : null;

  fetch('/api/projects')
    .then(res => res.json())
    .then(projects => {
      allProjectsList = projects || [];
      renderRepoTable(allProjectsList);

      // Selection priority: explicit preserve (Refresh) > localStorage >
      // default (every indexed project).
      selectedProjects.clear();
      const vNames = new Set(allProjectsList.map(p => p.name));
      let vChosen = null;
      if (bPreserve && vPrev) {
        vChosen = vPrev;
      } else {
        try { vChosen = JSON.parse(localStorage.getItem(PROJECTS_SEL_KEY) || 'null'); } catch (e) { vChosen = null; }
      }
      if (Array.isArray(vChosen) && vChosen.length) {
        vChosen.filter(n => vNames.has(n)).forEach(n => selectedProjects.add(n));
      } else {
        allProjectsList.forEach(p => {
          if (p.status === 'ready') selectedProjects.add(p.name);
        });
      }
      // Saved selection may all be stale -> make sure something is active
      if (selectedProjects.size === 0 && allProjectsList.length > 0) {
        allProjectsList.forEach(p => {
          if (p.status === 'ready') selectedProjects.add(p.name);
        });
      }
      persistSelectedProjects();

      // First run only (zero repos registered): guide the user straight into
      // repo setup instead of a blank screen. Repos that exist but hold no
      // files yet must NOT trigger this — the user already did the setup.
      if (allProjectsList.length === 0) {
        buildProjectTree();
        showToast(currentLanguage === 'zh' ? '👋 知識庫是空的 — 先加入文件目錄吧' : '👋 Knowledge base is empty — add a directory to begin');
        // bRefresh=false: this call is INSIDE loadProjects — re-triggering a
        // refresh here would recurse forever (loadProjects -> openPathModal
        // -> loadProjects -> ...) and flood /api/projects (~200 req/s).
        openPathModal(false);
        return;
      }

      if (allProjectsList.length > 0) {
        loadMasterGraphAndFilter();
      }
    })
    .catch(err => console.error('Failed to load projects:', err));
}

function loadMasterGraphAndFilter() {
  if (allProjectsList.length === 0) return;

  // Multi-repo merge: ask the server for EVERY known project path so the
  // merged payload carries an explicit `project` on each node (deepest repo
  // wins on duplicates). Repos without an index simply contribute nothing.
  const strParams = allProjectsList
    .filter(p => p && p.path)
    .map(p => 'path=' + encodeURIComponent(p.path))
    .join('&');

  fetch(`/api/graph${strParams ? '?' + strParams : ''}`)
    .then(res => res.json())
    .then(data => {
      masterGraphData = data || { nodes: [], links: [] };
      filterGraphBySelectedProjects(true);
    })
    .catch(err => console.error('Failed to load graph:', err));
}

function filterGraphBySelectedProjects(isInitial = false) {
  if (!masterGraphData.nodes) return;

  const activeNodes = masterGraphData.nodes.filter(n => {
    const pName = getNodeProject(n);
    return selectedProjects.has(pName);
  });

  const nodeSet = new Set(activeNodes.map(n => n.id));
  const activeLinks = (masterGraphData.links || []).filter(l => {
    const src = typeof l.source === 'object' ? l.source.id : l.source;
    const tgt = typeof l.target === 'object' ? l.target.id : l.target;
    return nodeSet.has(src) && nodeSet.has(tgt);
  });

  rawData = { nodes: activeNodes, links: activeLinks };

  applyLODAndFilter();
  buildProjectTree();
  buildLegends();

  // If currently active node is not in active set, re-select
  if (activeNode && !nodeSet.has(activeNode.id)) {
    activeNode = null;
  }
  if (!activeNode && activeNodes.length > 0) {
    const firstFile = activeNodes.find(n => n.kind === 'file') || activeNodes[0];
    selectActiveNode(firstFile);
    syncExplorerSelection(firstFile);
  } else if (activeNodes.length === 0) {
    clearHighlight();
  }
}

// ─── 4. Explorer Tree (Exact Hierarchical Tree Architecture) ──────
function buildProjectTree() {
  const container = document.getElementById('tree-container');
  if (!container) return;

  // Snapshot currently open folders and selection
  const openProjs = new Set();
  const openDirs = new Set();
  const openFiles = new Set();

  container.querySelectorAll('.tree-children.open').forEach(childEl => {
    const prev = childEl.previousElementSibling;
    if (prev) {
      const p = prev.getAttribute('data-tree-proj');
      const d = prev.getAttribute('data-tree-dir');
      const f = prev.getAttribute('data-tree-file');
      if (p) openProjs.add(p);
      if (d) openDirs.add(d);
      if (f) openFiles.add(f);
    }
  });

  const selectedKey = selectedTreeNodeEl ? (
    selectedTreeNodeEl.getAttribute('data-tree-node-id') ||
    selectedTreeNodeEl.getAttribute('data-tree-file') ||
    selectedTreeNodeEl.getAttribute('data-tree-dir') ||
    selectedTreeNodeEl.getAttribute('data-tree-proj')
  ) : null;

  // Keep the user's scroll position across rebuilds (P1)
  const prevScrollTop = container.scrollTop;

  container.innerHTML = '';
  const summaryEl = document.getElementById('lbl-proj-summary');
  if (summaryEl) summaryEl.innerText = `${selectedProjects.size} Active`;

  // Build recursive directory structure for projects
  const projRoots = {};

  // Map from masterGraphData (or rawData if master not ready) so tree always has accurate structure
  const sourceNodes = (masterGraphData.nodes && masterGraphData.nodes.length > 0) ? masterGraphData.nodes : (rawData.nodes || []);
  sourceNodes.forEach(n => {
    const proj = getNodeProject(n);
    if (!projRoots[proj]) {
      projRoots[proj] = { name: proj, dirs: {}, files: {} };
    }

    const relPath = getNodeRelativePathInProject(n, proj);
    if (!relPath) return;

    const parts = relPath.split('/');
    const fileName = parts.pop();

    let currentDir = projRoots[proj];
    let accumulatedPath = '';

    parts.forEach(p => {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${p}` : p;
      if (!currentDir.dirs[p]) {
        currentDir.dirs[p] = {
          name: p,
          path: accumulatedPath,
          dirs: {},
          files: {}
        };
      }
      currentDir = currentDir.dirs[p];
    });

    if (!currentDir.files[fileName]) {
      currentDir.files[fileName] = {
        name: fileName,
        path: n.file || relPath,
        symbols: [],
        node: null
      };
    }

    if (n.kind === 'file') {
      currentDir.files[fileName].node = n;
    } else {
      currentDir.files[fileName].symbols.push(n);
    }
  });

  // Galaxy-style: merge real filesystem entries that are NOT in the DB, so
  // the tree shows the true folder hierarchy (pending for indexed repos,
  // full disk list for unindexed ones). Rendered with an amber badge.
  (allProjectsList || []).forEach(p => {
    const extra = (p.pending_files && p.pending_files.length)
      ? p.pending_files : (p.unindexed_files || []);
    if (!extra.length) return;
    if (!projRoots[p.name]) projRoots[p.name] = { name: p.name, dirs: {}, files: {} };
    const vRoot = projRoots[p.name];
    extra.forEach(rel => {
      const parts = (rel || '').split('/');
      const fName = parts.pop();
      if (!fName) return;
      let cur = vRoot, acc = '';
      parts.forEach(seg => {
        acc = acc ? acc + '/' + seg : seg;
        if (!cur.dirs[seg]) cur.dirs[seg] = { name: seg, path: acc, dirs: {}, files: {} };
        cur = cur.dirs[seg];
      });
      if (!cur.files[fName]) {
        cur.files[fName] = { name: fName, path: rel, symbols: [], node: null, is_unindexed: true };
      }
    });
  });

  // Empty dirs from disk (all_dirs): freshly created folders hold no files
  // yet, so no file entry implies them — merge the chain so New Folder
  // results stay visible in the tree.
  (allProjectsList || []).forEach(p => {
    const vDirs = p.all_dirs || [];
    if (!vDirs.length) return;
    if (!projRoots[p.name]) projRoots[p.name] = { name: p.name, dirs: {}, files: {} };
    const vR = projRoots[p.name];
    vDirs.forEach(rel => {
      let cur = vR, acc = '';
      (rel || '').split('/').forEach(seg => {
        if (!seg) return;
        acc = acc ? acc + '/' + seg : seg;
        if (!cur.dirs[seg]) cur.dirs[seg] = { name: seg, path: acc, dirs: {}, files: {} };
        cur = cur.dirs[seg];
      });
    });
  });

  // Sources follow their md: md_sources maps md rel -> header-recorded
  // source rels (existing files only). Attached onto the md's file entry;
  // orphans (recorded in no md header) are never shown.
  const findFileEntry = (root, rel) => {
    const parts = (rel || '').split('/');
    const fn = parts.pop();
    if (!fn) return null;
    let cur = root;
    for (const seg of parts) {
      if (!cur.dirs[seg]) return null;
      cur = cur.dirs[seg];
    }
    return (cur.files && cur.files[fn]) || null;
  };
  if (isShowSource()) {
    (allProjectsList || []).forEach(p => {
      const mapping = p.md_sources || {};
      const keys = Object.keys(mapping);
      if (!keys.length) return;
      if (!projRoots[p.name]) projRoots[p.name] = { name: p.name, dirs: {}, files: {} };
      const vRt = projRoots[p.name];
      keys.forEach(mdRel => {
        const entry = findFileEntry(vRt, mdRel);
        if (entry && !entry.is_source) entry.sources = mapping[mdRel] || [];
      });
    });
  }

  // Render All Projects
  allProjectsList.forEach(proj => {
    const projName = proj.name;
    const isSelected = selectedProjects.has(projName);
    const projData = projRoots[projName] || { dirs: {}, files: {} };
    const isProjOpen = openProjs.size === 0 ? true : openProjs.has(projName);

    const projNodeEl = document.createElement('div');
    projNodeEl.className = 'tree-node';
    projNodeEl.setAttribute('data-tree-proj', projName);

    // Unindexed projects stay visible as todo entries with an inline Create Index action.
    const vProjIndexed = proj.status === 'ready' || proj.is_indexed || proj.has_db;
    const vProjZh = currentLanguage === 'zh';
    const vProjEsc = (proj.path || '').replace(/\\/g, '\\\\');

    projNodeEl.innerHTML = `
      <span class="tree-arrow ${isProjOpen ? 'open' : ''}">▸</span>
      <input type="checkbox" ${isSelected ? 'checked' : ''} title="Toggle project inclusion" />
      <span title="${escapeHtml(projName)}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:#58a6ff;">📦 ${escapeHtml(projName)}</span>
      <button class="mini-btn" style="margin-left:auto; padding:1px 8px; font-size:11px;" title="${vProjZh ? '在此專案新增文件…（開啟 LLM 摘要入庫對話框）' : 'New document here… (open LLM summary ingest dialog)'}" onclick="event.stopPropagation();treeNewDocument('${vProjEsc}')">＋</button>
      <span class="node-kind-tag" style="margin-left:6px;">${proj.files || Object.keys(projData.files).length} files</span>
      ${vProjIndexed ? '' : `<button class="mini-btn" style="margin-left:6px; padding:1px 8px; font-size:10px; border-color:#9e6a03; color:#d29922;" title="${vProjZh ? '建立索引後才會出現在圖上' : 'Index it to show its nodes in the graph'}" onclick="event.stopPropagation();initRepo('${vProjEsc}', this)">${vProjZh ? '＋ 建立索引' : '＋ Create Index'}</button>`}
    `;

    const projChildrenEl = document.createElement('div');
    projChildrenEl.className = `tree-children ${isProjOpen ? 'open' : ''}`;

    const cb = projNodeEl.querySelector('input[type="checkbox"]');
    cb.onclick = (e) => {
      e.stopPropagation();
      if (cb.checked) selectedProjects.add(projName);
      else selectedProjects.delete(projName);
      persistSelectedProjects();
      filterGraphBySelectedProjects(false);
    };

    const arrow = projNodeEl.querySelector('.tree-arrow');
    arrow.onclick = (e) => {
      e.stopPropagation();
      projChildrenEl.classList.toggle('open');
      arrow.classList.toggle('open');
    };

    projNodeEl.onclick = () => {
      selectTreeNode(projNodeEl);
      highlightScope('project', { name: projName });
    };

    if (selectedKey === projName) {
      selectTreeNode(projNodeEl);
    }

    renderDirContents(projName, projData, projChildrenEl, openDirs, openFiles, selectedKey);

    container.appendChild(projNodeEl);
    container.appendChild(projChildrenEl);
  });

  // Restore scroll position after the full rebuild
  container.scrollTop = prevScrollTop;
  paintShowSourceBtn();
}

// Explorer "Show source" toggle: list ingest source files (ppt/pdf/word)
// next to the md docs. Default ON, remembered in localStorage.
const SRC_VIS_KEY = 'docgraphical-show-source';
function isShowSource() {
  try { const v = localStorage.getItem(SRC_VIS_KEY); return v === null ? true : v === '1'; }
  catch (e) { return true; }
}
function toggleShowSource() {
  const v = !isShowSource();
  try { localStorage.setItem(SRC_VIS_KEY, v ? '1' : '0'); } catch (e) { /* ignore */ }
  paintShowSourceBtn();
  if (typeof buildProjectTree === 'function') buildProjectTree();
}
function paintShowSourceBtn() {
  const el = document.getElementById('btn-toggle-src');
  if (!el) return;
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const on = isShowSource();
  el.textContent = on ? '👁 Source' : '🚫 Source';
  el.title = zh ? (on ? '隱藏來源檔案（ppt／pdf／word）' : '顯示來源檔案（ppt／pdf／word）')
                : (on ? 'Hide source files (ppt/pdf/word)' : 'Show source files (ppt/pdf/word)');
}
// Recursive file count under a tree dir node (md docs only — sources excluded).
function countDirFiles(d) {
  if (!d) return 0;
  let n = 0;
  Object.values(d.files || {}).forEach(f => { if (f && !f.is_source) n++; });
  Object.values(d.dirs || {}).forEach(s => { n += countDirFiles(s); });
  return n;
}
// Inline ＋ on project/dir rows: same dialog as the ctx-menu New document.
function treeNewDocument(absPath) {
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  if (typeof openIngestDialog === 'function') openIngestDialog(absPath);
  else showToast(zh ? '⏳ 文件匯入即將推出' : '⏳ Document ingest coming soon');
}
// Ctx-menu / inline New Folder: mkdir under absPath, then refresh the tree
// (all_dirs from the backend makes the empty folder visible).
function treeNewFolder(absPath) {
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  if (!absPath) { showToast(zh ? '❌ 無目標路徑' : '❌ No target path'); return; }
  const name = (window.prompt(zh ? `新資料夾名稱（建在 ${absPath} 下）` : `New folder name (under ${absPath})`, '') || '').trim();
  if (!name) return;
  fetch('/api/browse/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent: absPath, name: name })
  })
    .then(r => r.json().then(d => ({ status: r.status, body: d })))
    .then(({ status, body }) => {
      if (status === 200 && body.success) {
        showToast((zh ? '📁 已建立：' : '📁 Created: ') + body.path);
        if (typeof loadProjects === 'function') loadProjects({ preserve: true });
      } else {
        showToast('❌ ' + ((body && body.error) || status));
      }
    })
    .catch(err => showToast('❌ ' + err));
}

// Inline − on md rows: delete the md + its header-recorded sources + index.
// Always asks first (native confirm lists exactly what will go).
function treeDeleteFile(absPath, displayName) {
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  if (!absPath) { showToast(zh ? '❌ 無目標路徑' : '❌ No target path'); return; }
  const name = displayName || absPath.split('\\').pop() || absPath;
  const ok = window.confirm(zh
    ? `確定刪除「${name}」？\n\nmd 本體＋它 header 記載的來源檔會一起砍掉，索引同步移除。\n此動作無法復原。`
    : `Delete "${name}"?\n\nThe md plus its header-recorded source files will be removed and the index updated.\nThis cannot be undone.`);
  if (!ok) return;
  fetch('/api/ingest/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: absPath })
  })
    .then(r => r.json().then(d => ({ status: r.status, body: d })))
    .then(({ status, body }) => {
      if (status === 200 && body.success) {
        const n = (body.deleted || []).length;
        const miss = (body.missing || []).length;
        showToast((zh ? `🗑 已刪除 ${n} 個檔案` : `🗑 Deleted ${n} file(s)`)
          + (miss ? (zh ? `（${miss} 個找不到，略過）` : ` (${miss} missing, skipped)`) : ''));
        if (typeof loadProjects === 'function') loadProjects({ preserve: true });
      } else {
        showToast('❌ ' + ((body && body.error) || status));
      }
    })
    .catch(err => showToast('❌ ' + err));
}

// Recursive directory & file renderer
function renderDirContents(projName, dirObj, parentEl, openDirs, openFiles, selectedKey) {
  if (!dirObj) return;

  // 1. Render Subdirectories (Folders)
  const dirNames = Object.keys(dirObj.dirs || {}).sort();
  dirNames.forEach(dName => {
    const subDir = dirObj.dirs[dName];
    const cleanSubPath = (subDir.path || '').replace(/\\/g, '/');
    const dirKey = `${projName}:${cleanSubPath}`;
    const isDirOpen = openDirs ? openDirs.has(dirKey) : false;

    const dirNodeEl = document.createElement('div');
    dirNodeEl.className = 'tree-node';
    dirNodeEl.setAttribute('data-tree-dir', dirKey);

    // Folder badge (recursive file count) + inline ＋ (same as New document).
    const vDirZh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
    const vDirCount = countDirFiles(subDir);
    const vDirAbs = resolveTreeAbsPath(projName, cleanSubPath);
    const vDirEsc = (vDirAbs || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    dirNodeEl.innerHTML = `
      <span class="tree-arrow ${isDirOpen ? 'open' : ''}">▸</span>
      <span title="${escapeHtml(dName)}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:#e6edf3;">📁 ${escapeHtml(dName)}</span>
      <button class="mini-btn" style="margin-left:auto; padding:1px 8px; font-size:11px;" title="${vDirZh ? `在此資料夾新增文件…（${escapeHtml(vDirAbs)}）` : `New document here… (${escapeHtml(vDirAbs)})`}" onclick="event.stopPropagation();treeNewDocument('${vDirEsc}')">＋</button>
      ${vDirCount > 0 ? `<span class="node-kind-tag" style="margin-left:6px;">${vDirCount} files</span>` : ''}
    `;

    const dirChildrenEl = document.createElement('div');
    dirChildrenEl.className = `tree-children ${isDirOpen ? 'open' : ''}`;

    const arrow = dirNodeEl.querySelector('.tree-arrow');
    arrow.onclick = (e) => {
      e.stopPropagation();
      dirChildrenEl.classList.toggle('open');
      arrow.classList.toggle('open');
    };

    dirNodeEl.onclick = () => {
      selectTreeNode(dirNodeEl);
      highlightScope('dir', { project: projName, dir_path: cleanSubPath });
    };

    if (selectedKey === dirKey) {
      selectTreeNode(dirNodeEl);
    }

    renderDirContents(projName, subDir, dirChildrenEl, openDirs, openFiles, selectedKey);

    parentEl.appendChild(dirNodeEl);
    parentEl.appendChild(dirChildrenEl);
  });

  // 2. Render Markdown Files in this directory
  const fileNames = Object.keys(dirObj.files || {}).sort();
  fileNames.forEach(fName => {
    const fileData = dirObj.files[fName];
    const symList = fileData.symbols || [];
    const bUnindexed = !!fileData.is_unindexed;
    const bUzh = currentLanguage === 'zh';
    const cleanFilePath = (fileData.path || '').replace(/\\/g, '/');
    const fileKey = `${projName}:${cleanFilePath}`;
    const isFileOpen = openFiles ? openFiles.has(fileKey) : false;

    const fileNode = fileData.node || {
      id: `file::${cleanFilePath}`,
      name: fName,
      kind: 'file',
      project: projName,
      file: cleanFilePath,
      line: 1
    };

    const fileNodeEl = document.createElement('div');
    fileNodeEl.className = 'tree-node';
    fileNodeEl.setAttribute('data-tree-file', fileKey);
    fileNodeEl.setAttribute('data-tree-node-id', fileNode.id || `file::${cleanFilePath}`);
    fileNodeEl.setAttribute('data-tree-proj', projName);
    fileNodeEl.setAttribute('data-tree-file-path', cleanFilePath);

    // Long names truncate with … (badge + delete stay visible); full name on hover.
    const vIsMd = /\.md$/i.test(fName || '');
    const vFileAbs = resolveTreeAbsPath(projName, cleanFilePath);
    const vFileEsc = (vFileAbs || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const vNameEsc = (fName || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    fileNodeEl.innerHTML = `
      <span class="tree-arrow ${isFileOpen ? 'open' : ''}" style="${bUnindexed ? 'visibility:hidden;' : ''}">▸</span>
      <span title="${escapeHtml(fName)}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${bUnindexed ? '#d29922' : '#c9d1d9'};">📄 ${escapeHtml(fName)}</span>
      ${vIsMd ? `<button class="mini-btn" style="padding:0 7px;font-size:11px;flex-shrink:0;border-color:#5a2d2d;color:#f85149;" title="${bUzh ? `刪除「${escapeHtml(fName)}」（md＋來源檔＋索引，需確認）` : `Delete "${escapeHtml(fName)}" (md + sources + index, asks first)`}" onclick="event.stopPropagation();treeDeleteFile('${vFileEsc}', '${vNameEsc}')">−</button>` : ''}
      ${bUnindexed
        ? `<span class="node-kind-tag" style="flex-shrink:0;margin-left:6px;background:#3a2e12;color:#d29922;border:1px solid #9e6a03;">${bUzh ? '⏳ 待索引' : '⏳ unindexed'}</span>`
        : `<span class="node-kind-tag" style="flex-shrink:0;margin-left:6px;">${symList.length}h</span>`}
    `;

    const fileChildrenEl = document.createElement('div');
    fileChildrenEl.className = `tree-children ${isFileOpen ? 'open' : ''}`;

    const arrow = fileNodeEl.querySelector('.tree-arrow');
    if (arrow) {
      arrow.onclick = (e) => {
        e.stopPropagation();
        fileChildrenEl.classList.toggle('open');
        arrow.classList.toggle('open');
      };
    }

    fileNodeEl.onclick = () => {
      selectTreeNode(fileNodeEl);
      if (bUnindexed) {
        showToast(currentLanguage === 'zh' ? '⏳ 尚未索引 — 用 Sync 納入' : '⏳ Not indexed yet — Sync to include it');
        return;
      }
      highlightScope('file', { project: projName, file: cleanFilePath, node: fileNode, symbols: symList });
      selectActiveNode(fileNode);
      focusOnNode(fileNode);
    };

    if (selectedKey === fileKey) {
      selectTreeNode(fileNodeEl);
    }

    // 3a. Header-recorded sources hang directly under their md (toggle-gated).
    const vSrcList = fileData.sources || [];
    if (vSrcList.length) {
      const vPe = (allProjectsList || []).find(p => p.name === projName);
      const vRepoPath = (vPe && vPe.path) || '';
      vSrcList.forEach(srcRel => {
        const sName = (srcRel || '').split('/').pop() || srcRel;
        const sExt = (sName.split('.').pop() || '').toLowerCase();
        const sUrl = vRepoPath ? `/api/ingest/source?repo=${encodeURIComponent(vRepoPath)}&file=${encodeURIComponent(srcRel)}` : '';
        const sEl = document.createElement('div');
        sEl.className = 'tree-node';
        sEl.setAttribute('data-tree-src', '1');
        sEl.setAttribute('data-tree-proj', projName);
        sEl.setAttribute('data-tree-file-path', srcRel);
        sEl.innerHTML = `
          <span class="tree-arrow" style="visibility:hidden;">▸</span>
          <span title="${escapeHtml(srcRel)}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8b949e;">📎 ${escapeHtml(sName)}</span>
          <span class="node-kind-tag" style="flex-shrink:0;margin-left:6px;background:#21262d;color:#8b949e;border:1px solid #30363d;">${escapeHtml(sExt) || 'src'}</span>
        `;
        sEl.onclick = () => {
          selectTreeNode(sEl);
          if (sUrl) window.open(sUrl, '_blank', 'noopener');
        };
        fileChildrenEl.appendChild(sEl);
      });
    }

    // 3. Convert flat headings into a nested AST hierarchy tree (Every level collapsible!)
    const sortedHeadings = symList.slice().sort((a, b) => (a.line || 0) - (b.line || 0));
    const headingTree = buildHeadingTree(sortedHeadings);
    renderNestedHeadingTree(headingTree, fileChildrenEl, openDirs, selectedKey);

    parentEl.appendChild(fileNodeEl);
    parentEl.appendChild(fileChildrenEl);
  });
}

// Build hierarchical AST tree from flat headings list
function buildHeadingTree(flatHeadings) {
  const root = [];
  const stack = [{ level: 0, children: root }];

  flatHeadings.forEach(h => {
    const node = { ...h, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= (h.level || 1)) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });

  return root;
}

// Render nested heading AST tree with collapsible levels
function renderNestedHeadingTree(headingNodes, parentEl, openDirs, selectedKey) {
  if (!headingNodes || headingNodes.length === 0) return;

  headingNodes.forEach(h => {
    const hasChildren = h.children && h.children.length > 0;
    const isHeadingOpen = openDirs ? openDirs.has(h.id) : false;

    const hNodeEl = document.createElement('div');
    hNodeEl.className = 'tree-node';
    hNodeEl.setAttribute('data-tree-node-id', h.id);

    hNodeEl.innerHTML = `
      <span class="tree-arrow ${isHeadingOpen ? 'open' : ''}" style="${hasChildren ? '' : 'visibility:hidden;'}">▸</span>
      <span style="color:${KIND_COLORS[h.kind] || '#58a6ff'}; margin-right:4px; font-weight:700; font-size:11px;">${'#'.repeat(h.level || 1)}</span>
      <span title="${escapeHtml(h.name)}" style="flex:1;min-width:0;color:#e6edf3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${escapeHtml(h.name)}</span>
      <span class="tree-line-badge" style="margin-left:auto; font-size:10px; color:#6e7681;">L${h.line || 1}</span>
    `;

    const hChildrenEl = document.createElement('div');
    hChildrenEl.className = `tree-children ${isHeadingOpen ? 'open' : ''}`;

    const arrow = hNodeEl.querySelector('.tree-arrow');
    if (arrow && hasChildren) {
      arrow.onclick = (e) => {
        e.stopPropagation();
        hChildrenEl.classList.toggle('open');
        arrow.classList.toggle('open');
      };
    }

    hNodeEl.onclick = (e) => {
      e.stopPropagation();
      selectTreeNode(hNodeEl);
      highlightScope('node', h);
      focusOnNode(h);
      selectActiveNode(h);
    };

    if (selectedKey === h.id) {
      selectTreeNode(hNodeEl);
    }

    parentEl.appendChild(hNodeEl);
    if (hasChildren) {
      renderNestedHeadingTree(h.children, hChildrenEl, openDirs, selectedKey);
      parentEl.appendChild(hChildrenEl);
    }
  });
}

function selectTreeNode(el) {
  if (selectedTreeNodeEl) selectedTreeNodeEl.classList.remove('selected');
  selectedTreeNodeEl = el;
  if (el) el.classList.add('selected');
}

function syncExplorerSelection(node) {
  if (!node) return;
  const cleanPath = (node.file || '').replace(/\\/g, '/');
  const projName = getNodeProject(node);
  let targetEl = null;

  // 1. Direct match by exact node ID (file or heading) across all tree nodes
  if (node.id) {
    const allNodes = document.querySelectorAll('#tree-container .tree-node');
    for (const el of allNodes) {
      if (el.getAttribute('data-tree-node-id') === node.id) {
        targetEl = el;
        break;
      }
    }
  }

  // 2. Exact match by project and exact file path for file nodes
  if (!targetEl && (node.kind === 'file' || cleanPath)) {
    const allFileEls = document.querySelectorAll('#tree-container [data-tree-file]');
    for (const el of allFileEls) {
      const elNodeId = el.getAttribute('data-tree-node-id') || '';
      const elProj = el.getAttribute('data-tree-proj') || '';
      const elFilePath = el.getAttribute('data-tree-file-path') || '';
      const elFileKey = el.getAttribute('data-tree-file') || '';

      if (node.id && elNodeId === node.id) {
        targetEl = el;
        break;
      }
      if (projName && elProj === projName && (elFilePath === cleanPath || elFileKey === `${projName}:${cleanPath}`)) {
        targetEl = el;
        break;
      }
      if (elFilePath === cleanPath) {
        targetEl = el;
        break;
      }
    }
  }

  // 3. Highlight and open all ancestor parent containers
  if (targetEl) {
    selectTreeNode(targetEl);

    // Open parents recursively
    let p = targetEl.parentElement;
    while (p && p.id !== 'tree-container') {
      if (p.classList.contains('tree-children')) {
        p.classList.add('open');
        const prev = p.previousElementSibling;
        if (prev) {
          const arr = prev.querySelector('.tree-arrow');
          if (arr) arr.classList.add('open');
        }
      }
      p = p.parentElement;
    }

    targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function filterTree(q) {
  const query = (q || '').trim().toLowerCase();
  const container = document.getElementById('tree-container');
  if (!container) return;
  const vNodes = Array.from(container.querySelectorAll('.tree-node'));

  if (!query) {
    vNodes.forEach(el => { el.style.display = 'flex'; });
    container.querySelectorAll('.tree-children').forEach(c => { c.style.display = ''; });
    return;
  }

  // Show every match PLUS all of its ancestors (project/dir rows), so a hit
  // deep in the hierarchy is never hidden behind collapsed parents.
  const showSet = new Set();
  vNodes.forEach(el => {
    const text = (el.innerText || '').toLowerCase();
    if (!text.includes(query)) return;
    showSet.add(el);
    let p = el.parentElement;
    while (p && p !== container) {
      if (p.classList && p.classList.contains('tree-node')) showSet.add(p);
      p = p.parentElement;
    }
  });

  vNodes.forEach(el => {
    el.style.display = showSet.has(el) ? 'flex' : 'none';
  });

  // Auto-expand every container that holds a visible node; hide empty ones.
  container.querySelectorAll('.tree-children').forEach(c => {
    const vKids = Array.from(c.querySelectorAll('.tree-node'));
    const bAny = vKids.some(n => showSet.has(n));
    c.style.display = bAny ? '' : 'none';
    if (bAny) {
      c.classList.add('open');
      const prev = c.previousElementSibling;
      const arrow = prev ? prev.querySelector('.tree-arrow') : null;
      if (arrow) arrow.classList.add('open');
    }
  });
}

function clearTreeFilter() {
  const input = document.getElementById('tree-search');
  if (input) input.value = '';
  filterTree('');
}

function selectAllProjects(val) {
  allProjectsList.forEach(p => {
    if (val) selectedProjects.add(p.name);
    else selectedProjects.delete(p.name);
  });
  document.querySelectorAll('#tree-container input[type="checkbox"]').forEach(cb => cb.checked = val);
  persistSelectedProjects();
  filterGraphBySelectedProjects(false);
}

// ─── 5. Center Doc Stage & Right Links Updates ────────────────────
// md viewer context: owning project/repo + header source rels
// (drives source-file links + the viewer right-click menu).
let viewCtx = { project: '', file: '', repo: '', sources: [] };
function selectActiveNode(node) {
  if (!node) return;
  activeNode = node;

  const dName = document.getElementById('d-name');
  const dSub = document.getElementById('d-sub');
  if (dName) dName.innerText = node.name || 'Unnamed';
  if (dSub) dSub.innerText = `${node.file || ''} · Line ${node.line || 1}`;

  const badge = document.getElementById('d-kind-badge');
  if (badge) {
    badge.innerText = (node.kind || 'NODE').toUpperCase();
    badge.style.background = KIND_COLORS[node.kind] || '#1f6feb';
  }

  // Fetch Section / Full Content for Center Markdown Viewer
  const queryFile = node.abs_path || node.file || '';
  // Viewer context: owning project/repo (for source-file links + ctx menu).
  viewCtx = { project: '', file: (node.file || '').replace(/\\/g, '/'), repo: '', sources: [] };
  try { viewCtx.project = node.project || getNodeProject(node) || ''; } catch (e) { /* ignore */ }
  const vProjEntry = (allProjectsList || []).find(p => p.name === viewCtx.project);
  if (vProjEntry && vProjEntry.path) viewCtx.repo = vProjEntry.path;
  const headingParam = node.kind === 'file' ? '' : `&heading=${encodeURIComponent(node.name)}`;
  fetch(`/api/doc/section?file=${encodeURIComponent(queryFile)}${headingParam}&sub=1`)
    .then(res => res.json())
    .then(data => {
      const content = data.content || node.content || '';
      renderMarkdown(content);

      // Token Intelligence Metrics — full doc is the denominator, the slice
      // is the numerator (previously both were computed from the same text,
      // so heading savings were always 0.0%).
      const fullChars = (typeof data.full_chars === 'number' && data.full_chars > 0)
        ? data.full_chars : content.length;
      const fullTokens = Math.max(1, Math.ceil(fullChars / 3.8));
      const slicedTokens = Math.ceil(content.length / 3.8);
      const savings = node.kind === 'file' ? '0.0%' : `${Math.max(0, ((fullTokens - slicedTokens) / (fullTokens || 1)) * 100).toFixed(1)}%`;

      const savBadge = document.getElementById('stat-savings-badge');
      const savFill = document.getElementById('stat-savings-fill');
      const fTokens = document.getElementById('stat-full-tokens');
      const sTokens = document.getElementById('stat-sliced-tokens');

      if (savBadge) savBadge.textContent = savings;
      if (savFill) savFill.style.width = savings;
      if (fTokens) fTokens.textContent = `${fullTokens.toLocaleString()} tokens`;
      if (sTokens) sTokens.textContent = `${slicedTokens.toLocaleString()} tokens`;

      // Store in memory for 1-click Agent Copy
      window._activeSurgicalPayload = `[DocGraph Sliced Context: ${node.name} | ${node.file || ''} | Line ${node.line || 1}]\n${content}`;
    })
    .catch(err => {
      console.error('Section read error, falling back to cached content:', err);
      if (node.content) {
        renderMarkdown(node.content);
        // Honest fallback: the file is gone from disk (stale index) or the
        // server hiccuped — say so instead of silently showing full text.
        const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
        showToast(zh ? '⚠ 後端讀不到檔案（可能已刪除），顯示的是快取全文 — 請 Sync 更新'
                     : '⚠ File unreadable server-side (may be deleted), showing cached full text — Sync to refresh');
      }
    });

  // Update Right Column Lower Pane: Connected Relations & Links
  const rawLinks = rawData.links || [];
  const connectedLinks = rawLinks.filter(l => {
    const src = typeof l.source === 'object' ? l.source.id : l.source;
    const tgt = typeof l.target === 'object' ? l.target.id : l.target;
    return src === node.id || tgt === node.id;
  });

  const relList = document.getElementById('d-relations');
  const relCountEl = document.getElementById('d-rel-count');
  if (relCountEl) relCountEl.textContent = connectedLinks.length;

  if (relList) {
    relList.innerHTML = '';
    if (connectedLinks.length === 0) {
      relList.innerHTML = `<div style="font-size:11px; color:#8b949e; padding:8px;">${currentLanguage === 'zh' ? '此節點無關聯連結' : 'No connected links for this node'}</div>`;
    } else {
      connectedLinks.forEach(l => {
        const srcId = typeof l.source === 'object' ? l.source.id : l.source;
        const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
        const otherId = (srcId === node.id) ? tgtId : srcId;
        const otherNode = rawData.nodes.find(n => n.id === otherId);
        if (!otherNode) return;

        const isDocLink = l.kind === 'doc_link';
        const isOut = (srcId === node.id);

        let relLabel = '';
        if (currentLanguage === 'zh') {
          relLabel = isDocLink ? (isOut ? '參考引用' : '被引用') : (isOut ? '包含' : '上層');
        } else {
          relLabel = isDocLink ? (isOut ? 'References' : 'Referenced By') : (isOut ? 'Contains' : 'Parent');
        }

        // Color badge dynamically matching the target node's AST kind/level
        const targetColor = KIND_COLORS[otherNode.kind] || (isDocLink ? '#00ffaa' : '#58a6ff');
        const kindTagText = otherNode.kind === 'file' ? 'DOC' : ('H' + (otherNode.level || 1));

        const row = document.createElement('div');
        row.className = 'rel-row';
        row.style.cursor = 'pointer';
        row.innerHTML = `
          <span class="rel-kind" style="background:${targetColor}22; color:${targetColor}; border:1px solid ${targetColor}66;">${relLabel}</span>
          <span class="rel-target" style="color:#e6edf3; font-weight:500;">${escapeHtml(otherNode.name)}</span>
          <span class="node-kind-tag" style="background:${targetColor}18; color:${targetColor}; border:1px solid ${targetColor}44; margin-left:auto; font-size:10px;">${kindTagText}</span>
        `;
        row.onclick = () => {
          highlightScope('node', otherNode);
          focusOnNode(otherNode);
          selectActiveNode(otherNode);
          syncExplorerSelection(otherNode);
        };
        relList.appendChild(row);
      });
    }
  }
}

function renderMarkdown(mdText) {
  const container = document.getElementById('d-code-markdown');
  if (!container) return;
  // Ingest-md header sources: `> - `rel`` lines — remembered for linkify + menu.
  viewCtx.sources = [];
  ((mdText || '').match(/^> - `(.+)`$/gm) || []).forEach(l => {
    const r = l.replace(/^> - `|`$/g, '');
    if (r && viewCtx.sources.indexOf(r) < 0) viewCtx.sources.push(r);
  });
  if (window.marked) {
    container.innerHTML = marked.parse(mdText || '');
    container.querySelectorAll('pre code').forEach((block) => {
      if (window.hljs) hljs.highlightElement(block);
    });
    linkifySources(container);
  } else {
    container.innerText = mdText || '';
  }
  // Every new selection starts at the top — never inherit the old scroll
  // position (that made heading clicks look like "full doc minus the front").
  container.scrollTop = 0;
  // Viewer right-click menu (bound once).
  if (!container.dataset.viewCtxBound) {
    container.dataset.viewCtxBound = '1';
    container.addEventListener('contextmenu', openViewCtxMenu);
  }
}

// Turn header `> - `rel`` code spans into source-file links (new tab:
// pdf renders inline, office files download via /api/ingest/source).
function viewSourceUrl(rel) {
  if (!viewCtx.repo || !rel) return '';
  return `/api/ingest/source?repo=${encodeURIComponent(viewCtx.repo)}&file=${encodeURIComponent(rel)}`;
}
function linkifySources(container) {
  if (!viewCtx.sources.length || !viewCtx.repo) return;
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  container.querySelectorAll('blockquote code').forEach((code) => {
    const rel = (code.textContent || '').trim();
    if (viewCtx.sources.indexOf(rel) < 0) return;
    const url = viewSourceUrl(rel);
    if (!url) return;
    const a = document.createElement('a');
    a.className = 'src-link';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = rel;
    a.title = (zh ? '開啟來源檔案：' : 'Open source file: ') + rel;
    code.replaceWith(a);
  });
}

// ─── md viewer custom context menu ───
// Native selection + Ctrl+C work (CSS user-select:text); this menu adds:
// copy selection / copy section / copy-for-agent / open source / copy path.
let viewCtxEl = null;
function closeViewCtxMenu() {
  if (viewCtxEl) { viewCtxEl.remove(); viewCtxEl = null; }
  document.removeEventListener('click', closeViewCtxMenu);
}
function openViewCtxMenu(e) {
  const c = document.getElementById('d-code-markdown');
  if (!c || !c.contains(e.target)) return;
  e.preventDefault();
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const sel = (window.getSelection ? window.getSelection().toString() : '').trim();
  const items = [];
  if (sel) {
    items.push({ label: zh ? '📋 複製選取文字' : '📋 Copy selection', fn: () => {
      copyTextToClipboard(sel, zh ? '📋 已複製選取文字' : '📋 Selection copied');
    }});
  }
  items.push({ label: zh ? '📄 複製本節 Markdown' : '📄 Copy section markdown', fn: () => copyCurrentSection() });
  items.push({ label: zh ? '🤖 複製給 Agent' : '🤖 Copy for Agent', fn: () => copyMcpPayload() });
  (viewCtx.sources || []).slice(0, 5).forEach(rel => {
    const base = rel.split('/').pop();
    const url = viewSourceUrl(rel);
    if (!url) return;
    items.push({ label: (zh ? '📂 開啟來源檔案：' : '📂 Open source: ') + base, fn: () => window.open(url, '_blank', 'noopener') });
  });
  if (viewCtx.sources.length) {
    items.push({ label: zh ? '📁 複製來源絕對路徑' : '📁 Copy source absolute path', fn: () => {
      const abs = viewCtx.sources.map(r => `${viewCtx.repo}\\${r.replace(/\//g, '\\')}`).join('\n');
      copyTextToClipboard(abs, zh ? '📁 已複製來源路徑' : '📁 Source path copied');
    }});
  }
  if (!items.length) return;
  closeViewCtxMenu();
  viewCtxEl = document.createElement('div');
  viewCtxEl.style.cssText = 'position:fixed;z-index:1000006;min-width:200px;max-width:340px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.55);font-size:12px;color:#e6edf3;zoom:1.16;';
  items.forEach(it => {
    const row = document.createElement('div');
    row.textContent = it.label;
    row.style.cssText = 'padding:7px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    row.title = it.label;
    row.onmouseenter = () => { row.style.background = '#1f6feb44'; };
    row.onmouseleave = () => { row.style.background = ''; };
    row.onclick = (ev) => { ev.stopPropagation(); closeViewCtxMenu(); it.fn(); };
    viewCtxEl.appendChild(row);
  });
  document.body.appendChild(viewCtxEl);
  const mw = viewCtxEl.offsetWidth, mh = viewCtxEl.offsetHeight;
  let x = e.clientX, y = e.clientY;
  if (x + mw > window.innerWidth - 8) x = Math.max(8, window.innerWidth - mw - 8);
  if (y + mh > window.innerHeight - mh - 8) y = Math.max(8, window.innerHeight - mh - 8);
  viewCtxEl.style.left = x + 'px';
  viewCtxEl.style.top = y + 'px';
  setTimeout(() => document.addEventListener('click', closeViewCtxMenu), 0);
}

function copyCurrentSection() {
  const el = document.getElementById('d-code-markdown');
  if (!el) return;
  navigator.clipboard.writeText(el.innerText);
  showToast('📋 Sliced section markdown copied!');
}

function copyMcpPayload() {
  const payload = window._activeSurgicalPayload;
  if (!payload) {
    showToast('⚠️ No section selected yet');
    return;
  }
  navigator.clipboard.writeText(payload);
  showToast('🤖 AI Agent Sliced Payload copied to clipboard!');
}

// ─── 6. Mode / LOD & Legend Control ───────────────────────────────
function changeLOD(mode) {
  currentLOD = mode;
  document.querySelectorAll('.lod-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lod === mode);
  });

  hiddenKinds.clear();
  if (mode === 'arch') {
    // Documents only
    ['heading_1', 'heading_2', 'heading_3', 'heading_4', 'heading_5', 'heading_6'].forEach(k => hiddenKinds.add(k));
  } else if (mode === 'standard') {
    // Document + H1 + H2
    ['heading_3', 'heading_4', 'heading_5', 'heading_6'].forEach(k => hiddenKinds.add(k));
  } else if (mode === 'all') {
    // All
  }

  applyLODAndFilter();
  updateLegendUI();
}

function applyLODAndFilter() {
  const activeNodes = (rawData.nodes || []).filter(n => {
    if (hiddenKinds.has(n.kind)) return false;
    return true;
  });

  const nodeSet = new Set(activeNodes.map(n => n.id));
  const activeLinks = (rawData.links || []).filter(l => {
    const src = typeof l.source === 'object' ? l.source.id : l.source;
    const tgt = typeof l.target === 'object' ? l.target.id : l.target;
    return nodeSet.has(src) && nodeSet.has(tgt) && !hiddenEdgeKinds.has(l.kind);
  });

  filteredData = { nodes: activeNodes, links: activeLinks };
  if (Graph) {
    Graph.graphData(filteredData);
    setTimeout(() => {
      autoFrameGraph();
    }, 250);
  }

  const nBadge = document.getElementById('stats-nodes');
  const eBadge = document.getElementById('stats-edges');
  if (nBadge) nBadge.textContent = `${activeNodes.length} nodes`;
  if (eBadge) eBadge.textContent = `${activeLinks.length} links`;
}

function buildLegends() {
  const nodesList = document.getElementById('legend-nodes-list');
  if (!nodesList) return;
  nodesList.innerHTML = '';
  
  const kinds = [
    { kind: 'file', label: 'Document' },
    { kind: 'heading_1', label: 'H1 Section' },
    { kind: 'heading_2', label: 'H2 Section' },
    { kind: 'heading_3', label: 'H3 Subsection' },
    { kind: 'heading_4', label: 'H4 Detail' },
  ];

  kinds.forEach(item => {
    const count = (rawData.nodes || []).filter(n => n.kind === item.kind).length;
    const el = document.createElement('div');
    el.className = 'legend-item';
    el.classList.toggle('dimmed', hiddenKinds.has(item.kind));
    el.innerHTML = `
      <div class="legend-dot" style="background:${KIND_COLORS[item.kind] || '#58a6ff'};"></div>
      <span>${item.label}</span>
      <span class="legend-count-badge">${count}</span>
    `;
    el.onclick = () => {
      if (hiddenKinds.has(item.kind)) {
        hiddenKinds.delete(item.kind);
      } else {
        hiddenKinds.add(item.kind);
      }
      el.classList.toggle('dimmed', hiddenKinds.has(item.kind));
      applyLODAndFilter();
    };
    nodesList.appendChild(el);
  });

  const edgesList = document.getElementById('legend-edges-list');
  if (!edgesList) return;
  edgesList.innerHTML = '';
  const edgeKinds = [
    { kind: 'parent_child', label: 'AST Contains' },
    { kind: 'doc_link', label: 'Cross-Doc Reference' }
  ];

  edgeKinds.forEach(item => {
    const count = (rawData.links || []).filter(l => l.kind === item.kind).length;
    const el = document.createElement('div');
    el.className = 'legend-item';
    el.classList.toggle('dimmed', hiddenEdgeKinds.has(item.kind));
    el.innerHTML = `
      <div class="legend-dot" style="background:${item.kind === 'doc_link' ? '#00ffaa' : '#58a6ff'};"></div>
      <span>${item.label}</span>
      <span class="legend-count-badge">${count}</span>
    `;
    el.onclick = () => {
      if (hiddenEdgeKinds.has(item.kind)) hiddenEdgeKinds.delete(item.kind);
      else hiddenEdgeKinds.add(item.kind);
      el.classList.toggle('dimmed', hiddenEdgeKinds.has(item.kind));
      applyLODAndFilter();
    };
    edgesList.appendChild(el);
  });
}

function updateLegendUI() {
  document.querySelectorAll('#legend-nodes-list .legend-item').forEach(el => {
    const text = el.innerText;
    let matchKind = null;
    if (text.includes('Document')) matchKind = 'file';
    else if (text.includes('H1')) matchKind = 'heading_1';
    else if (text.includes('H2')) matchKind = 'heading_2';
    else if (text.includes('H3')) matchKind = 'heading_3';
    else if (text.includes('H4')) matchKind = 'heading_4';

    if (matchKind) el.classList.toggle('dimmed', hiddenKinds.has(matchKind));
  });
}

function switchLegendTab(tab) {
  const tNodes = document.getElementById('tab-btn-nodes');
  const tEdges = document.getElementById('tab-btn-edges');
  const lNodes = document.getElementById('legend-nodes-list');
  const lEdges = document.getElementById('legend-edges-list');
  if (tNodes) tNodes.classList.toggle('active', tab === 'nodes');
  if (tEdges) tEdges.classList.toggle('active', tab === 'edges');
  if (lNodes) lNodes.style.display = tab === 'nodes' ? 'flex' : 'none';
  if (lEdges) lEdges.style.display = tab === 'edges' ? 'flex' : 'none';
}

function resetFilters() {
  hiddenKinds.clear();
  // Default to Documents and H1 Section
  ['heading_2', 'heading_3', 'heading_4', 'heading_5', 'heading_6'].forEach(k => hiddenKinds.add(k));
  hiddenEdgeKinds.clear();
  applyLODAndFilter();
  buildLegends();
}


// ─── 7. Resizers (Tree, Doc, 3D and Links) ─────────────────────────

function updateSwapButtonI18n() {
  const btn = document.getElementById('btn-swap-panels');
  const lbl = document.getElementById('lbl-swap-text');
  const isSwapped = !!document.querySelector('#stage-col-center > #viewport-3d-pane');

  if (!btn || !lbl) return;

  if (currentLanguage === 'zh') {
    if (isSwapped) {
      lbl.textContent = '對調回右';
      btn.title = '對調回右側';
    } else {
      lbl.textContent = '左右對調';
      btn.title = '與 Markdown 瀏覽對調';
    }
  } else {
    if (isSwapped) {
      lbl.textContent = 'Swap Back';
      btn.title = 'Swap back to right';
    } else {
      lbl.textContent = 'Swap Panels';
      btn.title = 'Swap with Markdown reader';
    }
  }
}

function togglePanelsSwap() {
  const centerStage = document.getElementById('stage-col-center');
  const rightHub = document.getElementById('graph-panel');
  const resizer3DLinks = document.getElementById('resizer-3d-links');
  if (!centerStage || !rightHub) return;

  const docPanel = document.getElementById('doc-panel');
  const pane3D = document.getElementById('viewport-3d-pane');
  if (!docPanel || !pane3D) return;

  const isSwapped = !!centerStage.querySelector('#viewport-3d-pane');

  if (!isSwapped) {
    // SWAP: Move 3D Canvas into Center Stage; Move Markdown Reader into Right Upper Slot
    centerStage.appendChild(pane3D);
    rightHub.insertBefore(docPanel, resizer3DLinks);
  } else {
    // RESTORE: Move Markdown Reader back into Center Stage; Move 3D Canvas back into Right Upper Slot
    centerStage.appendChild(docPanel);
    rightHub.insertBefore(pane3D, resizer3DLinks);
  }

  updateSwapButtonI18n();
  updateControlsHelpI18n();

  if (!isSwapped) {
    showToast(currentLanguage === 'zh' ? '3D 圖已置中，Markdown 移至右側' : '3D Graph centered, Markdown in right panel');
  } else {
    showToast(currentLanguage === 'zh' ? '已恢復標準版面配置' : 'Standard layout restored');
  }

  // Preserve center node focus and adjust 3D viewport dimensions smoothly
  setTimeout(() => {
    updateGraphSize();
    if (Graph) {
      // Re-center active node or full graph dead-center without distortion
      if (activeNode) {
        focusOnNode(activeNode);
      } else {
        autoFrameGraph();
      }
    }
  }, 60);
}

function initColumnResizers() {
  // Resizer 1: Tree vs Doc
  const resizerTreeDoc = document.getElementById('resizer-tree-doc');
  const treePanel = document.getElementById('tree-panel');
  if (resizerTreeDoc && treePanel) {
    let isDragging = false;
    resizerTreeDoc.addEventListener('mousedown', (e) => {
      isDragging = true;
      resizerTreeDoc.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const newWidth = Math.max(180, Math.min(500, e.clientX));
      treePanel.style.width = `${newWidth}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizerTreeDoc.classList.remove('dragging');
        document.body.style.cursor = 'default';
      }
    });
  }

  // Resizer 2: Doc vs Graph Panel
  const resizerDoc3D = document.getElementById('resizer-doc-3d');
  const graphPanel = document.getElementById('graph-panel');
  if (resizerDoc3D && graphPanel) {
    let isDragging = false;
    resizerDoc3D.addEventListener('mousedown', (e) => {
      isDragging = true;
      resizerDoc3D.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const newWidth = Math.max(300, Math.min(window.innerWidth * 0.75, window.innerWidth - e.clientX));
      graphPanel.style.width = `${newWidth}px`;
      updateGraphSize();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizerDoc3D.classList.remove('dragging');
        document.body.style.cursor = 'default';
      }
    });
  }

  // Resizer 3: 3D Canvas vs Links (Vertical)
  const resizer3DLinks = document.getElementById('resizer-3d-links');
  const pane3D = document.getElementById('viewport-3d-pane');
  const graphContainer = document.getElementById('graph-panel');
  if (resizer3DLinks && pane3D && graphContainer) {
    let isDragging = false;
    let startY = 0;
    let startHeight = 0;

    resizer3DLinks.addEventListener('mousedown', (e) => {
      isDragging = true;
      startY = e.clientY;
      startHeight = pane3D.offsetHeight;
      resizer3DLinks.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dy = e.clientY - startY;
      const totalH = graphContainer.offsetHeight;
      const newH = Math.max(140, Math.min(totalH - 100, startHeight + dy));
      pane3D.style.height = `${newH}px`;
      updateGraphSize();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizer3DLinks.classList.remove('dragging');
        document.body.style.cursor = 'default';
      }
    });
  }
}

function toggleTreePanel() {
  isTreeOpen = !isTreeOpen;
  const p = document.getElementById('tree-panel');
  const b = document.getElementById('btn-toggle-tree');
  if (p) p.classList.toggle('hidden', !isTreeOpen);
  if (b) b.classList.toggle('active', isTreeOpen);
}


function openPathModal(bRefresh = true) {
  const m = document.getElementById('path-modal');
  if (m) m.classList.add('show');
  // bRefresh=false when called from inside loadProjects itself — otherwise
  // loadProjects -> openPathModal -> loadProjects recurses infinitely.
  if (bRefresh) loadProjects();
}

function closePathModal() {
  const m = document.getElementById('path-modal');
  if (m) m.classList.remove('show');
}

function submitAddPath() {
  const input = document.getElementById('custom-path-input');
  if (!input) return;
  const path = input.value.trim();
  if (!path) return;

  fetch('/api/paths/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      input.value = '';
      loadProjects();
      showToast('✅ Directory added & indexed!');
    } else {
      alert('Error: ' + res.error);
    }
  });
}

function renderRepoTable(projects) {
  const tbody = document.getElementById('manager-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const zh = currentLanguage === 'zh';
  const T = {
    indexed: zh ? '已索引' : 'Indexed',
    unindexed: zh ? '未索引' : 'Unindexed',
    pendingTip: zh ? '尚未索引的檔案：' : 'Files not yet indexed: ',
    sync: zh ? '增量同步' : 'Incremental Sync',
    syncPending: (n) => zh ? `同步（${n} 待索引）` : `Sync (${n} pending)`,
    rebuild: zh ? '完整重建' : 'Full Rebuild',
    uninit: zh ? '移除索引' : 'Uninit',
    create: zh ? '建立索引' : 'Create Index',
    exclude: zh ? '排除' : 'Exclude',
    pendingTag: (n) => zh ? `${n} 待索引` : `${n} pending`,
  };

  (projects || []).forEach((p, vIdx) => {
    const tr = document.createElement('tr');
    const isIndexed = p.is_indexed || p.has_db;
    const metricsText = isIndexed ? `${p.nodes || 0} / ${p.links || 0}` : '--';
    const escapedPath = p.path.replace(/\\/g, '\\\\');
    const pendingCount = p.pending_count || 0;
    const vPending = p.pending_files || [];

    let actionsHtml = '';
    if (isIndexed) {
      const strSyncLabel = pendingCount > 0 ? T.syncPending(pendingCount) : T.sync;
      actionsHtml = `
        <div class="action-btn-group">
          <button class="act-btn" onclick="syncRepo('${escapedPath}', this)">${strSyncLabel}</button>
          <button class="act-btn" onclick="rebuildRepo('${escapedPath}', this)">${T.rebuild}</button>
          <button class="act-btn danger" onclick="uninitRepo('${escapedPath}', this)">${T.uninit}</button>
        </div>
      `;
    } else {
      actionsHtml = `
        <div class="action-btn-group">
          <button class="act-btn green" onclick="initRepo('${escapedPath}', this)">${T.create}</button>
          <button class="act-btn danger" onclick="excludeRepo('${escapedPath}')">${T.exclude}</button>
        </div>
      `;
    }

    // Honest status: grey "pending" badge only exists for indexed repos.
    // Click it to expand the full pending-file list (lightweight SyncReview).
    let statusHtml = `<span class="status-tag ${isIndexed ? 'ready' : 'unindexed'}">
          ${isIndexed ? T.indexed : T.unindexed}
        </span>`;
    if (isIndexed && pendingCount > 0) {
      const strTip = T.pendingTip + vPending.slice(0, 8).join(', ') +
        (pendingCount > vPending.length || pendingCount > 8 ? ' …' : '');
      statusHtml += ` <span class="status-tag pending" title="${escapeHtml(strTip)}"
          style="background:#3a2e12; color:#d29922; border:1px solid #9e6a03; cursor:pointer;"
          onclick="togglePendingRow(${vIdx}, this)">
          ${T.pendingTag(pendingCount)}
        </span>`;
    }

    tr.innerHTML = `
      <td style="font-weight:600; color:#58a6ff;">${escapeHtml(p.name)}</td>
      <td style="font-family:monospace; font-size:11px; color:#8b949e;" title="${escapeHtml(p.path)}">${escapeHtml(p.path)}</td>
      <td style="font-family:monospace; font-size:11px; color:#c9d1d9;">${metricsText}</td>
      <td>${statusHtml}</td>
      <td>${actionsHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Busy-state helper for index action buttons (galaxy-style: disable while running).
function setBusy(btn, busy, busyLabel) {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.orig) btn.dataset.orig = btn.innerHTML;
    btn.disabled = true;
    if (busyLabel) btn.innerHTML = busyLabel;
    return;
  }
  btn.disabled = false;
  if (btn.dataset.orig) { btn.innerHTML = btn.dataset.orig; delete btn.dataset.orig; }
}

function syncRepo(path, btn) {
  setBusy(btn, true, '⏳ Syncing…');
  showToast('⏳ Performing incremental AST sync...');
  fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      showToast(`✅ Synced: ${res.files} files, ${res.nodes} nodes, ${res.edges} links!`);
      loadProjects();
    } else {
      setBusy(btn, false);
      alert('Sync failed: ' + res.error);
    }
  })
  .catch(err => { setBusy(btn, false); alert('Sync error: ' + err); });
}

function rebuildRepo(path, btn) {
  if (!confirm('Are you sure you want to perform a full AST rebuild?')) return;
  setBusy(btn, true, '⏳ Rebuilding…');
  showToast('⏳ Full rebuild in progress...');
  fetch('/api/reindex', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      showToast(`✅ Rebuilt: ${res.files} files, ${res.nodes} nodes, ${res.edges} links!`);
      loadProjects();
    } else {
      setBusy(btn, false);
      alert('Rebuild failed: ' + res.error);
    }
  })
  .catch(err => { setBusy(btn, false); alert('Rebuild error: ' + err); });
}

function uninitRepo(path, btn) {
  if (!confirm('Uninitialize repository? This removes the local .docgraphical database.')) return;
  setBusy(btn, true, '⏳ Removing…');
  showToast('⏳ Removing index database...');
  fetch('/api/uninit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      showToast('🗑️ Repository uninitialized.');
      loadProjects();
    } else {
      setBusy(btn, false);
      alert('Uninit failed: ' + res.error);
    }
  })
  .catch(err => { setBusy(btn, false); alert('Uninit error: ' + err); });
}

function initRepo(path, btn) {
  setBusy(btn, true, '⏳ Indexing…');
  showToast('⏳ Creating AST index for repository...');
  fetch('/api/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      showToast(`✅ Index created: ${res.files} files, ${res.nodes} nodes, ${res.edges} links!`);
      loadProjects();
    } else {
      setBusy(btn, false);
      alert('Index failed: ' + res.error);
    }
  })
  .catch(err => { setBusy(btn, false); alert('Index error: ' + err); });
}

// Expandable pending-file list under a repo row (lightweight SyncReview).
function togglePendingRow(idx, el) {
  const p = (allProjectsList || [])[idx];
  if (!p || !el) return;
  const tr = el.closest('tr');
  if (!tr) return;
  const next = tr.nextElementSibling;
  if (next && next.classList.contains('pending-detail-row')) { next.remove(); return; }
  const zh = currentLanguage === 'zh';
  const files = p.pending_files || [];
  const total = p.pending_count || 0;
  const items = files.map(f => `<div style="font-family:monospace; font-size:11px; color:#c9d1d9; padding:1px 0;">📄 ${escapeHtml(f)}</div>`).join('');
  const dtr = document.createElement('tr');
  dtr.className = 'pending-detail-row';
  dtr.innerHTML = `<td colspan="5" style="background:#161b22; border-top:1px dashed #30363d; padding:8px 12px;">
    <div style="font-size:12px; font-weight:600; color:#d29922; margin-bottom:4px;">${escapeHtml(p.name)} — ${zh ? `待索引檔案（${total}）` : `pending files (${total})`}${total > files.length ? (zh ? `，僅列前 ${files.length} 個` : `, showing first ${files.length}`) : ''}</div>
    <div style="max-height:180px; overflow-y:auto;">${items || (zh ? '（無）' : '(none)')}</div>
  </td>`;
  tr.after(dtr);
}

// Global one-click incremental sync across every indexed repo.
function syncAllRepos(btn) {
  const indexed = (allProjectsList || []).filter(q => q.status === 'ready' || q.is_indexed || q.has_db);
  if (!indexed.length) {
    showToast(currentLanguage === 'zh' ? '沒有已索引的 repo 可同步' : 'No indexed repositories to sync');
    return;
  }
  setBusy(btn, true, currentLanguage === 'zh' ? '⏳ 全域同步中…' : '⏳ Syncing all…');
  showToast(currentLanguage === 'zh' ? `⏳ 正在同步 ${indexed.length} 個已索引 repo…` : `⏳ Syncing ${indexed.length} indexed repos…`);
  fetch('/api/sync_all', { method: 'POST' })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      const t = res.totals || {};
      showToast(currentLanguage === 'zh'
        ? `⚡ 全域同步完成：${res.synced} 個 repo，解析 ${t.parsed || 0}，跳過 ${t.skipped || 0}，移除 ${t.removed || 0}`
        : `⚡ Synced ${res.synced} repos: ${t.parsed || 0} parsed, ${t.skipped || 0} skipped, ${t.removed || 0} removed`);
      loadProjects();
    } else {
      setBusy(btn, false);
      alert('Sync all failed: ' + (res.error || 'unknown'));
    }
  })
  .catch(err => { setBusy(btn, false); alert('Sync all error: ' + err); });
}

// ─── Document ingest dialog (dir-node "New document": ppt/word/pdf -> LLM -> md) ───
// Rule: sources are copied INTO the target dir, the md lands NEXT TO them,
// and the md header always records each source's repo-relative path.
let ingState = null;
function closeIngestDialog() {
  const o = document.getElementById('ing-overlay');
  if (o) o.remove();
  ingState = null;
}
function ingMsg(t, bad) {
  const m = document.getElementById('ing-msg');
  if (m) { m.textContent = t || ''; m.style.color = bad ? '#f85149' : '#8b949e'; }
}
function openIngestDialog(absDir) {
  const zh = currentLanguage === 'zh';
  closeIngestDialog();
  const t = (absDir || '').replace(/\\/g, '/');
  let repoPath = '', projName = '';
  (allProjectsList || []).forEach(p => {
    if (!p.path) return;
    const r = p.path.replace(/\\/g, '/');
    if (t === r || t.startsWith(r + '/')) {
      if (!repoPath || r.length > repoPath.replace(/\\/g, '/').length) { repoPath = p.path; projName = p.name; }
    }
  });
  if (!repoPath) { showToast(zh ? '❌ 找不到所屬 repo' : '❌ Owning repo not found'); return; }
  ingState = { dir: absDir, repo: repoPath, proj: projName, picked: [], files: [], summary: '', model: '', zh };
  const o = document.createElement('div');
  o.id = 'ing-overlay';
  o.style.cssText = 'position:fixed;inset:0;z-index:1000002;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
  o.innerHTML = `
  <div style="width:90vw;max-width:1700px;height:88vh;overflow:hidden;display:flex;flex-direction:column;background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:16px;color:#e6edf3;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <span style="font-weight:600;font-size:19px;">${zh ? '📥 新增文件 — LLM 摘要入庫' : '📥 New document — LLM summary ingest'} <span style="font-size:14px;color:#8b949e;font-weight:400;">v3.9.14</span></span>
      <button onclick="closeIngestDialog()" style="background:transparent;border:none;color:#8b949e;cursor:pointer;font-size:16px;">✕</button>
    </div>
    <div style="font-size:15px;color:#8b949e;margin-bottom:10px;word-break:break-all;">${zh ? '目標目錄：' : 'Target: '}${escapeHtml(absDir)}${projName ? ` &nbsp;·&nbsp; ${escapeHtml(projName)}` : ''}</div>
    <div style="display:flex;gap:12px;flex:1;min-height:0;">
      <div style="flex:0 1 330px;min-width:250px;display:flex;flex-direction:column;gap:8px;">
        <div style="font-size:16px;font-weight:600;color:#c9d1d9;">${zh ? '① 選擇檔案（ppt／word／pdf，可拖拉）' : '① Pick files (ppt/word/pdf, drag & drop)'}</div>
        <div id="ing-drop" style="border:1.5px dashed #30363d;border-radius:8px;padding:20px 12px;text-align:center;color:#8b949e;font-size:16px;cursor:pointer;transition:border-color .15s,background .15s;">
          ${zh ? '🖱️ 把檔案拖到這裡放開，或點此選擇檔案' : '🖱️ Drag files here, or click to browse'}
          <input type="file" id="ing-file-input" multiple accept=".pptx,.ppt,.docx,.doc,.pdf" style="display:none;" />
        </div>
        <div id="ing-file-list" style="display:flex;flex-direction:column;gap:4px;flex:1;min-height:100px;overflow-y:auto;"></div>
      </div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;">
        <div style="font-size:16px;font-weight:600;color:#c9d1d9;">${zh ? '② LLM 摘要預覽' : '② LLM summary preview'}</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input id="ing-name-input" placeholder="${zh ? '摘要檔名（免副檔名）' : 'Summary filename (no ext)'}" style="flex:1;min-width:0;background:#010409;border:1px solid #30363d;border-radius:6px;padding:6px 10px;color:#e6edf3;font-size:16px;" />
          <button id="ing-btn-sum" onclick="ingSummarize(this)" style="background:transparent;border:1px solid #1f6feb;color:#58a6ff;border-radius:6px;padding:6px 12px;cursor:pointer;white-space:nowrap;font-size:16px;">${zh ? '✨ 生成摘要' : '✨ Summarize'}</button>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="ing-tab-prev" onclick="ingShowTab('prev')" style="background:#1f6feb44;border:1px solid #1f6feb;color:#58a6ff;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:16px;">👁 ${zh ? '預覽' : 'Preview'}</button>
          <button id="ing-tab-edit" onclick="ingShowTab('edit')" style="background:transparent;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:16px;">✏️ ${zh ? '編輯' : 'Edit'}</button>
          <span style="font-size:15px;color:#8b949e;">${zh ? '存檔前可先修改摘要' : 'review & edit before saving'}</span>
        </div>
        <div id="ing-preview" style="background:#010409;border:1px solid #21262d;border-radius:6px;padding:12px;font-size:13px;flex:1;min-height:220px;overflow-y:auto;color:#c9d1d9;word-break:break-word;">${zh ? '（摘要會顯示在這裡）' : '(summary appears here)'}</div>
        <textarea id="ing-edit" style="display:none;background:#010409;border:1px solid #1f6feb;border-radius:6px;padding:12px;font-size:13px;color:#e6edf3;flex:1;min-height:220px;overflow-y:auto;font-family:inherit;white-space:pre-wrap;"></textarea>
        <button id="ing-btn-save" onclick="ingSave(this)" style="background:#238636;border:1px solid #2ea043;color:#fff;border-radius:6px;padding:8px 12px;cursor:pointer;font-weight:600;font-size:16px;">${zh ? '✅ 確認產出 md 並入庫' : '✅ Confirm: write md & index'}</button>
      </div>
    </div>
    <div id="ing-msg" style="font-size:16px;color:#8b949e;margin-top:8px;min-height:16px;"></div>
  </div>`;
  document.body.appendChild(o);
  o.addEventListener('click', (ev) => { if (ev.target === o) closeIngestDialog(); });
  // Picker + drag&drop share one list (drops accumulate; dupes by name+size dropped).
  const dz = document.getElementById('ing-drop');
  const fi = document.getElementById('ing-file-input');
  if (dz && fi) {
    dz.addEventListener('click', () => fi.click());
    fi.addEventListener('change', (ev) => {
      ingAddPicked(Array.from(ev.target.files || []));
      fi.value = '';  // allow re-picking the same file
    });
    ['dragenter', 'dragover'].forEach(evName => dz.addEventListener(evName, (ev) => {
      ev.preventDefault();
      dz.style.borderColor = '#1f6feb';
      dz.style.background = '#1f6feb22';
    }));
    ['dragleave', 'drop'].forEach(evName => dz.addEventListener(evName, (ev) => {
      ev.preventDefault();
      dz.style.borderColor = '#30363d';
      dz.style.background = '';
    }));
    dz.addEventListener('drop', (ev) => {
      const files = (ev.dataTransfer && ev.dataTransfer.files) ? Array.from(ev.dataTransfer.files) : [];
      if (!files.length) return;
      const ok = files.filter(f => /\.(pptx?|docx?|pdf)$/i.test(f.name || ''));
      if (ok.length < files.length) {
        ingMsg((ingState.zh ? '⚠ 已略過不支援的格式（僅 ppt／word／pdf）：' : '⚠ Skipped unsupported (ppt/word/pdf only): ')
          + files.filter(f => !/\.(pptx?|docx?|pdf)$/i.test(f.name || '')).map(f => f.name).join('、'), true);
      }
      ingAddPicked(ok);
    });
  }
}
// Append files to the ingest pick list (shared by picker + drag&drop).
function ingAddPicked(files) {
  if (!ingState || !files || !files.length) return;
  const seen = new Set(ingState.picked.map(f => `${f.name}::${f.size}`));
  files.forEach(f => {
    const k = `${f.name}::${f.size}`;
    if (!seen.has(k)) { seen.add(k); ingState.picked.push(f); }
  });
  ingRenderPicked();
}
function ingRenderPicked() {
  const box = document.getElementById('ing-file-list');
  if (!box || !ingState) return;
  box.innerHTML = '';
  // Filename follows the pick immediately (first file stem + 摘要), so the
  // user never has to type it — manual edits are never clobbered.
  const ni = document.getElementById('ing-name-input');
  if (!ingState.picked.length) {
    box.innerHTML = `<div style="font-size:13px;color:#8b949e;">${ingState.zh ? '（尚未選擇檔案）' : '(no files yet)'}</div>`;
    if (ni && ni.value === (ingState._autoName || '')) { ni.value = ''; ingState._autoName = ''; }
    return;
  }
  // Auto-name from the first picked file (only while the user hasn't typed).
  const ni2 = document.getElementById('ing-name-input');
  if (ni2 && !ni2.value) {
    ni2.value = ingState.picked[0].name.replace(/\.[^.]+$/, '') + '摘要';
    ingState._autoName = ni2.value;
  }
  ingState.picked.forEach((f, idx) => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:16px;color:#c9d1d9;border:1px solid #21262d;border-radius:6px;padding:4px 8px;';
    const tx = document.createElement('span');
    tx.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    tx.textContent = `📎 ${f.name} (${Math.round(f.size / 1024)} KB)`;
    tx.title = f.name;
    d.appendChild(tx);
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = ingState.zh ? '移除' : 'Remove';
    x.style.cssText = 'background:transparent;border:none;color:#8b949e;cursor:pointer;font-size:16px;padding:0 2px;';
    x.onclick = () => { ingState.picked.splice(idx, 1); ingRenderPicked(); };
    d.appendChild(x);
    box.appendChild(d);
  });
}
// Animated busy line for long ingest ops: spinning ◌ + elapsed seconds +
// dialog-wide button lock (no double-submit). Returns stop(); idempotent.
function ingProgress(label) {
  const st = ingState;
  const m = document.getElementById('ing-msg');
  const t0 = Date.now();
  const lock = (on) => {
    ['ing-btn-sum', 'ing-btn-save'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.disabled = on;
    });
  };
  lock(true);
  const tick = () => {
    if (!m) return;
    const s = Math.floor((Date.now() - t0) / 1000);
    m.style.color = '#58a6ff';
    m.innerHTML = `<span class="ing-spin">◌</span> ${escapeHtml(label)}… ${s}s`;
  };
  tick();
  const timer = setInterval(tick, 500);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    lock(false);
    if (st && st._stop) st._stop = null;
  };
}
function ingUpload(btn, done) {
  const st = ingState;
  if (!st) return;
  const zh = st.zh;
  if (!st.picked.length) { ingMsg(zh ? '請先選擇檔案' : 'Pick files first', true); return; }
  setBusy(btn, true, '⏳…');
  if (st._stop) st._stop();
  st._stop = ingProgress(zh ? '上傳暫存中' : 'Staging upload');
  const fd = new FormData();
  fd.append('target_dir', st.dir);
  fd.append('stage', '1');  // files wait in staging; Confirm moves them in
  st.picked.forEach(f => fd.append('files', f, f.name));
  fetch('/api/ingest/upload', { method: 'POST', body: fd })
  .then(r => r.json().then(d => ({ status: r.status, body: d })))
  .then(({ status, body }) => {
    if (st._stop) st._stop();
    setBusy(btn, false);
    if (status === 200 && body.success) {
      st.files = body.files || [];
      // File set changed after a previous summary? Old preview is stale — reset it.
      const newKey = st.files.map(f => f.path).join('\n');
      if (st.sumPaths && st.sumPaths !== newKey) {
        st.summary = ''; st.model = ''; st.sumPaths = '';
        const edR = document.getElementById('ing-edit');
        if (edR) edR.value = '';
        ingShowTab('prev');
      }
      const box = document.getElementById('ing-file-list');
      box.innerHTML = '';
      st.files.forEach(f => {
        const d = document.createElement('div');
        d.style.cssText = 'font-size:16px;color:#3fb950;border:1px solid #21262d;border-radius:6px;padding:4px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        d.textContent = `✅ ${f.name}`;
        d.title = f.path || f.name;
        box.appendChild(d);
      });
      const nameInput = document.getElementById('ing-name-input');
      if (nameInput && !nameInput.value && st.files.length) {
        const stem = st.files[0].name.replace(/\.[^.]+$/, '');
        nameInput.value = stem + '摘要';
      }
      ingMsg(zh ? `已暫存 ${st.files.length} 個檔案（確認後與 md 一起寫入目標目錄）` : `Staged ${st.files.length} file(s) — written on confirm`);
      if (typeof done === 'function') { const cb = done; done = null; cb(); }
    } else {
      if (st._stop) st._stop();
      ingMsg('❌ ' + ((body && body.error) || status), true);
    }
  })
  .catch(err => { if (st._stop) st._stop(); setBusy(btn, false); ingMsg('❌ ' + err, true); });
}
// Summary Preview / Edit tabs. Single source of truth ping-pongs between
// st.summary and the editor; save() always reads the editor.
function ingShowTab(which) {
  const st = ingState;
  if (!st) return;
  const pv = document.getElementById('ing-preview');
  const ed = document.getElementById('ing-edit');
  const tp = document.getElementById('ing-tab-prev');
  const te = document.getElementById('ing-tab-edit');
  if (!pv || !ed || !tp || !te) return;
  const on = 'background:#1f6feb44;border:1px solid #1f6feb;color:#58a6ff;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:16px;';
  const off = 'background:transparent;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:16px;';
  if (which === 'edit') {
    if (!ed.value) ed.value = st.summary || '';
    pv.style.display = 'none';
    ed.style.display = 'block';
    tp.style.cssText = off;
    te.style.cssText = on;
    ed.focus();
  } else {
    if (ed.style.display === 'block') st.summary = ed.value;  // keep human edits
    ed.style.display = 'none';
    pv.style.display = 'block';
    tp.style.cssText = on;
    te.style.cssText = off;
    const txt = (st.summary || '').trim();
    if (!txt) {
      pv.textContent = st.zh ? '（摘要會顯示在這裡）' : '(summary appears here)';
      return;
    }
    try {
      if (window.marked && typeof window.marked.parse === 'function') pv.innerHTML = window.marked.parse(txt);
      else if (typeof window.marked === 'function') pv.innerHTML = window.marked(txt);
      else pv.textContent = txt;
    } catch (e) { pv.textContent = txt; }
  }
}
function ingSummarize(btn) {
  const st = ingState;
  if (!st) return;
  const zh = st.zh;
  // One-click flow: picked but not uploaded yet -> upload first, then summarize.
  if (!st.files.length) {
    if (!st.picked.length) { ingMsg(zh ? '請先選擇檔案' : 'Pick files first', true); return; }
    ingUpload(null, () => ingSummarize(document.getElementById('ing-btn-sum')));
    return;
  }
  setBusy(btn, true, '⏳…');
  if (st._stop) st._stop();
  st._stop = ingProgress(zh ? `摘要生成中（${st.files.length} 個檔案，大檔請耐心等候）` : `Summarizing ${st.files.length} file(s)`);
  const pv0 = document.getElementById('ing-preview');
  if (pv0) pv0.innerHTML = `<span class="ing-spin">◌</span> ${zh ? 'LLM 生成中…' : 'Generating…'}`;
  fetch('/api/ingest/summarize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: st.files.map(f => f.path) })
  })
  .then(r => r.json().then(d => ({ status: r.status, body: d })))
  .then(({ status, body }) => {
    if (st._stop) st._stop();
    setBusy(btn, false);
    if (status === 200 && body.success) {
      st.summary = body.summary || '';
      st.model = body.model || '';
      st.sumPaths = st.files.map(f => f.path).join('\n');
      const ed0 = document.getElementById('ing-edit');
      if (ed0) ed0.value = st.summary;
      ingShowTab('prev');  // rendered markdown preview; switch to Edit to revise
      const notes = (body.notes || []).join('；');
      ingMsg((zh ? `✅ 摘要完成（${st.model}）` : `✅ Done (${st.model})`) + (notes ? ` — ${notes}` : ''));
    } else {
      if (st._stop) st._stop();
      // Don't leave a stale "Generating…" in the preview on failure.
      if (pv0) pv0.textContent = zh ? '（摘要會顯示在這裡）' : '(summary appears here)';
      ingMsg('❌ ' + ((body && body.error) || status), true);
    }
  })
  .catch(err => { if (st._stop) st._stop(); setBusy(btn, false); ingMsg('❌ ' + err, true); });
}
function ingSave(btn) {
  const st = ingState;
  if (!st) return;
  const zh = st.zh;
  const nameInput = document.getElementById('ing-name-input');
  const filename = (nameInput && nameInput.value.trim()) || '';
  // The human-reviewed text lives in the editor — that is what gets saved.
  const edEl = document.getElementById('ing-edit');
  const finalSummary = ((edEl && edEl.value) || st.summary || '').trim();
  if (!finalSummary) { ingMsg(zh ? '請先生成摘要' : 'Generate the summary first', true); return; }
  if (!filename) { ingMsg(zh ? '請填摘要檔名' : 'Enter a filename', true); return; }
  st.summary = finalSummary;
  setBusy(btn, true, '⏳…');
  if (st._stop) st._stop();
  st._stop = ingProgress(zh ? '寫檔＋增量索引中' : 'Writing + indexing');
  fetch('/api/ingest/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_dir: st.dir, filename, summary_md: finalSummary,
                           source_paths: st.files.map(f => f.path), model: st.model })
  })
  .then(r => r.json().then(d => ({ status: r.status, body: d })))
  .then(({ status, body }) => {
    if (st._stop) st._stop();
    setBusy(btn, false);
    if (status === 200 && body.success) {
      const rels = (body.source_rels || []).join('、');
      showToast(zh ? `✅ 已產出：${body.md_path}` : `✅ Written: ${body.md_path}`);
      ingMsg((zh ? `✅ md 與來源同目錄，內文已記錄相對路徑：${rels}` : `✅ md saved next to sources; rel paths recorded: ${rels}`));
      loadProjects();
      setTimeout(closeIngestDialog, 1200);
    } else {
      if (st._stop) st._stop();
      ingMsg('❌ ' + ((body && body.error) || status), true);
    }
  })
  .catch(err => { if (st._stop) st._stop(); setBusy(btn, false); ingMsg('❌ ' + err, true); });
}

function excludeRepo(path) {
  fetch('/api/paths/exclude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      showToast('🚫 Repository excluded from view.');
      loadProjects();
    } else {
      alert('Exclude failed: ' + res.error);
    }
  })
  .catch(err => alert('Exclude error: ' + err));
}


function checkElectronNative() {
  if (window.electronAPI && typeof window.electronAPI.openDirectoryDialog === 'function') {
    const btn = document.getElementById('btn-browse-path');
    if (btn) btn.style.display = 'inline-block';
  }
}

async function browseDirectoryNative() {
  if (window.electronAPI && typeof window.electronAPI.openDirectoryDialog === 'function') {
    const selected = await window.electronAPI.openDirectoryDialog();
    if (selected) {
      const inp = document.getElementById('custom-path-input');
      if (inp) inp.value = selected;
    }
  }
}

// ─── Explorer tree custom context menu (project / dir / file / heading) ───
let treeCtxEl = null;
function closeTreeCtxMenu() {
  if (treeCtxEl) { treeCtxEl.remove(); treeCtxEl = null; }
  document.removeEventListener('click', closeTreeCtxMenu);
}
function copyTextToClipboard(t, okMsg) {
  const done = () => showToast(okMsg);
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done();
    } catch (e) { showToast('❌ Copy failed ／ 複製失敗'); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(done).catch(fallback);
  } else fallback();
}
// Resolve an absolute disk path for any tree node.
function resolveTreeAbsPath(projName, treePath) {
  const proj = (allProjectsList || []).find(p => p.name === projName);
  let rel = (treePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!proj || !proj.path) return rel;
  const root = proj.path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (/^[a-zA-Z]:\//.test(rel)) return rel.replace(/\//g, '\\');
  if (rel.toLowerCase() === root.toLowerCase() ||
      rel.toLowerCase().startsWith(root.toLowerCase() + '/')) {
    return rel.replace(/\//g, '\\');
  }
  if (rel === projName) rel = '';
  else if (rel.startsWith(projName + '/')) rel = rel.substring(projName.length + 1);
  return (root + (rel ? '/' + rel : '')).replace(/\//g, '\\');
}
function findGraphNodeById(id) {
  if (!id) return null;
  const pools = [(masterGraphData && masterGraphData.nodes) || []];
  try { if (typeof rawData !== 'undefined' && rawData && rawData.nodes) pools.push(rawData.nodes); } catch (e) { /* ignore */ }
  for (const pool of pools) {
    const hit = (pool || []).find(n => n && n.id === id);
    if (hit) return hit;
  }
  return null;
}
function focusOnlyProject(projName) {
  const zh = currentLanguage === 'zh';
  selectedProjects.clear();
  selectedProjects.add(projName);
  persistSelectedProjects();
  loadProjects({ preserve: true });
  showToast(zh ? `🎯 只看：${projName}` : `🎯 Focus only: ${projName}`);
}
function focusGraphNodeById(id) {
  const zh = currentLanguage === 'zh';
  const n = findGraphNodeById(id);
  if (!n) { showToast(zh ? '❌ 圖上找不到該節點' : '❌ Node not found in graph'); return; }
  highlightScope('node', n);
  focusOnNode(n);
  selectActiveNode(n);
  showToast(`🎯 ${n.name || id}`);
}
function initTreeCtxMenu() {
  const c = document.getElementById('tree-container');
  if (!c || c.dataset.ctxBound) return;
  c.dataset.ctxBound = '1';
  c.addEventListener('contextmenu', openTreeCtxMenu);
}
function openTreeCtxMenu(e) {
  const el = e.target && e.target.closest ? e.target.closest('#tree-container .tree-node') : null;
  if (!el) return;
  e.preventDefault();
  const zh = currentLanguage === 'zh';
  let kind = null, proj = null, treePath = '', nodeId = null, headName = '';
  if (el.hasAttribute('data-tree-src')) {
    kind = 'source';
    proj = el.getAttribute('data-tree-proj');
    treePath = el.getAttribute('data-tree-file-path') || '';
  } else if (el.hasAttribute('data-tree-file')) {
    kind = 'file';
    proj = el.getAttribute('data-tree-proj');
    treePath = el.getAttribute('data-tree-file-path') || '';
    nodeId = el.getAttribute('data-tree-node-id');
  } else if (el.hasAttribute('data-tree-dir')) {
    kind = 'dir';
    const key = el.getAttribute('data-tree-dir') || '';
    const ci = key.indexOf(':');
    proj = ci >= 0 ? key.substring(0, ci) : key;
    treePath = ci >= 0 ? key.substring(ci + 1) : '';
  } else if (el.hasAttribute('data-tree-node-id')) {
    kind = 'heading';
    nodeId = el.getAttribute('data-tree-node-id');
  } else if (el.hasAttribute('data-tree-proj')) {
    kind = 'project';
    proj = el.getAttribute('data-tree-proj');
  } else return;

  const projEntry = (allProjectsList || []).find(p => p.name === proj);
  const bIndexed = !!(projEntry && (projEntry.status === 'ready' || projEntry.is_indexed || projEntry.has_db));
  let absPath = '';
  if (kind === 'project') {
    absPath = (projEntry && projEntry.path) || '';
  } else if (kind === 'heading') {
    const n = findGraphNodeById(nodeId);
    if (!n) { showToast(zh ? '❌ 圖上找不到該節點' : '❌ Node not found in graph'); return; }
    proj = n.project || getNodeProject(n);
    headName = n.name || '';
    absPath = (n.abs_path || '').replace(/\//g, '\\') || resolveTreeAbsPath(proj, n.file || '');
    nodeId = n.id;
  } else {
    absPath = resolveTreeAbsPath(proj, treePath);
  }

  const items = [];
  const addCopyAbs = (label) => {
    items.push({ label, fn: () => {
      if (!absPath) { showToast(zh ? '❌ 無路徑可複製' : '❌ No path to copy'); return; }
      const short = absPath.length > 70 ? '…' + absPath.slice(-69) : absPath;
      copyTextToClipboard(absPath, `${zh ? '📋 已複製：' : '📋 Copied: '}${short}`);
    }});
  };
  if (kind === 'project') {
    if (bIndexed) {
      items.push({ label: zh ? '🎯 只看此專案' : '🎯 Focus only this project', fn: () => focusOnlyProject(proj) });
      items.push({ label: zh ? '⚡ 增量同步此 repo' : '⚡ Incremental sync this repo', fn: () => syncRepo(absPath) });
    } else {
      items.push({ label: zh ? '＋ 建立索引' : '＋ Create Index', fn: () => initRepo(absPath) });
    }
    // Project root is the only ingest entry when the repo has no subdirs yet
    // (e.g. a freshly added empty directory) — same dialog as dir nodes.
    items.push({ label: zh ? '＋ 新增文件…' : '＋ New document…', fn: () => {
      if (typeof openIngestDialog === 'function') openIngestDialog(absPath);
      else showToast(zh ? '⏳ 文件匯入即將推出' : '⏳ Document ingest coming soon');
    }});
    items.push({ label: zh ? '📁 新增資料夾…' : '📁 New folder…', fn: () => treeNewFolder(absPath) });
    addCopyAbs(zh ? '📋 複製絕對路徑' : '📋 Copy absolute path');
  } else if (kind === 'dir') {
    items.push({ label: zh ? '＋ 新增文件…' : '＋ New document…', fn: () => {
      if (typeof openIngestDialog === 'function') openIngestDialog(absPath);
      else showToast(zh ? '⏳ 文件匯入即將推出' : '⏳ Document ingest coming soon');
    }});
    items.push({ label: zh ? '📁 新增資料夾…' : '📁 New folder…', fn: () => treeNewFolder(absPath) });
    addCopyAbs(zh ? '📋 複製絕對路徑' : '📋 Copy absolute path');
  } else if (kind === 'file') {
    items.push({ label: zh ? '🎯 在圖上定位' : '🎯 Locate in graph', fn: () => focusGraphNodeById(nodeId) });
    addCopyAbs(zh ? '📋 複製絕對路徑' : '📋 Copy absolute path');
  } else if (kind === 'source') {
    // Source child row under its md (never indexed): open + copy only.
    const srcUrl = (projEntry && projEntry.path)
      ? `/api/ingest/source?repo=${encodeURIComponent(projEntry.path)}&file=${encodeURIComponent(treePath)}` : '';
    if (srcUrl) items.push({ label: zh ? '📂 開啟來源檔案' : '📂 Open source file', fn: () => window.open(srcUrl, '_blank', 'noopener') });
    addCopyAbs(zh ? '📋 複製絕對路徑' : '📋 Copy absolute path');
  } else {
    items.push({ label: zh ? '🎯 定位此節' : '🎯 Locate this section', fn: () => focusGraphNodeById(nodeId) });
    addCopyAbs(zh ? '📋 複製檔案絕對路徑' : '📋 Copy file absolute path');
    if (headName) items.push({ label: zh ? '📝 複製標題文字' : '📝 Copy heading text', fn: () => copyTextToClipboard(headName, zh ? '📝 已複製標題' : '📝 Heading copied') });
  }
  if (!items.length) return;

  closeTreeCtxMenu();
  treeCtxEl = document.createElement('div');
  treeCtxEl.style.cssText = 'position:fixed;z-index:1000004;min-width:200px;max-width:320px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.55);font-size:12px;color:#e6edf3;zoom:1.16;';
  items.forEach(it => {
    const row = document.createElement('div');
    row.textContent = it.label;
    row.style.cssText = 'padding:7px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    row.onmouseenter = () => { row.style.background = '#1f6feb44'; };
    row.onmouseleave = () => { row.style.background = ''; };
    row.onclick = (ev) => { ev.stopPropagation(); closeTreeCtxMenu(); it.fn(); };
    treeCtxEl.appendChild(row);
  });
  document.body.appendChild(treeCtxEl);
  const mw = treeCtxEl.offsetWidth, mh = treeCtxEl.offsetHeight;
  let x = e.clientX, y = e.clientY;
  if (x + mw > window.innerWidth - 8) x = Math.max(8, window.innerWidth - mw - 8);
  if (y + mh > window.innerHeight - 8) y = Math.max(8, window.innerHeight - mh - 8);
  treeCtxEl.style.left = x + 'px';
  treeCtxEl.style.top = y + 'px';
  setTimeout(() => document.addEventListener('click', closeTreeCtxMenu), 0);
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

function updateHealthIndicator() {
  const el = document.getElementById('lbl-health');
  if (!el) return;
  const zh = currentLanguage === 'zh';
  fetch('/api/health')
    .then(r => { if (!r.ok) throw new Error('bad status'); return r.json(); })
    .then(d => {
      if (d && d.status === 'ok') {
        el.textContent = zh ? '● 服務正常' : '● Server OK';
        el.style.color = '#3fb950';
      } else {
        throw new Error('bad payload');
      }
    })
    .catch(() => {
      el.textContent = zh ? '● 離線' : '● Offline';
      el.style.color = '#f85149';
    });
}

// Explorer / repo-manager i18n (called on every language switch)
function updateExplorerI18n() {
  const zh = currentLanguage === 'zh';
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setAttr = (id, attr, txt) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, txt); };

  set('btn-repo-mgr', zh ? '⚙ 倉庫' : '⚙ Repos');
  set('btn-sel-all', zh ? '全選' : 'Select All');
  set('btn-sel-none', zh ? '取消選取' : 'Deselect');
  set('btn-clear-filter', '✕');
  setAttr('btn-clear-filter', 'title', zh ? '清除篩選' : 'Clear filter');

  const treeSearch = document.getElementById('tree-search');
  if (treeSearch) treeSearch.placeholder = zh ? '篩選文件樹…' : 'Filter documentation tree...';

  const summary = document.getElementById('lbl-proj-summary');
  if (summary) summary.innerText = `${selectedProjects.size} ${zh ? '個啟用' : 'Active'}`;

  set('th-proj', zh ? '專案' : 'Project');
  set('th-path', zh ? '目錄路徑' : 'Directory Path');
  set('th-metrics', zh ? '指標' : 'Metrics');
  set('th-status', zh ? '狀態' : 'Status');
  set('th-actions', zh ? '操作' : 'Actions');

  set('lbl-modal-title', zh ? '倉庫管理' : 'Repository Management');
  set('lbl-add-dir', zh ? '掃描專案目錄：' : 'Scan Project Directory:');
  set('lbl-repo-list', zh ? '已發現的倉庫：' : 'Discovered Repositories:');
  set('btn-sync-all', zh ? '⚡ 全部同步' : '⚡ Sync all');
  set('btn-sync-all-tree', zh ? '⚡ 全部同步' : '⚡ Sync all');
  paintShowSourceBtn();

  renderRepoTable(allProjectsList);
}

function toggleLanguage() {
  currentLanguage = currentLanguage === 'en' ? 'zh' : 'en';
  const b = document.getElementById('btn-lang');
  if (b) b.textContent = `Language: ${currentLanguage.toUpperCase()}`;
  updateSwapButtonI18n();
  updateControlsHelpI18n();
  updateExplorerI18n();
  // Re-render the LLM settings dialog labels if it is open
  const dlg = document.getElementById('prov-dialog');
  if (dlg && dlg.style.display !== 'none') renderProvDialogLabels();
  showToast(currentLanguage === 'zh' ? '語系切換：繁體中文' : 'Language switched to English');
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}



// ─── 1.1 3D Navigation Controls & Help Modal ──────────────────────
let isControlsHelpOpen = false;
let navKeys = {};
let flightVel = null;
let flightTargetVel = null;
// Screen-space flight basis: reuse last horizontal right when the view axis
// goes vertical (cross would collapse to zero and kill A/D), see navFlightLoop.
let lastFlightRight = new THREE.Vector3(1, 0, 0);
let isMouseIn3DPane = false;

function toggleControlsHelp(forceState) {
  const modal = document.getElementById('controls-help-modal');
  if (!modal) return;
  if (typeof forceState === 'boolean') {
    isControlsHelpOpen = forceState;
  } else {
    isControlsHelpOpen = !isControlsHelpOpen;
  }
  
  if (isControlsHelpOpen) {
    modal.classList.remove('hidden');
    updateControlsHelpI18n();
  } else {
    modal.classList.add('hidden');
  }
}

function init3DNavControls() {
  const pane3D = document.getElementById('viewport-3d-pane');
  const canvasElem = document.getElementById('3d-graph');
  if (!pane3D || !canvasElem) return;

  pane3D.addEventListener('mouseenter', () => { isMouseIn3DPane = true; });
  pane3D.addEventListener('mouseleave', () => { 
    isMouseIn3DPane = false; 
    navKeys = {}; 
  });

  window.addEventListener('keydown', (e) => {
    const targetTag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select' || (e.target && e.target.isContentEditable)) {
      return;
    }

    const code = e.code;
    navKeys[code] = true;

    // Escape closes modal
    if (code === 'Escape') {
      if (isControlsHelpOpen) {
        toggleControlsHelp(false);
        e.preventDefault();
        return;
      }
    }

    // View control hotkeys
    if (code === 'KeyC') {
      e.preventDefault();
      if (activeNode) {
        focusOnNode(activeNode);
      } else {
        autoFrameGraph();
      }
    } else if (code === 'KeyF') {
      e.preventDefault();
      autoFrameGraph();
    } else if (code === 'Digit1') {
      changeLOD('arch');
    } else if (code === 'Digit2') {
      changeLOD('standard');
    } else if (code === 'Digit3') {
      changeLOD('all');
    } else if (code === 'Space') {
      if (isMouseIn3DPane) {
        e.preventDefault();
        if (flightVel) flightVel.set(0, 0, 0);
        if (flightTargetVel) flightTargetVel.set(0, 0, 0);
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    delete navKeys[e.code];
  });

  // Clear keys on window blur so a missed keyup cannot leave flight stuck on
  window.addEventListener('blur', () => {
    navKeys = {};
  });

  // Double click canvas to reset view
  canvasElem.addEventListener('dblclick', (e) => {
    e.preventDefault();
    autoFrameGraph();
  });

  requestAnimationFrame(navFlightLoop);
}

function navFlightLoop() {
  if (Graph && typeof THREE !== 'undefined') {
    const camera = Graph.camera();
    const controls = Graph.controls();

    if (camera && controls) {
      if (!flightVel) flightVel = new THREE.Vector3();
      if (!flightTargetVel) flightTargetVel = new THREE.Vector3();

      flightTargetVel.set(0, 0, 0);

      // WASD fly along the view axis & strafe, E up / Q down (screen-relative)
      const hasMovement = navKeys['KeyW'] || navKeys['KeyS'] || navKeys['KeyA'] || navKeys['KeyD'] ||
                          navKeys['KeyQ'] || navKeys['KeyE'];

      if (hasMovement && (isMouseIn3DPane || document.activeElement === document.body)) {
        const isBoost = navKeys['ShiftLeft'] || navKeys['ShiftRight'];
        const baseSpeed = isBoost ? 2.5 : 1.0;

        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);

        // Screen-space basis (same math as codegraph-galaxy):
        //  right = view dir x world up -> horizontal screen-right; when the view
        //  axis goes vertical the cross collapses, so reuse lastFlightRight.
        //  up    = right x dir -> SCREEN up: equals world +Y when level, tilts
        //  with the camera when pitched, horizontal pan at top-down (no zoom-out).
        const right = new THREE.Vector3().crossVectors(dir, camera.up);
        if (right.lengthSq() < 1e-10) {
            right.copy(lastFlightRight);
        } else {
            right.normalize();
            lastFlightRight.copy(right);
        }
        const up = new THREE.Vector3().crossVectors(right, dir);
        if (up.lengthSq() < 1e-10) {
            up.set(0, 1, 0);
        } else {
            up.normalize();
        }

        // Forward / Backward (W / S)
        if (navKeys['KeyW']) flightTargetVel.addScaledVector(dir, baseSpeed);
        if (navKeys['KeyS']) flightTargetVel.addScaledVector(dir, -baseSpeed);

        // Strafe Left / Right (A / D)
        if (navKeys['KeyA']) flightTargetVel.addScaledVector(right, -baseSpeed);
        if (navKeys['KeyD']) flightTargetVel.addScaledVector(right, baseSpeed);

        // Elevate Up / Down (E up / Q down, screen-relative)
        if (navKeys['KeyE']) flightTargetVel.addScaledVector(up, baseSpeed * 0.9);
        if (navKeys['KeyQ']) flightTargetVel.addScaledVector(up, -baseSpeed * 0.9);
      }

      flightVel.lerp(flightTargetVel, 0.18);

      if (flightVel.lengthSq() > 0.0001) {
        camera.position.add(flightVel);
        controls.target.add(flightVel);
      }

      updateNavTelemetry(camera, controls);
    }
  }

  requestAnimationFrame(navFlightLoop);
}

let lastNavTelemetryTime = 0;
function updateNavTelemetry(camera, controls) {
  const now = performance.now();
  if (now - lastNavTelemetryTime < 60) return;
  lastNavTelemetryTime = now;

  const posEl = document.getElementById('t-pos');
  const distEl = document.getElementById('t-dist');
  const speedEl = document.getElementById('t-speed');
  const lockEl = document.getElementById('t-lock');

  if (posEl && camera) {
    posEl.textContent = `${Math.round(camera.position.x)}, ${Math.round(camera.position.y)}, ${Math.round(camera.position.z)}`;
  }
  if (distEl && camera && controls) {
    const d = Math.round(camera.position.distanceTo(controls.target));
    distEl.textContent = `${d}`;
  }
  if (speedEl) {
    const isBoost = navKeys['ShiftLeft'] || navKeys['ShiftRight'];
    if (isBoost) {
      speedEl.textContent = '2.5x';
      speedEl.className = 't-val t-boost';
    } else {
      speedEl.textContent = '1.0x';
      speedEl.className = 't-val';
    }
  }
  if (lockEl) {
    if (activeNode) {
      lockEl.textContent = activeNode.name;
    } else {
      lockEl.textContent = currentLanguage === 'zh' ? '全景' : 'ALL';
    }
  }
}

function updateControlsHelpI18n() {
  const lblHelp = document.getElementById('lbl-help-text');
  const btnHelp = document.getElementById('btn-controls-help');
  const modalTitle = document.getElementById('help-modal-title');
  const secKb = document.getElementById('help-sec-keyboard');
  const secView = document.getElementById('help-sec-view');
  const secMouse = document.getElementById('help-sec-mouse');

  const kWs = document.getElementById('k-ws');
  const kAd = document.getElementById('k-ad');
  const kQe = document.getElementById('k-qe');
  const kShift = document.getElementById('k-shift');
  const kSpace = document.getElementById('k-space');
  const kC = document.getElementById('k-c');
  const kF = document.getElementById('k-f');
  const kLod = document.getElementById('k-lod');
  const footer = document.getElementById('help-footer-text');

  const mClickT = document.getElementById('m-click-title');
  const mClickD = document.getElementById('m-click-desc');
  const mRightT = document.getElementById('m-right-title');
  const mRightD = document.getElementById('m-right-desc');
  const mPanT = document.getElementById('m-pan-title');
  const mPanD = document.getElementById('m-pan-desc');
  const mDblT = document.getElementById('m-dbl-title');
  const mDblD = document.getElementById('m-dbl-desc');

  if (currentLanguage === 'zh') {
    if (lblHelp) lblHelp.textContent = '操作說明';
    if (btnHelp) btnHelp.title = '3D 導航操控說明';
    if (modalTitle) modalTitle.textContent = '3D 視角與導航操作說明';
    if (secKb) secKb.textContent = '鍵盤導航操作';
    if (secView) secView.textContent = '視圖與層級控制';
    if (secMouse) secMouse.textContent = '滑鼠操作';

    if (kWs) kWs.textContent = '前進 / 後退';
    if (kAd) kAd.textContent = '向左平移 / 向右平移';
    if (kQe) kQe.textContent = '視角上升 / 視角下降';
    if (kShift) kShift.textContent = '加速移動 (2.5倍)';
    if (kSpace) kSpace.textContent = '減速煞車';
    if (kC) kC.textContent = '鏡頭置中並對齊目標節點';
    if (kF) kF.textContent = '全景視野最適化';
    if (kLod) kLod.textContent = '切換層級 (架構 / 標準 / 全部)';
    if (footer) footer.textContent = '按 Esc 或點擊關閉按鈕';

    if (mClickT) mClickT.textContent = '滑鼠左鍵點擊';
    if (mClickD) mClickD.textContent = '選取節點並同步章節內容';
    if (mRightT) mRightT.textContent = '滑鼠右鍵拖曳';
    if (mRightD) mRightD.textContent = '360度環繞旋轉視角';
    if (mPanT) mPanT.textContent = '滑鼠中鍵 / Shift + 左鍵';
    if (mPanD) mPanD.textContent = '平移視角';
    if (mDblT) mDblT.textContent = '雙擊背景';
    if (mDblD) mDblD.textContent = '重設全景中心視野';
  } else {
    if (lblHelp) lblHelp.textContent = 'Help';
    if (btnHelp) btnHelp.title = '3D Navigation Controls Help';
    if (modalTitle) modalTitle.textContent = '3D Navigation Controls';
    if (secKb) secKb.textContent = 'Keyboard Navigation';
    if (secView) secView.textContent = 'View & LOD Controls';
    if (secMouse) secMouse.textContent = 'Mouse Controls';

    if (kWs) kWs.textContent = 'Forward / Backward';
    if (kAd) kAd.textContent = 'Strafe Left / Right';
    if (kQe) kQe.textContent = 'Elevate Up / Down';
    if (kShift) kShift.textContent = 'Boost Speed (2.5x)';
    if (kSpace) kSpace.textContent = 'Brake / Stop';
    if (kC) kC.textContent = 'Center on Active Node / Graph';
    if (kF) kF.textContent = 'Fit Entire Graph';
    if (kLod) kLod.textContent = 'Switch LOD Level (Arch / Standard / All)';
    if (footer) footer.textContent = 'Press Esc to close';

    if (mClickT) mClickT.textContent = 'Left Click';
    if (mClickD) mClickD.textContent = 'Select Node & Sync Markdown';
    if (mRightT) mRightT.textContent = 'Right Click Drag';
    if (mRightD) mRightD.textContent = 'Rotate / Orbit View';
    if (mPanT) mPanT.textContent = 'Middle Click / Shift + Drag';
    if (mPanD) mPanD.textContent = 'Pan View';
    if (mDblT) mDblT.textContent = 'Double Click';
    if (mDblD) mDblD.textContent = 'Reset View to Center';
  }
}

// ==================== App-wide LLM Provider Settings Dialog ====================
// Ported from codegraph-galaxy (galaxy.js provider dialog), re-rooted to
// /api/llm/* — this provider serves the WHOLE app (ingest / chat / anything
// that burns tokens), not just a chat panel. Backend: docgraphical/llm_provider.py.
let provCurrentType = 'llamacpp';
let provFetchedModels = [];

function provT(key) {
  const zh = currentLanguage === 'zh';
  const dic = {
    prov_title: zh ? 'LLM 模型供應商' : 'LLM Providers',
    prov_note: zh ? '此供應商為整支 APP 共用（ingest 摘要、對話與所有 LLM 功能）。'
                  : 'This provider is used by the whole app (ingest, chat, and all LLM features).',
    prov_cur: zh ? '啟用模型' : 'Active model',
    prov_add: zh ? '新增供應商' : 'Add provider',
    prov_f_label: zh ? '名稱' : 'Label',
    prov_f_base: zh ? 'Base URL' : 'Base URL',
    prov_f_key: zh ? 'API 金鑰' : 'API key',
    prov_f_models: zh ? '模型' : 'Models',
    prov_fetch: zh ? '自動抓取' : 'Auto-fill',
    prov_cancel: zh ? '取消' : 'Cancel',
    prov_save: zh ? '儲存' : 'Save',
    prov_test: zh ? '測試' : 'Test',
    prov_models_empty: zh ? '尚無模型，請按自動抓取' : 'No models yet — hit Auto-fill',
    prov_model_loading: zh ? '載入模型清單…' : 'Loading models…',
    prov_model_unset: zh ? '（未指定）' : '(none)',
    prov_ok_models: zh ? ((n, k) => `${n} 個模型（${k}）`) : ((n, k) => `${n} models (${k})`),
    prov_fail: zh ? '連線失敗' : 'Connection failed',
  };
  const v = dic[key];
  if (typeof v === 'function') return v;
  return v !== undefined ? v : key;
}

function toggleProviderDialog(force) {
  const dlg = document.getElementById('prov-dialog');
  if (!dlg) return;
  const show = typeof force === 'boolean' ? force : dlg.style.display === 'none';
  dlg.style.display = show ? 'flex' : 'none';
  if (show) {
    renderProvDialogLabels();
    renderProvPresets();
    refreshProviderList();
    loadProvActiveModel();
  }
}

function renderProvDialogLabels() {
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('lbl-prov-title', provT('prov_title'));
  set('lbl-prov-note', provT('prov_note'));
  set('lbl-prov-cur', provT('prov_cur'));
  set('lbl-prov-add', provT('prov_add'));
  set('lbl-prov-f-label', provT('prov_f_label'));
  set('lbl-prov-f-base', provT('prov_f_base'));
  set('lbl-prov-f-key', provT('prov_f_key'));
  set('lbl-prov-f-models', provT('prov_f_models'));
  set('lbl-prov-fetch', provT('prov_fetch'));
  set('lbl-prov-cancel', provT('prov_cancel'));
  set('lbl-prov-save', provT('prov_save'));
}

function provTypes() {
  // suggest must stay EMPTY: hardcoded model names shown as radio options
  // before Auto-fill are stale fake data (a bad habit ported from galaxy).
  // Real models only ever come from fetchProvModels() after Auto-fill.
  return [
    { id: 'llamacpp', label: 'llama.cpp / vLLM', base: 'http://172.22.20.125:8080/v1', key: 'EMPTY', urlMode: 'edit', keyMode: 'hide', suggest: [] },
    { id: 'openai', label: 'OpenAI', base: 'https://api.openai.com/v1', key: '', urlMode: 'fixed', keyMode: 'require', suggest: [] },
    { id: 'deepseek', label: 'DeepSeek', base: 'https://api.deepseek.com/v1', key: '', urlMode: 'fixed', keyMode: 'require', suggest: [] },
    { id: 'gemini', label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai/', key: '', urlMode: 'fixed', keyMode: 'require', suggest: [] },
    { id: 'groq', label: 'Groq (Llama)', base: 'https://api.groq.com/openai/v1', key: '', urlMode: 'fixed', keyMode: 'require', suggest: [] },
    { id: 'grok', label: 'xAI Grok', base: 'https://api.x.ai/v1', key: '', urlMode: 'fixed', keyMode: 'require', suggest: [] },
    { id: 'custom', label: 'Custom URL', base: '', urlMode: 'edit', keyMode: 'optional', suggest: [] },
  ];
}

function renderProvPresets() {
  const box = document.getElementById('prov-types');
  if (!box) return;
  box.innerHTML = '';
  for (const p of provTypes()) {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.dataset.typeId = p.id;
    b.style.cssText = 'border:1px solid #30363d; background:#161b22; color:#c9d1d9; border-radius:999px; padding:4px 12px; font-size:15px; cursor:pointer;';
    b.onclick = () => selectProvType(p.id);
    box.appendChild(b);
  }
  selectProvType(provCurrentType);
}

function selectProvType(id) {
  const tt = provTypes().find((p) => p.id === id) || provTypes()[0];
  provCurrentType = tt.id;
  provFetchedModels = [];
  const box = document.getElementById('prov-types');
  if (box) {
    Array.from(box.children).forEach((b) => {
      const on = b.dataset.typeId === tt.id;
      b.style.borderColor = on ? '#1f6feb' : '#30363d';
      b.style.color = on ? '#58a6ff' : '#c9d1d9';
    });
  }
  const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v; };
  set('chat-prov-label', tt.label);
  const rowUrl = document.getElementById('prov-row-url');
  const fixedUrl = document.getElementById('prov-fixed-url');
  if (tt.urlMode === 'fixed') {
    if (rowUrl) rowUrl.style.display = 'none';
    if (fixedUrl) {
      fixedUrl.style.display = 'block';
      fixedUrl.textContent = tt.base;
    }
  } else {
    if (fixedUrl) fixedUrl.style.display = 'none';
    if (rowUrl) rowUrl.style.display = '';
    set('chat-prov-base', tt.base);
  }
  const rowKey = document.getElementById('prov-row-key');
  if (rowKey) rowKey.style.display = tt.keyMode === 'hide' ? 'none' : '';
  set('chat-prov-key', tt.key || '');
  const keyLabel = document.getElementById('lbl-prov-f-key');
  if (keyLabel) keyLabel.textContent = provT('prov_f_key') + (tt.keyMode === 'require' ? ' *' : '');
  renderProvModelList(tt.suggest || []);
  const msg = document.getElementById('chat-prov-msg');
  if (msg) msg.textContent = '';
  if (tt.keyMode !== 'require') fetchProvModels();
}

function renderProvModelList(models) {
  provFetchedModels = models || [];
  const box = document.getElementById('prov-model-list');
  if (!box) return;
  box.innerHTML = '';
  if (!provFetchedModels.length) {
    const hint = document.createElement('div');
    hint.style.cssText = 'color:#8b949e; font-size:15px;';
    hint.textContent = provT('prov_models_empty');
    box.appendChild(hint);
    return;
  }
  provFetchedModels.forEach((m, idx) => {
    const lab = document.createElement('label');
    lab.dataset.modelName = (m || '').toLowerCase();
    lab.style.cssText = 'display:flex; gap:8px; align-items:center; border:1px solid #21262d; border-radius:6px; padding:6px 10px; cursor:pointer; font-size:16px;';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'prov-model-pick';
    radio.value = m;
    if (idx === 0) radio.checked = true;
    lab.appendChild(radio);
    const span = document.createElement('span');
    span.textContent = m;
    span.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    lab.appendChild(span);
    box.appendChild(lab);
  });
}

function provPickedModel() {
  const checked = document.querySelector('input[name="prov-model-pick"]:checked');
  return checked ? checked.value : '';
}
// Live-filter the (possibly 100+) fetched model radios by substring.
function filterProvModelList(q) {
  const box = document.getElementById('prov-model-list');
  if (!box) return;
  const needle = (q || '').trim().toLowerCase();
  let visible = 0;
  Array.from(box.children).forEach(lab => {
    if (!lab.dataset || lab.dataset.modelName === undefined) return;
    const hit = !needle || (lab.dataset.modelName || '').includes(needle);
    lab.style.display = hit ? '' : 'none';
    if (hit) visible++;
  });
  // If the checked radio got filtered out, check the first visible one.
  const checked = box.querySelector('input[name="prov-model-pick"]:checked');
  if (checked && checked.closest('label').style.display === 'none') {
    checked.checked = false;
    const first = box.querySelector('label:not([style*="none"]) input[name="prov-model-pick"]');
    if (first) first.checked = true;
  }
}

function provFormBase() {
  const tt = provTypes().find((p) => p.id === provCurrentType) || {};
  if (tt.urlMode === 'fixed') return tt.base;
  const el = document.getElementById('chat-prov-base');
  return el ? el.value.trim() : '';
}

function provFormKey() {
  const tt = provTypes().find((p) => p.id === provCurrentType) || {};
  if (tt.keyMode === 'hide') return tt.key || '';
  const el = document.getElementById('chat-prov-key');
  return el ? el.value.trim() : '';
}

function fetchProvModels() {
  const msg = document.getElementById('chat-prov-msg');
  if (msg) msg.textContent = '…';
  fetch('/api/llm/providers/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base: provFormBase(), key: provFormKey() }),
  })
    .then((res) => res.json())
    .then((d) => {
      if (d.ok && d.models && d.models.length) {
        renderProvModelList(d.models.slice(0, 300));
        if (msg) msg.textContent = `✅ ${provT('prov_ok_models')(d.models.length, d.kind || '')}`;
      } else {
        renderProvModelList([]);
        if (msg) msg.textContent = `❌ ${(d && d.error) || 'empty'}`;
      }
    })
    .catch(() => {
      renderProvModelList([]);
      if (msg) msg.textContent = '❌';
    });
}

function refreshProviderList() {
  const list = document.getElementById('chat-prov-list');
  const msg = document.getElementById('chat-prov-msg');
  if (!list) return;
  fetch('/api/llm/providers')
    .then((res) => res.json())
    .then((data) => {
      list.innerHTML = '';
      for (const p of (data && data.providers) || []) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; gap:6px; align-items:center; border:1px solid #21262d; border-radius:6px; padding:4px 8px;';
        const label = document.createElement('span');
        label.style.flex = '1';
        label.style.cssText += ' overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:15px;';
        label.textContent = `${p.label || p.id} [${(p.models || []).join(', ')}]${p.source === 'file' ? '' : ' 🔒'}`;
        label.title = label.textContent;
        row.appendChild(label);
        const testBtn = document.createElement('button');
        testBtn.textContent = provT('prov_test');
        testBtn.style.cssText = 'background:transparent; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; cursor:pointer; padding:2px 8px; font-size:15px;';
        testBtn.onclick = () => {
          if (msg) msg.textContent = '…';
          fetch(`/api/llm/providers/${encodeURIComponent(p.id)}/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ strLang: (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh') ? 'zh-TW' : 'en-US' }),
          })
            .then((r) => r.json())
            .then((d) => { if (msg) msg.textContent = d.ok ? `✅ ${d.info || ''}` : `❌ ${d.error || ''}`; })
            .catch(() => { if (msg) msg.textContent = '❌'; });
        };
        row.appendChild(testBtn);
        if (p.source === 'file') {
          const delBtn = document.createElement('button');
          delBtn.textContent = '✕';
          delBtn.style.cssText = 'background:transparent; border:1px solid #30363d; border-radius:6px; color:#f85149; cursor:pointer; padding:2px 8px; font-size:15px;';
          delBtn.onclick = () => {
            const lang = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh') ? 'zh-TW' : 'en-US';
            fetch(`/api/llm/providers/${encodeURIComponent(p.id)}?strLang=${encodeURIComponent(lang)}`, { method: 'DELETE' })
              .then(() => { refreshProviderList(); loadProvActiveModel(); })
              .catch(() => { /* ignore */ });
          };
          row.appendChild(delBtn);
        }
        list.appendChild(row);
      }
    })
    .catch(() => { /* ignore */ });
}

function addChatProvider() {
  const msg = document.getElementById('chat-prov-msg');
  const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const picked = provPickedModel();
  if (!provFetchedModels.length || !picked) {
    if (msg) msg.textContent = `❌ ${provT('prov_models_empty')}`;
    return;
  }
  const payload = {
    label: val('chat-prov-label'),
    base: provFormBase(),
    key: provFormKey(),
    models: provFetchedModels,
    strLang: (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh') ? 'zh-TW' : 'en-US',
  };
  fetch('/api/llm/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((res) => res.json().then((d) => ({ status: res.status, body: d })))
    .then(({ status, body }) => {
      if (status === 200 && body.bSuccess) {
        const newId = body.provider.id;
        // Make it the app-wide active LLM immediately (server-persisted truth).
        fetch('/api/llm/active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: newId, model: picked }),
        }).catch(() => { /* best-effort */ });
        try { localStorage.setItem('docgraphical-llm-model', JSON.stringify({ provider: newId, model: picked })); } catch (e) { /* ignore */ }
        if (msg) msg.textContent = `✅ ${newId} → ${picked}`;
        refreshProviderList();
        loadProvActiveModel();
        toggleProviderDialog(false);
      } else if (msg) {
        msg.textContent = `❌ ${(body && body.strError) || status}`;
      }
    })
    .catch(() => { if (msg) msg.textContent = '❌'; });
}

// ---- Active model selector (app-wide current LLM, persisted server-side) ----
function loadProvActiveModel() {
  const sel = document.getElementById('prov-current-model');
  if (!sel) return;
  sel.innerHTML = '';
  const loading = document.createElement('option');
  loading.textContent = provT('prov_model_loading');
  sel.appendChild(loading);
  fetch('/api/llm/providers')
    .then((res) => res.json())
    .then((data) => {
      sel.innerHTML = '';
      const current = (data && data.current) || {};
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem('docgraphical-llm-model') || 'null'); } catch (e) { /* ignore */ }
      const wantProvider = (saved && saved.provider) || current.provider || '';
      const wantModel = (saved && saved.model) || current.model || '';
      for (const p of (data && data.providers) || []) {
        const group = document.createElement('optgroup');
        group.label = (p.available === false ? '⚠ ' : '') + (p.label || p.id);
        for (const m of p.models || []) {
          const opt = document.createElement('option');
          opt.value = `${p.id}:${m}`;
          opt.textContent = m;
          if (p.id === wantProvider && m === wantModel) opt.selected = true;
          group.appendChild(opt);
        }
        sel.appendChild(group);
      }
      if (!sel.value && sel.options.length) sel.selectedIndex = 0;
    })
    .catch(() => {
      sel.innerHTML = '';
      const opt = document.createElement('option');
      opt.textContent = provT('prov_model_unset');
      sel.appendChild(opt);
    });
  sel.onchange = () => {
    const idx = sel.value.indexOf(':');
    if (idx < 0) return;
    const pick = { provider: sel.value.substring(0, idx), model: sel.value.substring(idx + 1) };
    try { localStorage.setItem('docgraphical-llm-model', JSON.stringify(pick)); } catch (e) { /* ignore */ }
    // Server-side persist so background jobs (ingest) resolve the same target.
    fetch('/api/llm/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pick),
    }).catch(() => { /* ignore */ });
  };
}
