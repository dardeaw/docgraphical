// DocGraph 3D - Option 1: 3-Column Knowledge Studio Layout
// Left: Explorer | Center: Markdown Content | Right: 3D Galaxy & Connected Links

let Graph = null;
let rawData = { nodes: [], links: [] };
let filteredData = { nodes: [], links: [] };
let masterGraphData = { nodes: [], links: [] };
let allProjectsList = [];
const selectedProjects = new Set();

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
  try { initSearch(); } catch (e) { console.error('initSearch error:', e); }
  try { loadProjects(); } catch (e) { console.error('loadProjects error:', e); }
  try { checkElectronNative(); } catch (e) { console.error('checkElectronNative error:', e); }
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

  if (w > 0 && h > 0) {
    Graph.width(w).height(h);
  }
}


// ─── File Node 3D Text Sprite Label ──────────────────────────────
function createFileLabelSprite(n) {
  // Only render sleek floating 3D text label for File / Document nodes
  if (!n || n.kind !== 'file') {
    return null;
  }

  const rawPath = n.file || n.name || '';
  const fileName = rawPath.split(/[\\/]/).pop();
  if (!fileName) {
    return null;
  }

  const color = KIND_COLORS.file || '#f0883e';

  if (typeof SpriteText !== 'undefined') {
    try {
      const sprite = new SpriteText(fileName);
      sprite.color = color;
      sprite.textHeight = 1.6;
      sprite.backgroundColor = 'rgba(10, 14, 20, 0.82)';
      sprite.borderWidth = 0;
      sprite.borderRadius = 0;
      // Clean padding without border distortion
      sprite.padding = [0.8, 0.18];
      // Node sphere radius is ~2.6; y = 4.0 places label cleanly above the top of the sphere
      sprite.position.set(0, 4.0, 0);
      if (sprite.material) {
        sprite.material.depthWrite = false;
        sprite.material.transparent = true;
      }
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

function focusOnNode(node) {
  if (!node || node.x === undefined) return;
  activeNode = node;
  const distance = 32; // Tightly scaled focus distance
  const distRatio = 1 + distance / Math.hypot(node.x || 1, node.y || 1, node.z || 1);
  if (Graph) {
    Graph.cameraPosition(
      { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: (node.z || 0) * distRatio },
      { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
      1200
    );
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

  // Refresh 3D Graph elements
  if (Graph) {
    Graph.nodeColor(Graph.nodeColor())
      .linkColor(Graph.linkColor())
      .linkWidth(Graph.linkWidth())
      .linkDirectionalParticles(Graph.linkDirectionalParticles());
  }
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
function loadProjects() {
  fetch('/api/projects')
    .then(res => res.json())
    .then(projects => {
      allProjectsList = projects || [];
      renderRepoTable(allProjectsList);

      // Default select all projects
      selectedProjects.clear();
      allProjectsList.forEach(p => {
        if (p.status === 'ready') selectedProjects.add(p.name);
      });

      if (allProjectsList.length > 0) {
        loadMasterGraphAndFilter();
      }
    })
    .catch(err => console.error('Failed to load projects:', err));
}

function loadMasterGraphAndFilter() {
  if (allProjectsList.length === 0) return;
  
  // The root project (e.g. PythonCode) contains the complete unified database
  const rootProj = allProjectsList.find(p => p.name === 'PythonCode') || allProjectsList[0];
  
  fetch(`/api/graph?path=${encodeURIComponent(rootProj.path)}`)
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

  // Render All Projects
  allProjectsList.forEach(proj => {
    const projName = proj.name;
    const isSelected = selectedProjects.has(projName);
    const projData = projRoots[projName] || { dirs: {}, files: {} };
    const isProjOpen = openProjs.size === 0 ? true : openProjs.has(projName);

    const projNodeEl = document.createElement('div');
    projNodeEl.className = 'tree-node';
    projNodeEl.setAttribute('data-tree-proj', projName);

    projNodeEl.innerHTML = `
      <span class="tree-arrow ${isProjOpen ? 'open' : ''}">▸</span>
      <input type="checkbox" ${isSelected ? 'checked' : ''} title="Toggle project inclusion" />
      <span style="font-weight:600; color:#58a6ff;">📦 ${escapeHtml(projName)}</span>
      <span class="node-kind-tag" style="margin-left:auto;">${proj.files || Object.keys(projData.files).length} files</span>
    `;

    const projChildrenEl = document.createElement('div');
    projChildrenEl.className = `tree-children ${isProjOpen ? 'open' : ''}`;

    const cb = projNodeEl.querySelector('input[type="checkbox"]');
    cb.onclick = (e) => {
      e.stopPropagation();
      if (cb.checked) selectedProjects.add(projName);
      else selectedProjects.delete(projName);
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

    dirNodeEl.innerHTML = `
      <span class="tree-arrow ${isDirOpen ? 'open' : ''}">▸</span>
      <span style="font-weight:500; color:#e6edf3;">📁 ${escapeHtml(dName)}</span>
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

    fileNodeEl.innerHTML = `
      <span class="tree-arrow ${isFileOpen ? 'open' : ''}">▸</span>
      <span style="color:#c9d1d9;">📄 ${escapeHtml(fName)}</span>
      <span class="node-kind-tag">${symList.length}h</span>
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
      highlightScope('file', { project: projName, file: cleanFilePath, node: fileNode, symbols: symList });
      selectActiveNode(fileNode);
      if (fileNode.x !== undefined) focusOnNode(fileNode);
    };

    if (selectedKey === fileKey) {
      selectTreeNode(fileNodeEl);
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
      <span style="color:#e6edf3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px;">${escapeHtml(h.name)}</span>
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
  let targetEl = null;

  if (node.kind === 'file') {
    targetEl = document.querySelector(`[data-tree-file$="${cleanPath}"]`);
  } else {
    targetEl = document.querySelector(`[data-tree-node-id="${node.id}"]`);
  }

  if (targetEl) {
    selectTreeNode(targetEl);
    targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

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
  }
}

function filterTree(q) {
  const query = (q || '').trim().toLowerCase();
  document.querySelectorAll('#tree-container .tree-node').forEach(el => {
    if (!query) {
      el.style.display = 'flex';
      return;
    }
    const text = el.innerText.toLowerCase();
    el.style.display = text.includes(query) ? 'flex' : 'none';
  });
}

function selectAllProjects(val) {
  allProjectsList.forEach(p => {
    if (val) selectedProjects.add(p.name);
    else selectedProjects.delete(p.name);
  });
  document.querySelectorAll('#tree-container input[type="checkbox"]').forEach(cb => cb.checked = val);
  filterGraphBySelectedProjects(false);
}

// ─── 5. Center Doc Stage & Right Links Updates ────────────────────
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
  const headingParam = node.kind === 'file' ? '' : `&heading=${encodeURIComponent(node.name)}`;
  fetch(`/api/doc/section?file=${encodeURIComponent(queryFile)}${headingParam}&sub=1`)
    .then(res => res.json())
    .then(data => {
      const content = data.content || node.content || '';
      renderMarkdown(content);

      // Token Intelligence Metrics
      const fullTokens = node.tokens || Math.ceil(content.length / 3.8);
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
      relList.innerHTML = '<div style="font-size:11px; color:#8b949e; padding:8px;">No connected links for this node</div>';
    } else {
      connectedLinks.forEach(l => {
        const srcId = typeof l.source === 'object' ? l.source.id : l.source;
        const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
        const otherId = (srcId === node.id) ? tgtId : srcId;
        const otherNode = rawData.nodes.find(n => n.id === otherId);
        if (!otherNode) return;

        const isDocLink = l.kind === 'doc_link';
        const isOut = (srcId === node.id);
        const relLabel = isDocLink ? (isOut ? '🔗 References' : '↩ Referenced By') : (isOut ? '▾ Contains' : '▴ Parent');

        const row = document.createElement('div');
        row.className = 'rel-row';
        row.style.cursor = 'pointer';
        row.innerHTML = `
          <span class="rel-kind" style="background:${isDocLink ? '#23863644' : '#1f6feb33'}; color:${isDocLink ? '#00ffaa' : '#58a6ff'}; border:1px solid ${isDocLink ? '#238636aa' : '#1f6feb88'};">${relLabel}</span>
          <span class="rel-target" style="color:#e6edf3; font-weight:500;">${escapeHtml(otherNode.name)}</span>
          <span class="node-kind-tag" style="margin-left:auto; font-size:10px;">${otherNode.kind === 'file' ? 'DOC' : 'H' + (otherNode.level || 1)}</span>
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
  if (window.marked) {
    container.innerHTML = marked.parse(mdText || '');
    container.querySelectorAll('pre code').forEach((block) => {
      if (window.hljs) hljs.highlightElement(block);
    });
  } else {
    container.innerText = mdText || '';
  }
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

function initDraggableLegend() {
  const panel = document.getElementById('legend-panel');
  const handle = document.getElementById('legend-drag-handle');
  if (!panel || !handle) return;
  let isDragging = false;
  let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

  handle.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    panel.style.bottom = 'auto';
    panel.style.right = 'auto';
    panel.style.left = initialLeft + 'px';
    panel.style.top = initialTop + 'px';
    document.body.style.cursor = 'move';
    e.stopPropagation();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    panel.style.left = `${initialLeft + dx}px`;
    panel.style.top = `${initialTop + dy}px`;
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    document.body.style.cursor = 'default';
  });
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

function initSearch() {
  const searchBox = document.getElementById('search-box');
  if (!searchBox) return;
  searchBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = searchBox.value.trim().toLowerCase();
      if (!q) return;

      const found = (filteredData.nodes || []).find(n => n.name.toLowerCase().includes(q));
      if (found) {
        highlightScope('node', found);
        focusOnNode(found);
        selectActiveNode(found);
        syncExplorerSelection(found);
        showToast(`🎯 Focused: ${found.name}`);
      } else {
        showToast(`❌ Not found: ${q}`);
      }
    }
  });
}

function openPathModal() {
  const m = document.getElementById('path-modal');
  if (m) m.classList.add('show');
  loadProjects();
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
  
  (projects || []).forEach(p => {
    const tr = document.createElement('tr');
    const isIndexed = p.is_indexed || p.has_db;
    const metricsText = isIndexed ? `${p.nodes || 0} / ${p.links || 0}` : '--';
    const escapedPath = p.path.replace(/\\/g, '\\\\');

    let actionsHtml = '';
    if (isIndexed) {
      actionsHtml = `
        <div class="action-btn-group">
          <button class="act-btn" onclick="syncRepo('${escapedPath}')">Incremental Index</button>
          <button class="act-btn" onclick="rebuildRepo('${escapedPath}')">Full Rebuild</button>
          <button class="act-btn danger" onclick="uninitRepo('${escapedPath}')">Uninit</button>
        </div>
      `;
    } else {
      actionsHtml = `
        <div class="action-btn-group">
          <button class="act-btn green" onclick="initRepo('${escapedPath}')">Create Index</button>
          <button class="act-btn danger" onclick="excludeRepo('${escapedPath}')">Exclude</button>
        </div>
      `;
    }

    tr.innerHTML = `
      <td style="font-weight:600; color:#58a6ff;">${escapeHtml(p.name)}</td>
      <td style="font-family:monospace; font-size:11px; color:#8b949e;" title="${escapeHtml(p.path)}">${escapeHtml(p.path)}</td>
      <td style="font-family:monospace; font-size:11px; color:#c9d1d9;">${metricsText}</td>
      <td>
        <span class="status-tag ${isIndexed ? 'ready' : 'unindexed'}">
          ${isIndexed ? 'Indexed' : 'Unindexed'}
        </span>
      </td>
      <td>${actionsHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

function syncRepo(path) {
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
      alert('Sync failed: ' + res.error);
    }
  })
  .catch(err => alert('Sync error: ' + err));
}

function rebuildRepo(path) {
  if (!confirm('Are you sure you want to perform a full AST rebuild?')) return;
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
      alert('Rebuild failed: ' + res.error);
    }
  })
  .catch(err => alert('Rebuild error: ' + err));
}

function uninitRepo(path) {
  if (!confirm('Uninitialize repository? This removes the local .docgraphical database.')) return;
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
      alert('Uninit failed: ' + res.error);
    }
  })
  .catch(err => alert('Uninit error: ' + err));
}

function initRepo(path) {
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
      alert('Index failed: ' + res.error);
    }
  })
  .catch(err => alert('Index error: ' + err));
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

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

function toggleLanguage() {
  currentLanguage = currentLanguage === 'en' ? 'zh' : 'en';
  const b = document.getElementById('btn-lang');
  if (b) b.textContent = `Language: ${currentLanguage.toUpperCase()}`;
  updateSwapButtonI18n();
  updateControlsHelpI18n();
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

      // WASD for horizontal fly & strafe, QE for elevate up / down
      const hasMovement = navKeys['KeyW'] || navKeys['KeyS'] || navKeys['KeyA'] || navKeys['KeyD'] ||
                          navKeys['KeyQ'] || navKeys['KeyE'];

      if (hasMovement && (isMouseIn3DPane || document.activeElement === document.body)) {
        const isBoost = navKeys['ShiftLeft'] || navKeys['ShiftRight'];
        const baseSpeed = isBoost ? 2.5 : 1.0;

        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);

        const up = camera.up.clone().normalize();
        const right = new THREE.Vector3().crossVectors(dir, up).normalize();

        // Forward / Backward (W / S)
        if (navKeys['KeyW']) flightTargetVel.addScaledVector(dir, baseSpeed);
        if (navKeys['KeyS']) flightTargetVel.addScaledVector(dir, -baseSpeed);

        // Strafe Left / Right (A / D)
        if (navKeys['KeyA']) flightTargetVel.addScaledVector(right, -baseSpeed);
        if (navKeys['KeyD']) flightTargetVel.addScaledVector(right, baseSpeed);

        // Elevate Up / Down (Q / E)
        if (navKeys['KeyQ']) flightTargetVel.addScaledVector(up, baseSpeed * 0.9);
        if (navKeys['KeyE']) flightTargetVel.addScaledVector(up, -baseSpeed * 0.9);
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
