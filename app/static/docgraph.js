let activeSpotlightConcept = null;
function loadGraphData() { if (typeof loadMasterGraphAndFilter === 'function') loadMasterGraphAndFilter(); }
let cachedFileConceptsMap = {};
let cachedHeadingConceptsMap = {};
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
// Drill-down temporary reveal (selection-scoped, per-NODE ids): a node whose
// kind is hidden by the LOD filter is still drawn iff listed here. Drill-down
// display is TEMPORARY and NEVER touches hiddenKinds / legend.
let tempRevealIds = new Set();
let activeNode = null;
let selectedTreeNodeEl = null;
let isTreeOpen = true;
let isRotating = false;
let currentLanguage = (function() {
  try {
    const saved = localStorage.getItem('docgraph_language');
    if (saved && ['zh', 'en', 'ja'].includes(saved)) return saved;
    // Auto-detect from system/browser locale
    const navLang = (navigator.languages && navigator.languages[0]) || navigator.language || navigator.userLanguage || '';
    const lower = navLang.toLowerCase();
    if (lower.startsWith('zh')) return 'zh';
    if (lower.startsWith('ja')) return 'ja';
    return 'en';
  } catch(e) {
    return 'zh'; // Fallback to zh for the localized deployment
  }
})();

// Mode & Filter States
let currentLOD = 'all'; // 'arch', 'standard', 'all', 'custom'
const hiddenKinds = new Set(['heading_2', 'heading_3', 'heading_4', 'heading_5', 'heading_6']);
const hiddenEdgeKinds = new Set();


function getDocIconSvg(color = KIND_COLORS.file || '#f0883e') {
  return `<svg class="tree-doc-icon" viewBox="0 0 16 16" width="13" height="13" fill="${color}" style="margin-right:5px; flex-shrink:0; vertical-align:-1.5px; display:inline-block;"><path d="M4 0h5.5l4.5 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5 1v3.5a.5.5 0 0 0 .5.5H13L9 1z"/></svg>`;
}

const KIND_COLORS = {
  concept: '#e2e8f0', // Core Concept WikiLink (Royal Silver Cube)
  file: '#f0883e',       // Document (Warm Cyber Orange)
  heading_1: '#58a6ff',  // H1 Primary (Electric Blue)
  heading_2: '#3fb950',  // H2 Major (Emerald Green)
  heading_3: '#bc8cff',  // H3 Subsection (Vivid Purple)
  heading_4: '#ff7bba',  // H4 Detail (Vibrant Rose Pink)
  heading_5: '#00d2d3',  // H5 Fine (Cyan / Turquoise)
  heading_6: '#ffd700'   // H6 Micro (Bright Gold)
};
// ─── Shared Architecture Utilities (Single Source of Truth) ───
function getNodeColor(kind) {
  return KIND_COLORS[kind] || '#58a6ff';
}

function getNodeKindLabel(node) {
  if (!node) return 'NODE';
  if (node.kind === 'file') return 'DOC';
  if ((node.kind || '').startsWith('heading')) return 'H' + (node.level || 1);
  if (node.kind === 'concept') return 'TAG';
  return (node.kind || 'NODE').toUpperCase().slice(0, 4);
}

function getRelationMeta(link, currentNodeId, lang) {
  const isDocLink = (link.kind === 'doc_link');
  const srcId = typeof link.source === 'object' ? link.source.id : link.source;
  const isOut = (srcId === currentNodeId);
  const isZh = (lang === 'zh');

  let icon = isDocLink ? (isOut ? '→' : '←') : (isOut ? '↓' : '↑');
  let text = '';
  if (isZh) {
    text = isDocLink ? (isOut ? '引用' : '被引用') : (isOut ? '包含' : '上層');
  } else {
    text = isDocLink ? (isOut ? 'References' : 'Referenced By') : (isOut ? 'Contains' : 'Parent');
  }
  return { icon, text, isDocLink, isOut };
}


const KIND_SIZES = {
  concept: 2.8,       // Royal Silver Cube
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
  doc_link: '#00ffaa',
  wiki_link: '#bc8cff' // Vivid Violet Orbit Beam
};

document.addEventListener('DOMContentLoaded', () => {
  try { applyAppLanguage(); } catch (e) { console.error('lang init error:', e); }
  try { fetchConceptsData(); } catch (e) { console.error('concepts init error:', e); }
  try { updateLintBadgeOnly(); } catch (e) { console.error('lint badge error:', e); }
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

// ─── Unified label-style pipeline (single source of truth) ───────────────
// Both updateLabelsVisibility (refresh pass) and createFileLabelSprite (birth
// pass for lazily-created sprites) resolve through these two helpers, so a
// sprite is born with the correct style and every refresh converges to it.

function resolveRevealedNodeId(gNodes) {
  if (activeNode) {
    // Drill-down temporary reveal counts as shown (hiddenKinds untouched)
    const kindShown = !hiddenKinds.has(activeNode.kind) || tempRevealIds.has(activeNode.id);
    if (kindShown && gNodes.some(n => n.id === activeNode.id)) {
      return activeNode.id;
    }
    // If activeNode's layer is not shown, reveal closest visible ancestor's label
    const nearAnc = findImmediateAncestor(activeNode, gNodes);
    if (nearAnc) return nearAnc.id;
  }
  return null;
}

function labelStyleFor(n, hasFilter, revealedNodeId) {
  const isFile = (n.kind === 'file');
  const kindColor = KIND_COLORS[n.kind] || '#58a6ff';
  if (!hasFilter) {
    return { opacity: isFile ? 0.95 : 0.0, color: kindColor, backgroundColor: 'rgba(10, 14, 20, 0.85)' };
  }
  // When filter/spotlight is active, revealedNodeId ONLY applies if it is actually highlighted
  if (n.id === revealedNodeId && highlightNodes.has(n.id)) {
    return { opacity: 1.0, color: kindColor, backgroundColor: 'rgba(10, 14, 20, 0.92)' };
  }
  if (highlightNodes.has(n.id)) {
    if (isFile) return { opacity: 0.92, color: kindColor, backgroundColor: 'rgba(10, 14, 20, 0.85)' };
    return { opacity: 0.75, color: kindColor, backgroundColor: 'rgba(10, 14, 20, 0.75)' };
  }
  // When spotlight or filter is active, non-highlighted nodes must NEVER show ghost labels
  return { opacity: 0.0, color: '#6e7681', backgroundColor: 'transparent' };
}

// ─── Drill-down upward-chain resolution (temporary reveal) ───────────────
// Returns the selected node's upward chain ids, leaf → root
// (node → … → H1 → file), mirroring highlightScope('node') steps 1–2.
// Only these ids are temporarily drawn; hiddenKinds / legend stay pristine.

function parentIdOf(nodeId) {
  for (const l of (rawData.links || [])) {
    if (l.kind !== 'parent_child') continue;
    const sId = typeof l.source === 'object' ? l.source.id : l.source;
    const tId = typeof l.target === 'object' ? l.target.id : l.target;
    if (tId === nodeId) return sId;
  }
  return null;
}

function chainIdsUpward(node) {
  const ids = [];
  if (!node || !node.id) return ids;
  const seen = new Set([node.id]);
  ids.push(node.id);
  let frontier = [node.id];
  while (frontier.length > 0) {
    const next = [];
    for (const id of frontier) {
      const p = parentIdOf(id);
      if (p && !seen.has(p)) {
        seen.add(p);
        ids.push(p);
        next.push(p);
      }
    }
    frontier = next;
  }
  // Owner-file backstop (mirrors highlightScope step 2) for missing edges
  if (node.file) {
    const cleanPath = (node.file || '').replace(/\\/g, '/');
    const fileNode = (rawData.nodes || []).find(n => n.kind === 'file' && ((n.file || '').replace(/\\/g, '/') === cleanPath || n.id === `file::${cleanPath}`));
    if (fileNode && !seen.has(fileNode.id)) {
      seen.add(fileNode.id);
      ids.push(fileNode.id);
    }
  }
  // Reverse order: Root -> H1 -> H2 -> Child (順序相反，根部至葉節點平滑順序點亮與展現)
  return ids.reverse();
}

// Seed coordinates for chain nodes that have never been laid out, starting
// each at its nearest positioned ancestor (+ jitter). The first click then
// centers on the node immediately — no "click twice" and no camera flight
// to empty space while the force layout settles.
function seedChainPositions(chainIds) {
  const byId = new Map((rawData.nodes || []).map(n => [n.id, n]));
  // Ensure array is root-to-leaf: if first element is target leaf and last is file, reverse it
  let rootToLeaf = [...chainIds];
  if (rootToLeaf.length > 1) {
    const first = byId.get(rootToLeaf[0]);
    const last = byId.get(rootToLeaf[rootToLeaf.length - 1]);
    if (first && last && first.kind !== 'file' && last.kind === 'file') {
      rootToLeaf.reverse();
    }
  }

  rootToLeaf.forEach(id => {
    const n = byId.get(id);
    if (!n || (n.x !== undefined && n.y !== undefined && n.z !== undefined)) return;
    let anc = parentIdOf(id);
    let base = null;
    let guard = 0;
    while (anc && guard++ < 20) {
      const an = byId.get(anc);
      if (an && an.x !== undefined && an.y !== undefined && an.z !== undefined) { base = an; break; }
      anc = parentIdOf(anc);
    }
    if (!base && n.file) {
      const cleanPath = (n.file || '').replace(/\\/g, '/');
      const fn = (rawData.nodes || []).find(x => x.kind === 'file' && (((x.file || '').replace(/\\/g, '/') === cleanPath || x.id === `file::${cleanPath}` || x.id.endsWith(`::file::${cleanPath}`))) && x.x !== undefined && x.y !== undefined && x.z !== undefined);
      if (fn) base = fn;
    }
    if (base) {
      // Deterministic slight offset along hierarchy vector to prevent violent repulsive explosion
      n.x = (Number(base.x) || 0) + (Math.random() - 0.5) * 3;
      n.y = (Number(base.y) || 0) + (Math.random() - 0.5) * 3;
      n.z = (Number(base.z) || 0) + (Math.random() - 0.5) * 3;
    }
  });
}

function createFileLabelSprite(n) {
  if (!n) return null;

  const isFile = (n.kind === 'file');
  const labelText = stripMdLinks(isFile ? (n.file || n.name || '').split(/[\\/]/).pop() : (n.name || ''));
  if (!labelText) return null;

  // Born correct: resolve style from current pipeline state (render loop may
  // create this sprite after the last synchronous refresh pass).
  const gNodes = (Graph && Graph.graphData) ? (Graph.graphData().nodes || []) : (rawData.nodes || []);
  const birthStyle = labelStyleFor(n, highlightNodes.size > 0, resolveRevealedNodeId(gNodes));

  if (typeof SpriteText !== 'undefined') {
    try {
      const sprite = new SpriteText(labelText);
      sprite.color = birthStyle.color;
      sprite.textHeight = isFile ? 1.6 : 1.3;
      sprite.backgroundColor = birthStyle.backgroundColor;
      sprite.borderWidth = 0;
      sprite.borderRadius = 2;
      sprite.padding = [0.7, 0.16];
      sprite.position.set(0, (KIND_SIZES[n.kind] || 1.5) + 2.4, 0);
      if (sprite.material) {
        sprite.material.depthWrite = false;
        sprite.material.transparent = true;
        sprite.material.opacity = birthStyle.opacity;
      }
      n.__labelSprite = sprite;
      return sprite;
    } catch (err) {
      console.warn('SpriteText creation failed:', err);
    }
  }

  return null;
}

function createCustomNodeObject(n) {
  if (!n) return null;
  if (n.kind === 'concept') {
    if (typeof SpriteText !== 'undefined') {
      try {
        // 純標籤牌直接作為 3D 本體實體！完全移除 3D 方塊與 Halo，居中對齊連線
         const sprite = new SpriteText(`🏷️ ${stripMdLinks(n.name)}`);
        sprite.color = '#ffffff';
        sprite.textHeight = 2.4;
        sprite.backgroundColor = 'rgba(10, 14, 22, 0.92)';
        sprite.borderColor = '#94a3b8';
        sprite.borderWidth = 0.2;
        sprite.borderRadius = 3;
        sprite.padding = [1.2, 0.35];
        sprite.position.set(0, 0, 0);
        if (sprite.material) {
          sprite.material.depthWrite = false;
          sprite.material.transparent = true;
          sprite.material.opacity = 0.95;
        }
        n.__conceptSprite = sprite;
        return sprite;
      } catch (err) {
        console.warn('Concept SpriteText creation failed:', err);
      }
    }
    return null;
  }
  return createFileLabelSprite(n);
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
      if (n.kind === 'concept') {
        return `<div class="scene-tooltip">
          <div class="tooltip-title" style="color:#f0883e;">🏷️ ${escapeHtml(stripMdLinks(n.name))}</div>
          <div class="tooltip-sub">Concept Tag</div>
        </div>`;
      }
      const typeLabel = n.kind === 'file' ? 'Document' : `H${n.level || 1} Section`;
      // Shared plate: identical look to the tag-table crumb cell.
      return `<div class="scene-tooltip">${nodePlateHtml({ title: n.name, kind: n.kind, level: n.level, file: n.file, line: n.line, project: n.project, clickable: false })}</div>`;
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
    .nodeThreeObjectExtend(n => n.kind !== 'concept')
    .nodeThreeObject(n => createCustomNodeObject(n))
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
        return highlightLinks.has(l) ? 0.7 : 0.12;
      }
      return l.kind === 'doc_link' ? 0.45 : (l.kind === 'wiki_link' ? 0.35 : 0.2);
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
      dispatchUnifiedSelection(node);
    })
    .onNodeRightClick((node, event) => {
      openNodeContextMenu(node, event);
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

  // Determine which node's label (SpriteText) should be revealed
  const revealedNodeId = resolveRevealedNodeId(gNodes);

  gNodes.forEach(n => {
    if (n.kind === 'concept' && n.__conceptSprite) {
      const isHighlighted = highlightNodes.has(n.id);
      if (n.__conceptSprite.material) {
        if (!hasFilter) {
          n.__conceptSprite.material.opacity = 0.95;
          n.__conceptSprite.borderColor = '#94a3b8';
        } else if (isHighlighted) {
          n.__conceptSprite.material.opacity = 1.0;
          n.__conceptSprite.borderColor = '#58a6ff';
        } else {
          n.__conceptSprite.material.opacity = 0.15;
          n.__conceptSprite.borderColor = '#30363d';
        }
      }
    }
    if (n.__labelSprite) {
      // Revealed Shrine: strictly preserve original AST kind color
      // (H1=blue, H2=green, H3=purple, File=orange, etc.)
      const st = labelStyleFor(n, hasFilter, revealedNodeId);
      n.__labelSprite.visible = true; // Never completely remove
      if (n.__labelSprite.material) n.__labelSprite.material.opacity = st.opacity;
      n.__labelSprite.color = st.color;
      n.__labelSprite.backgroundColor = st.backgroundColor;
    }
  });
}

function focusOnNode(node) {
  if (!node) return;

  // Resolve live node with priority: Graph.graphData -> rawData.nodes -> input node
  let liveNode = node;
  const rawMatch = (rawData.nodes || []).find(n => n.id === node.id);
  const graphNodes = (Graph && Graph.graphData) ? (Graph.graphData().nodes || []) : [];
  const gMatch = graphNodes.find(n => n.id === node.id);

  if (gMatch && gMatch.x !== undefined && gMatch.y !== undefined && gMatch.z !== undefined) {
    liveNode = gMatch;
  } else if (rawMatch && rawMatch.x !== undefined && rawMatch.y !== undefined && rawMatch.z !== undefined) {
    liveNode = rawMatch;
  } else if (node.x !== undefined && node.y !== undefined && node.z !== undefined) {
    liveNode = node;
  } else if (gMatch) {
    liveNode = gMatch;
  } else if (rawMatch) {
    liveNode = rawMatch;
  }

  if (!liveNode) return;
  activeNode = liveNode;

  // Check if node is visible or revealed in 3D
  const isVisibleIn3D = (n) => {
    if (!n || n.x === undefined) return false;
    if (hiddenKinds.has(n.kind) && !tempRevealIds.has(n.id)) return false;
    return true;
  };

  let centerNode = liveNode;
  if (!isVisibleIn3D(liveNode)) {
    // If liveNode coordinates are missing, attempt to seed them from ancestor or file
    if (liveNode.x === undefined) {
      seedChainPositions([liveNode.id]);
      if (rawMatch && rawMatch.x !== undefined) {
        liveNode.x = rawMatch.x; liveNode.y = rawMatch.y; liveNode.z = rawMatch.z;
        if (node !== rawMatch) { node.x = rawMatch.x; node.y = rawMatch.y; node.z = rawMatch.z; }
      }
    }
  }

  // If node is now visible or revealed, target node itself! Only fallback to ancestor if completely unpositioned
  if (!isVisibleIn3D(centerNode)) {
    // Walk parent_child up the chain (raw links) to the nearest visible ancestor
    const gLinks = rawData.links || [];
    let frontier = [node.id];
    const seen = new Set([node.id]);
    let found = null;
    while (frontier.length > 0 && !found) {
      const next = [];
      for (const id of frontier) {
        for (const l of gLinks) {
          if (l.kind !== 'parent_child') continue;
          const sId = typeof l.source === 'object' ? l.source.id : l.source;
          const tId = typeof l.target === 'object' ? l.target.id : l.target;
          if (tId !== id || seen.has(sId)) continue;
          seen.add(sId);
          const an = (rawData.nodes || []).find(n2 => n2.id === sId);
          if (!an) continue;
          if (isVisibleIn3D(an)) { found = an; break; }
          next.push(sId);
        }
        if (found) break;
      }
      frontier = next;
    }
    if (found) {
      centerNode = found;
    } else {
      return;
    }
  }

  if (centerNode.x === undefined) return;

  if (Graph) {
    // Re-resolve centerNode from live Graph nodes if present
    const gNodes = (Graph && Graph.graphData) ? (Graph.graphData().nodes || []) : [];
    const liveTarget = gNodes.find(n => n.id === centerNode.id) || centerNode;
    const targetPos = { x: Number(liveTarget.x) || 0, y: Number(liveTarget.y) || 0, z: Number(liveTarget.z) || 0 };
    const camera = Graph.camera();
    const controls = Graph.controls();

    let camPos;
    if (camera && controls && typeof THREE !== 'undefined') {
      const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
      // If camera is too close or degenerated, use standard default viewpoint angle
      if (dir.lengthSq() < 1 || isNaN(dir.x)) {
        dir.set(0, 0, 1);
      }
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

    // Smooth single-arc camera flight without frame-by-frame controls fight
    if (window._cameraTrackingTimer) {
      cancelAnimationFrame(window._cameraTrackingTimer);
      window._cameraTrackingTimer = null;
    }

    // Stabilize active node coordinates permanently during focus:
    // Keep fx, fy, fz pinned to targetPos so D3 force simulation NEVER rebounds,
    // kicks, or jerks the selected node away after the camera lands!
    // Release any previous pinned node if different
    if (window._pinnedNode && window._pinnedNode !== liveTarget) {
      window._pinnedNode.fx = undefined;
      window._pinnedNode.fy = undefined;
      window._pinnedNode.fz = undefined;
    }
    liveTarget.fx = targetPos.x;
    liveTarget.fy = targetPos.y;
    liveTarget.fz = targetPos.z;
    window._pinnedNode = liveTarget;

    // Clear any pending unpin timer so physics cannot violently rebound
    if (window._unpinTimer) {
      clearTimeout(window._unpinTimer);
      window._unpinTimer = null;
    }

    // Execute buttery-smooth 60fps Three.js tween directly to dead-center
    Graph.cameraPosition(camPos, targetPos, 700);
  }

  // Unified display pipeline: focusOnNode is the single writer of activeNode
  // (selection decree), so the label pass is refreshed here — never scattered
  // at call sites. This keeps the revealed plate tracking the NEW selection
  // instead of lagging one selection behind.
  if (typeof updateLabelsVisibility === 'function') updateLabelsVisibility();
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

    // 1. Trace upward from target node to discover full branch
    const branchIds = [];
    let cur = node.id;
    const visited = new Set([cur]);
    branchIds.push(cur);
    while (cur) {
      const p = parentIdOf(cur);
      if (p && !visited.has(p)) {
        visited.add(p);
        branchIds.push(p);
        cur = p;
      } else {
        break;
      }
    }

    // 2. File node backstop
    if (node.file) {
      const cleanPath = (node.file || '').replace(/\\/g, '/');
      const fileNode = rawData.nodes.find(n => n.kind === 'file' && ((n.file || '').replace(/\\/g, '/') === cleanPath || n.id === `file::${cleanPath}`));
      if (fileNode && !visited.has(fileNode.id)) {
        visited.add(fileNode.id);
        branchIds.push(fileNode.id);
      }
    }

    // 順序相反 (點亮順序改為自根部文檔向下依序點亮至目前節點: File -> H1 -> H2 -> Child)
    const rootToLeaf = branchIds.reverse();
    rootToLeaf.forEach(id => highlightNodes.add(id));

    // Connect ancestor parent_child links along the branch
    rawLinks.forEach(l => {
      if (l.kind === 'parent_child') {
        const sId = typeof l.source === 'object' ? l.source.id : l.source;
        const tId = typeof l.target === 'object' ? l.target.id : l.target;
        if (highlightNodes.has(sId) && highlightNodes.has(tId)) {
          highlightLinks.add(l);
        }
      }
    });

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
  if (activeSpotlightConcept) {
    activeSpotlightConcept = null;
    applyLODAndFilter();
  }
  if (selectedTreeNodeEl) {
    selectedTreeNodeEl.classList.remove('selected');
    selectedTreeNodeEl = null;
  }

  // Restore user LOD settings if temporarily unhidden (concept-spotlight path)
  let needRefilter = false;
  if (userLODHiddenSnapshot) {
    hiddenKinds.clear();
    userLODHiddenSnapshot.forEach(k => hiddenKinds.add(k));
    userLODHiddenSnapshot = null;
    updateLegendUI();
    needRefilter = true;
  }

  // Drop drill-down temporary reveal (selection-scoped; legend/LOD untouched)
  if (tempRevealIds.size > 0) {
    tempRevealIds.clear();
    needRefilter = true;
  }
  if (needRefilter) applyLODAndFilter();

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
  fetchConceptsData();
  updateLintBadgeOnly();
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
  if (!container.dataset.ctxBound) {
    container.dataset.ctxBound = '1';
    container.addEventListener('contextmenu', openTreeCtxMenu);
  }

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

  // ─── Build Global Concept Maps for Explorer Tree Badges ───
  cachedFileConceptsMap = {};
  cachedHeadingConceptsMap = {};

  const allGraphLinks = (masterGraphData.links && masterGraphData.links.length > 0) ? masterGraphData.links : (rawData.links || []);
  allGraphLinks.forEach(l => {
    if (l.kind === 'wiki_link') {
      const tgt = typeof l.target === 'object' ? (l.target.id || '') : (l.target || '');
      const src = typeof l.source === 'object' ? (l.source.id || '') : (l.source || '');
      let cName = '';
      if (tgt.includes('concept::')) {
        cName = tgt.substring(tgt.lastIndexOf('concept::') + 9);
      } else if (typeof l.target === 'object' && l.target.name) {
        cName = l.target.name;
      }
      if (!cName) return;

      if (src.includes('heading::')) {
        if (!cachedHeadingConceptsMap[src]) cachedHeadingConceptsMap[src] = new Set();
        cachedHeadingConceptsMap[src].add(cName);
        const rawSrc = src.replace(/^p\d+::/, '');
        if (!cachedHeadingConceptsMap[rawSrc]) cachedHeadingConceptsMap[rawSrc] = new Set();
        cachedHeadingConceptsMap[rawSrc].add(cName);

        const parts = rawSrc.split('::');
        if (parts.length >= 2) {
          const f = parts[1].replace(/\\/g, '/');
          if (!cachedFileConceptsMap[f]) cachedFileConceptsMap[f] = new Set();
          cachedFileConceptsMap[f].add(cName);
          const fBase = f.split('/').pop();
          if (!cachedFileConceptsMap[fBase]) cachedFileConceptsMap[fBase] = new Set();
          cachedFileConceptsMap[fBase].add(cName);
        }
      } else if (src.includes('file::')) {
        const rawSrc = src.replace(/^p\d+::/, '');
        const f = rawSrc.replace('file::', '').replace(/\\/g, '/');
        if (!cachedFileConceptsMap[f]) cachedFileConceptsMap[f] = new Set();
        cachedFileConceptsMap[f].add(cName);
        const fBase = f.split('/').pop();
        if (!cachedFileConceptsMap[fBase]) cachedFileConceptsMap[fBase] = new Set();
        cachedFileConceptsMap[fBase].add(cName);
      }
    }
  });

  // Supplement from conceptsTreeData if available
  if (typeof conceptsTreeData !== 'undefined' && conceptsTreeData && conceptsTreeData.tree) {
    Object.values(conceptsTreeData.tree).forEach(cList => {
      (cList || []).forEach(cObj => {
        const cName = cObj.name;
        if (typeof activeConceptLinkedFiles !== 'undefined' && activeConceptLinkedFiles[cName]) {
          activeConceptLinkedFiles[cName].forEach(lf => {
            const fp = (lf.filePath || '').replace(/\\/g, '/');
            if (fp.startsWith('heading::')) {
              if (!cachedHeadingConceptsMap[fp]) cachedHeadingConceptsMap[fp] = new Set();
              cachedHeadingConceptsMap[fp].add(cName);
              const parts = fp.split('::');
              if (parts.length >= 2) {
                const f = parts[1];
                if (!cachedFileConceptsMap[f]) cachedFileConceptsMap[f] = new Set();
                cachedFileConceptsMap[f].add(cName);
                const fBase = f.split('/').pop();
                if (!cachedFileConceptsMap[fBase]) cachedFileConceptsMap[fBase] = new Set();
                cachedFileConceptsMap[fBase].add(cName);
              }
            } else {
              const f = fp.replace('file::', '');
              if (!cachedFileConceptsMap[f]) cachedFileConceptsMap[f] = new Set();
              cachedFileConceptsMap[f].add(cName);
              const fBase = f.split('/').pop();
              if (!cachedFileConceptsMap[fBase]) cachedFileConceptsMap[fBase] = new Set();
              cachedFileConceptsMap[fBase].add(cName);
            }
          });
        }
      });
    });
  }


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
    } else if (n.kind && n.kind.startsWith('heading')) {
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
      <button class="mini-btn txbtn" style="margin-left:auto; width:22px; height:20px; padding:0; font-size:13px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;" title="${vProjZh ? '在此專案新增文件…（開啟 LLM 摘要入庫對話框）' : 'New document here… (open LLM summary ingest dialog)'}" onclick="event.stopPropagation();treeNewDocument('${vProjEsc}')">＋</button>
      <span class="node-kind-tag txbadge" style="margin-left:6px;">${proj.files || Object.keys(projData.files).length} md</span>
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
      if (typeof syncScanScopeIfOpen === 'function') syncScanScopeIfOpen();
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
// next to the md docs. Default OFF (user-mandated), remembered in localStorage.
const SRC_VIS_KEY = 'docgraphical-show-source';
function isShowSource() {
  try { const v = localStorage.getItem(SRC_VIS_KEY); return v === null ? false : v === '1'; }
  catch (e) { return false; }
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
  const ja = (typeof currentLanguage !== 'undefined' && currentLanguage === 'ja');
  if (!absPath) {
    showToast(zh ? '❌ 無目標路徑' : (ja ? '❌ 対象パスがありません' : '❌ No target path'));
    return;
  }
  const title = zh ? '📁 新增資料夾' : (ja ? '📁 新規フォルダ作成' : '📁 New Folder');
  const msg = zh ? `在目錄「${absPath}」下建立新資料夾：` : (ja ? `ディレクトリ「${absPath}」に新規フォルダを作成：` : `Create new folder under "${absPath}":`);
  const tip = zh ? '💡 請輸入資料夾名稱（不可包含特殊字元 \ / : * ? " < > |）' : (ja ? '💡 フォルダ名を入力してください（特殊文字は使用できません）' : '💡 Enter a valid folder name without special characters');
  const confirmText = zh ? '建立資料夾' : (ja ? 'フォルダ作成' : 'Create Folder');
  const cancelText = zh ? '取消' : (ja ? 'キャンセル' : 'Cancel');

  showCyberPrompt(title, msg, '', (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    fetch('/api/browse/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: absPath, name: trimmed })
    })
      .then(async r => {
        const text = await r.text();
        try {
          return { status: r.status, ok: r.ok, body: JSON.parse(text) };
        } catch (e) {
          throw new Error(`Server returned ${r.status}: ${text.slice(0, 150)}`);
        }
      })
      .then(({ status, ok, body }) => {
        if (ok && body && body.success) {
          showToast((zh ? '📁 已建立：' : (ja ? '📁 作成完了：' : '📁 Created: ')) + (body.path || trimmed));
          if (typeof loadProjects === 'function') loadProjects({ preserve: true });
        } else {
          showToast('❌ ' + ((body && body.error) || status));
        }
      })
      .catch(err => showToast('❌ ' + (err.message || err)));
  }, { placeholder: zh ? '例如：01_架構規範, 測試專案...' : 'e.g. 01_Architecture, Specs...', tip, confirmText, cancelText });
}

// Inline − on md rows: delete the md + its header-recorded sources + index.
// Always asks first (native confirm lists exactly what will go).
function treeDeleteDir(absPath, displayName) {
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const ja = (typeof currentLanguage !== 'undefined' && currentLanguage === 'ja');
  if (!absPath) {
    showToast(zh ? '❌ 無目錄路徑' : (ja ? '❌ ディレクトリパスがありません' : '❌ No directory path'));
    return;
  }
  const name = displayName || absPath.split('\\').pop() || absPath.split('/').pop() || absPath;
  const title = zh ? `⚠ 永久刪除資料夾「${name}」` : (ja ? `⚠ フォルダ「${name}」の完全削除` : `⚠ Delete Folder "${name}"`);
  const msg = zh
    ? `確定刪除資料夾「${name}」？\n\n⚠ 此動作將：\n1. 徹底刪除硬碟中的該資料夾與其所屬全部子檔案。\n2. 自動重新解析並同步移除知識圖譜索引！\n3. 此動作無法復原。`
    : (ja
      ? `フォルダ「${name}」を削除しますか？\n\n⚠ この操作により：\n1. フォルダ内の全サブファイルおよび文書が完全に削除されます。\n2. ナレッジグラフのインデックスが同期更新されます。\n3. 元に戻すことはできません。`
      : `Delete folder "${name}"?\n\n⚠ This action will:\n1. Permanently delete the folder and ALL nested files/documents inside.\n2. Automatically update and remove them from the graph index.\n3. This cannot be undone.`);

  const tip = zh ? '💡 警告：資料夾內之全部檔案都將被實體刪除！' : (ja ? '💡 警告：フォルダ内の全ファイルが完全に削除されます（復元不可）' : '💡 Warning: All nested files inside will be permanently erased!');
  const confirmText = zh ? '永久刪除資料夾' : (ja ? 'フォルダを完全に削除' : 'Delete Folder');
  const cancelText = zh ? '取消' : (ja ? 'キャンセル' : 'Cancel');

  showCyberConfirm(title, msg, () => {
    fetch('/api/browse/delete-dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: absPath })
    })
      .then(async r => {
        const text = await r.text();
        try {
          return { status: r.status, ok: r.ok, body: JSON.parse(text) };
        } catch (e) {
          throw new Error(`Server returned ${r.status}: ${text.slice(0, 150)}`);
        }
      })
      .then(({ status, ok, body }) => {
        if (ok && body && body.success) {
          showToast(zh ? `🗑 已刪除資料夾「${name}」` : (ja ? `🗑 フォルダ「${name}」を削除しました` : `🗑 Deleted folder "${name}"`));
          if (typeof loadProjects === 'function') loadProjects({ preserve: true });
        } else {
          showToast('❌ ' + ((body && body.error) || status));
        }
      })
      .catch(err => showToast('❌ ' + (err.message || err)));
  }, { confirmText, cancelText, tip });
}

function treeDeleteFile(absPath, displayName) {
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const ja = (typeof currentLanguage !== 'undefined' && currentLanguage === 'ja');
  if (!absPath) { showToast(zh ? '❌ 無目標路徑' : '❌ No target path'); return; }
  const name = displayName || absPath.split('\\').pop() || absPath;

  const title = zh ? `⚠ 永久刪除文件「${name}」` : (ja ? `⚠ ドキュメント「${name}」の完全削除` : `⚠ Delete Document "${name}"`);
  const msg = zh
    ? `確定刪除「${name}」？\n\n⚠ 此動作將：\n1. 刪除 md 本體檔案。\n2. 同步刪除 header 記載的來源附件檔案（PDF/PPTX等）。\n3. 自動清除知識圖譜索引！\n此動作無法復原。`
    : (ja
      ? `「${name}」を削除しますか？\n\n⚠ この操作により：\n1. mdファイル本体が削除されます。\n2. ヘッダー記載のソースファイルも削除されます。\n3. ナレッジグラフのインデックスが同期削除されます。\n元に戻すことはできません。`
      : `Delete "${name}"?\n\n⚠ This action will:\n1. Delete the md document.\n2. Remove associated header source files (PDF/PPTX etc).\n3. Wipe it from the graph index!\nThis cannot be undone.`);

  const tip = zh ? '💡 提示：本體與關聯來源檔案將一併清除。' : (ja ? '💡 ヒント：ドキュメントと添付元ファイルも削除されます。' : '💡 Note: The document and its source files will be deleted.');
  const confirmText = zh ? '永久刪除文件' : (ja ? 'ドキュメントを完全に削除' : 'Delete Document');
  const cancelText = zh ? '取消' : (ja ? 'キャンセル' : 'Cancel');

  showCyberConfirm(title, msg, () => {
    fetch('/api/ingest/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: absPath })
    })
      .then(async r => {
        const text = await r.text();
        try {
          return { status: r.status, ok: r.ok, body: JSON.parse(text) };
        } catch (e) {
          throw new Error(`Server returned ${r.status}: ${text.slice(0, 150)}`);
        }
      })
      .then(({ status, ok, body }) => {
        if (ok && body && body.success) {
          const n = (body.deleted || []).length;
          const miss = (body.missing || []).length;
          showToast((zh ? `🗑 已刪除 ${n} 個檔案` : `🗑 Deleted ${n} file(s)`)
            + (miss ? (zh ? `（${miss} 個找不到，略過）` : ` (${miss} missing, skipped)`) : ''));
          if (typeof loadProjects === 'function') loadProjects({ preserve: true });
        } else {
          showToast('❌ ' + ((body && body.error) || status));
        }
      })
      .catch(err => showToast('❌ ' + (err.message || err)));
  }, { confirmText, cancelText, tip });
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

    // Folder badge (recursive file count) + inline ＋ (New document) + inline − (Delete folder).
    const vDirZh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
    const vDirJa = (typeof currentLanguage !== 'undefined' && currentLanguage === 'ja');
    const vDirCount = countDirFiles(subDir);
    const vDirAbs = resolveTreeAbsPath(projName, cleanSubPath);
    const vDirEsc = (vDirAbs || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const vDNameEsc = (dName || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    dirNodeEl.innerHTML = `
      <span class="tree-arrow ${isDirOpen ? 'open' : ''}">▸</span>
      <span title="${escapeHtml(dName)}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:#e6edf3;">📁 ${escapeHtml(dName)}</span>
      <button class="mini-btn txbtn" style="margin-left:auto; width:22px; height:20px; padding:0; font-size:13px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;" title="${vDirZh ? `在此資料夾新增文件…（${escapeHtml(vDirAbs)}）` : (vDirJa ? `このフォルダに新規ドキュメント…（${escapeHtml(vDirAbs)}）` : `New document here… (${escapeHtml(vDirAbs)})`)}" onclick="event.stopPropagation();treeNewDocument('${vDirEsc}')">＋</button>
      <button class="mini-btn txbtn" style="margin-left:4px; width:22px; height:20px; padding:0; font-size:13px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; border-color:#5a2d2d; color:#f85149;" title="${vDirZh ? `刪除資料夾「${escapeHtml(dName)}」（包含全部子文件與索引，需確認）` : (vDirJa ? `フォルダ「${escapeHtml(dName)}」を削除（全サブファイルとインデックス含む、要確認）` : `Delete folder "${escapeHtml(dName)}" (all files + index, asks first)`)}" onclick="event.stopPropagation();treeDeleteDir('${vDirEsc}', '${vDNameEsc}')">−</button>
      ${vDirCount > 0 ? `<span class="node-kind-tag txbadge" style="margin-left:6px;">${vDirCount} md</span>` : ''}
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
      ${getDocIconSvg(bUnindexed ? '#d29922' : (KIND_COLORS.file || '#f0883e'))}
      <span title="${escapeHtml(fName)}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${bUnindexed ? '#d29922' : '#c9d1d9'};">${escapeHtml(fName)}</span>
      ${vIsMd ? `<button class="mini-btn txbtn" style="width:22px; height:20px; padding:0; font-size:13px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; border-color:#5a2d2d; color:#f85149;" title="${bUzh ? `刪除「${escapeHtml(fName)}」（md＋來源檔＋索引，需確認）` : `Delete "${escapeHtml(fName)}" (md + sources + index, asks first)`}" onclick="event.stopPropagation();treeDeleteFile('${vFileEsc}', '${vNameEsc}')">−</button>` : ''}
      ${bUnindexed
        ? `<button class="node-kind-tag txbadge" style="flex-shrink:0;margin-left:6px;background:#3a2e12;color:#d29922;border:1px solid #9e6a03;cursor:pointer;padding:2px 8px;border-radius:4px;font-size:13px;font-weight:600;" title="${bUzh ? '點擊立即將此檔案納入索引' : 'Click to index this file now'}" onclick="event.stopPropagation();promptToIndexFile('${escapeHtml(projName)}', '${vNameEsc}')">${bUzh ? '⏳ 待索引' : '⏳ unindexed'}</button>`
        : ''}
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
      dispatchUnifiedSelection(fileNode);
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

    // 3a. Header-recorded sources: Unfolded, perfectly aligned with MD (same hierarchy level).
    // Single-click selects node, Double-click opens file!
    const vSrcList = fileData.sources || [];
    if (vSrcList.length) {
      const vPe = (allProjectsList || []).find(p => p.name === projName);
      const vRepoPath = (vPe && vPe.path) || '';
      vSrcList.forEach(srcRel => {
        const sName = (srcRel || '').split('/').pop() || srcRel;
        const sExt = (sName.split('.').pop() || '').toUpperCase();
        const sUrl = vRepoPath ? `/api/ingest/source?repo=${encodeURIComponent(vRepoPath)}&file=${encodeURIComponent(srcRel)}` : '';
        const sEl = document.createElement('div');
        sEl.className = 'tree-node';
        sEl.setAttribute('data-tree-src', '1');
        sEl.setAttribute('data-tree-proj', projName);
        sEl.setAttribute('data-tree-file-path', srcRel);
        sEl.setAttribute('title', `${sName}\n• 單擊：選取檔案\n• 雙擊：開啟原始檔案`);

        sEl.innerHTML = `
          <span class="tree-arrow" style="visibility:hidden;width:12px;margin-right:2px;">•</span>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8b949e;display:flex;align-items:center;gap:4px;">
            <span style="font-size:12px;">📎</span>
            <span style="color:#c9d1d9;">${escapeHtml(sName)}</span>
          </span>
          <span class="node-kind-tag txbadge" style="flex-shrink:0;margin-left:6px;background:rgba(56, 139, 253, 0.1);color:#58a6ff;border:1px solid rgba(56, 139, 253, 0.3);font-size:9px;font-weight:600;padding:0 5px;">${escapeHtml(sExt) || 'SRC'}</span>
        `;

        // 1. Single click: select only (no auto opening)
        sEl.onclick = (e) => {
          e.stopPropagation();
          selectTreeNode(sEl);
        };

        // 2. Double click: open file
        sEl.ondblclick = (e) => {
          e.stopPropagation();
          if (sUrl) {
            window.open(sUrl, '_blank', 'noopener');
          } else {
            showToast(currentLanguage === 'zh' ? '找不到來源檔案路徑' : 'Source file path not found');
          }
        };

        parentEl.appendChild(sEl);
      });
    }
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
      <span style="color:${KIND_COLORS[h.kind] || '#58a6ff'}; margin-right:4px; font-weight:700; font-size:13px;">${'#'.repeat(h.level || 1)}</span>
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
      dispatchUnifiedSelection(h);
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

  // 1b. Heading node match by name within file container
  if (!targetEl && node.kind && node.kind.startsWith('heading') && node.file) {
    const cleanF = (node.file || '').replace(/\\/g, '/').toLowerCase();
    const fileContainer = document.querySelector(`#tree-container [data-tree-file-path="${cleanF}"]`);
    const parentChildren = fileContainer ? fileContainer.nextElementSibling : document.getElementById('tree-container');
    if (parentChildren) {
      const headingEls = parentChildren.querySelectorAll('.tree-node');
      for (const el of headingEls) {
        const text = (el.innerText || '').trim().toLowerCase();
        if (text.includes(node.name.toLowerCase())) {
          targetEl = el;
          break;
        }
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
  if (typeof syncScanScopeIfOpen === 'function') syncScanScopeIfOpen();
}

// ─── 5. Center Doc Stage & Right Links Updates ────────────────────
// md viewer context: owning project/repo + header source rels
// (drives source-file links + the viewer right-click menu).
let viewCtx = { project: '', file: '', repo: '', sources: [] };
function selectActiveNode(node, bSkipDelegates = false) {
  if (!node) return;
  activeNode = node;
  if (!bSkipDelegates) {
    syncExplorerSelection(node);
  }

  const dName = document.getElementById('d-name');
  const dSub = document.getElementById('d-sub');
   if (dName) dName.innerText = stripMdLinks(node.name) || 'Unnamed';
  if (dSub) dSub.innerText = `${node.file || ''} · Line ${node.line || 1}`;

  const badge = document.getElementById('d-kind-badge');
  if (badge) {
    badge.innerText = (node.kind || 'NODE').toUpperCase();
    badge.style.background = KIND_COLORS[node.kind] || '#1f6feb';
    badge.style.color = '#ffffff';
    badge.style.fontWeight = '700';
    badge.style.textShadow = '0 1px 2px rgba(0,0,0,0.7)';
  }

  const codeTitle = document.getElementById('d-code-title');
  if (codeTitle) {
    const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
    const ja = (typeof currentLanguage !== 'undefined' && currentLanguage === 'ja');
    if (node.kind === 'file') {
      codeTitle.innerText = zh ? '📄 完整文件 Markdown' : (ja ? '📄 全文 Markdown' : '📄 Full Document Markdown');
    } else {
      codeTitle.innerText = zh ? '🗡️ 切片章節 Markdown' : (ja ? '🗡️ 抽出セクション Markdown' : '🗡️ Sliced Section Markdown');
    }
  }

  // Fetch Section / Full Content for Center Markdown Viewer
  const queryFile = node.abs_path || node.file || '';
  // Viewer context: owning project/repo (for source-file links + ctx menu).
  viewCtx = { project: '', file: (node.file || '').replace(/\\/g, '/'), repo: '', sources: [], heading: (node.kind === 'file' ? '' : (node.name || '')) };
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

  // Update Right Column Lower Pane via decoupled handler
  renderConnectedRelationsPanel(node);
  // Browser-history record (skipped during navGo restores via navLock).
  try {
    if (node && typeof navRecord === 'function') navRecord({
      view: 'node', id: node.id || ((node.file || '') + '::L' + (node.line || 1)),
      node: { id: node.id, name: node.name, file: node.file,
              abs_path: node.abs_path, kind: node.kind, line: node.line }
    });
  } catch (e) {}
}


// Jump to any node by id (exact, then namespace-suffix). Used by the
// relations panel rows — one shared hop for explorer + 3D + viewer.
function jumpToNodeById(encId) {
  let id = '';
  try { id = decodeURIComponent(encId || ''); } catch (e) { id = encId || ''; }
  if (!id) return;
  try {
    const g = (typeof rawData !== 'undefined' && rawData && rawData.nodes) ? rawData.nodes : [];
    const nd = g.find(n => n && (n.id === id || (typeof n.id === 'string' && n.id.endsWith('::' + id))));
    if (nd) {
      if (typeof dispatchUnifiedSelection === 'function') {
        dispatchUnifiedSelection(nd);
      } else if (typeof selectActiveNode === 'function') {
        selectActiveNode(nd);
      }
    } else if (typeof dispatchUnifiedSelection === 'function') {
      dispatchUnifiedSelection(id);
    } else if (typeof showToast === 'function') {
      showToast('❌ 節點不在圖上');
    }
  } catch (e) {
    console.error('jumpToNodeById error:', e);
  }
}
// Connected Links hub: every edge touching the selected node, rendered
// with the ONE shared plate. Rows click through to the neighbor.
function renderConnectedRelationsPanel(node) {
  const box = document.getElementById('d-relations');
  const cnt = document.getElementById('d-rel-count');
  const empty = '<div style="font-size:13px; color:#8b949e; padding:8px;">Select a node to view relationships</div>';
  if (!box) return;
  const nid = node && node.id;
  let links = [];
  try {
    links = ((typeof rawData !== 'undefined' && rawData && rawData.links) ? rawData.links : [])
      .filter(l => l && ((typeof l.source === 'object' ? l.source.id : l.source) === nid
        || (typeof l.target === 'object' ? l.target.id : l.target) === nid));
  } catch (e) { links = []; }
  if (!nid || !links.length) {
    if (cnt) cnt.textContent = '0';
    box.innerHTML = empty;
    return;
  }
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (x => String(x));
  const nodes = (typeof rawData !== 'undefined' && rawData && rawData.nodes) ? rawData.nodes : [];
  const seen = new Set();
  let h = '';
  let shown = 0;
  for (const l of links) {
    if (shown >= 60) break;
    const sId = typeof l.source === 'object' ? l.source.id : l.source;
    const tId = typeof l.target === 'object' ? l.target.id : l.target;
    const other = (sId === nid) ? tId : sId;
    if (!other || other === nid || seen.has(other)) continue;
    seen.add(other);
    const nd = nodes.find(n => n && n.id === other) || null;
    const kind = (nd && nd.kind) || (String(other).startsWith('heading::') ? 'heading_2' : (String(other).startsWith('file::') ? 'file' : 'concept'));
    const title = nd ? (nd.name || other) : String(other).split('::').pop();
    const file = nd ? (nd.file || '') : '';
    const line = nd ? (nd.line || 1) : 1;
    const enc = encodeURIComponent(other).replace(/'/g, '%27');
    // Relation marker at the START (pill with direction arrow, never a
    // raw bottom line): parent=above ↑, child=below ↓, cross-doc=sideways →.
    // parent_child resolves by edge direction (source=parent).
    const lk = String((l && l.kind) || 'link');
    let arrw = '→', blbl = (lk || 'link').slice(0, 8);
    if (lk === 'parent_child') {
      if (sId === nid) { arrw = '↓'; blbl = 'child'; } else { arrw = '↑'; blbl = 'parent'; }
    } else if (lk === 'doc_link') { arrw = '→'; blbl = 'doc'; }
    else if (lk === 'wiki_link') { arrw = '→'; blbl = 'wiki'; }
    else if (lk === 'contains') { arrw = '↓'; blbl = 'has'; }
    const cleanFile = String(file || (nd && nd.file) || '').replace(/^p\d+::/, '').replace(/^file::/, '');
    const proj = (nd && nd.project) || '';
    const cleanTitle = stripMdLinks(title || (nd && nd.name) || cleanFile.split(/[\\/]/).pop() || '');
    let hoverTooltip = proj ? `[${proj}] ` : '';
    if (cleanFile && cleanFile !== cleanTitle) {
      hoverTooltip += `${cleanTitle} (${cleanFile})`;
    } else {
      hoverTooltip += (cleanFile || cleanTitle);
    }
    h += `<div style="border:1px solid #21262d;border-radius:8px;padding:6px 8px;margin-bottom:6px;cursor:pointer;" onclick="jumpToNodeById('${enc}')" title="${esc(hoverTooltip)}">`
      + `<div style="display:flex;align-items:flex-start;gap:6px;">`
      + `<span title="${esc(lk)}" style="flex-shrink:0;font-size:15px;font-weight:500;color:#e6edf3;border:1px solid #30363d;border-radius:10px;padding:1px 7px;margin-top:1px;white-space:nowrap;">${arrw} ${esc(blbl)}</span>`
      + `<div style="flex:1;min-width:0;font-size:12px;">${nodePlateHtml({ title, kind, file, line, project: proj, clickable: false })}</div>`
      + `</div></div>`;
    shown++;
  }
  if (cnt) cnt.textContent = String(seen.size);
  box.innerHTML = h || empty;
  if (links.length > shown) box.innerHTML += `<div style="font-size:13px;color:#8b949e;">+${links.length - shown} more</div>`;
}


// ─── Document Tags Visual Engine (Dedicated Top Bar & Inline Badges) ─
function updateDocTagsBar(mdText, filePath) {
  const bar = document.getElementById('doc-tags-pill-bar');
  const list = document.getElementById('doc-tags-pill-list');
  if (!bar || !list) return;

  // Extract all unique concepts in this document [[...]] and [...](.../tags/Concept.md)
  const concepts = new Set();
  const pat = /\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g;
  let match;
  while ((match = pat.exec(mdText || '')) !== null) {
    const cName = (match[1] || '').trim();
    if (cName && cName.length <= 60 && !cName.toLowerCase().endsWith('.md')) {
      concepts.add(cName);
    }
  }

  // Also extract markdown links pointing to .docgraphical/tags/<Concept>.md
  const tagLinkPat = /\[([^\]\n]+)\]\(([^)\n]*\.docgraphical\/tags\/([^)\n]+)\.md[^)\n]*)\)/g;
  let tlMatch;
  while ((tlMatch = tagLinkPat.exec(mdText || '')) !== null) {
    let cName = (tlMatch[3] || '').trim();
    try { cName = decodeURIComponent(cName); } catch (e) {}
    if (cName && cName.length <= 60) {
      concepts.add(cName);
    }
  }

  if (concepts.size === 0) {
    bar.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  bar.style.display = 'flex';
  list.innerHTML = '';

  concepts.forEach(cName => {
    const pill = document.createElement('div');
    pill.style.cssText = 'display:inline-flex; align-items:center; gap:4px; background:#1f6feb22; border:1px solid #388bfd66; border-radius:12px; padding:2px 8px; font-size:13px; color:#58a6ff; font-weight:600; cursor:pointer; transition:all 0.15s ease;';
    pill.onmouseover = () => { pill.style.background = '#1f6feb44'; pill.style.borderColor = '#58a6ff'; };
    pill.onmouseout = () => { pill.style.background = '#1f6feb22'; pill.style.borderColor = '#388bfd66'; };

    const txt = document.createElement('span');
    txt.innerText = `🏷️ ${cName}`;
    txt.onclick = () => {
      onConceptCardClick(cName);
    };

    const del = document.createElement('span');
    del.innerText = '✕';
    del.style.cssText = 'color:#f85149; margin-left:4px; font-size:13px; padding:0 2px; cursor:pointer;';
    del.title = '解除此標籤關聯 (Unlink)';
    del.onclick = (e) => {
      unlinkConcept(cName, filePath, e);
    };

    pill.appendChild(txt);
    pill.appendChild(del);
    list.appendChild(pill);
  });
}

function renderMarkdown(mdText, extraSources) {
  const container = document.getElementById('d-code-markdown');
  if (!container) return;

  const curFile = (viewCtx && viewCtx.file) ? viewCtx.file : (activeNode ? (activeNode.file || activeNode.abs_path || '') : '');
  updateDocTagsBar(mdText, curFile);

  // Convert [[Concept]] into clickable interactive inline links (clean blue underline, no tag icon)
  let processedMd = mdText || '';
  const zhLang = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const openConceptPrefix = zhLang ? '開啟概念頁：' : 'Open concept page: ';
  processedMd = processedMd.replace(/\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g, (m, cName, alias) => {
    const rawTarget = cName.trim();
    const displayName = alias ? alias.trim() : rawTarget;
    if (rawTarget.toLowerCase().endsWith('.md')) return m; // keep standard doc links
    return `<a class="concept-inline-link" title="${openConceptPrefix}${escapeHtml(rawTarget)}" style="color:#58a6ff; text-decoration:underline; text-underline-offset:3px; cursor:pointer; font-weight:500;" onclick="onConceptCardClick('${escapeHtml(rawTarget)}', event)">${escapeHtml(displayName)}</a>`;
  });
  // Ingest-md header sources: `> - `rel`` lines — remembered for linkify + menu.
  // extraSources (server-provided, from the FULL file) keeps source links
  // working in section-slice views, whose text has no header block.
  viewCtx.sources = [];
  ((mdText || '').match(/^> - `(.+)`$/gm) || []).forEach(l => {
    const r = l.replace(/^> - `|`$/g, '');
    if (r && viewCtx.sources.indexOf(r) < 0) viewCtx.sources.push(r);
  });
  (Array.isArray(extraSources) ? extraSources : []).forEach(r => {
    if (r && viewCtx.sources.indexOf(r) < 0) viewCtx.sources.push(r);
  });
  if (window.marked) {
    container.innerHTML = marked.parse(processedMd || '');
    container.querySelectorAll('pre code').forEach((block) => {
      if (window.hljs) hljs.highlightElement(block);
    });
    linkifySources(container);
    linkifyConceptLinks(container);
    bindMarkdownInternalLinks(container);
    resolveMarkdownImages(container, curFile);
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
  linkifyConceptLinks(container);
}
// Physical tag links [Name](../.docgraphical/tags/Name.md): intercept
// clicks into the in-app tag page instead of navigating away.
// Standalone from linkifySources (which early-returns without header
function linkifyConceptLinks(container) {
  if (!container) return;
  container.querySelectorAll('a[href*="tags/"]').forEach((a) => {
    a.classList.add('concept-link');
    // Check if link is located inside a blockquote (the `> 🏷️ 標籤：` container)
    const isInTagLine = !!a.closest('blockquote');
    if (isInTagLine) {
      a.classList.add('inline-concept-badge');
      a.style.cssText = 'display:inline-flex; align-items:center; background:#1f6feb22; border:1px solid #388bfd55; color:#58a6ff; font-weight:600; padding:1px 6px; border-radius:4px; cursor:pointer; font-size:13px; text-decoration:none; margin:0 2px;';
      if (!a.querySelector('.tag-icon-span')) {
        const icon = document.createElement('span');
        icon.className = 'tag-icon-span';
        icon.innerText = '🏷️ ';
        a.prepend(icon);
      }
    } else {
      // Normal inline document link: clean blue text with subtle underline, no badge, no icon
      a.style.cssText = 'color:#58a6ff; text-decoration:underline; text-underline-offset:3px; cursor:pointer; font-weight:500; margin:0 1px;';
      const existingIcon = a.querySelector('.tag-icon-span');
      if (existingIcon) existingIcon.remove();
    }
    // Resolve the real target concept name from the URL (e.g. .docgraphical/tags/越南建廠專案.md -> 越南建廠專案)
    const href = a.getAttribute('href') || '';
    const base = href.split('/').pop().split('#')[0].split('?')[0];
    let canonicalTarget = '';
    try { canonicalTarget = decodeURIComponent(base); } catch (e) { canonicalTarget = base; }
    if (canonicalTarget.toLowerCase().endsWith('.md')) canonicalTarget = canonicalTarget.slice(0, -3);
    canonicalTarget = (canonicalTarget || '').trim();

    const zh2 = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
    const targetLabel = canonicalTarget || (a.textContent || '').trim();
    a.title = (zh2 ? '開啟概念頁：' : 'Open concept page: ') + targetLabel;
  });
  if (!container.dataset.taglinkBound) {
    container.dataset.taglinkBound = '1';
    container.addEventListener('click', (ev) => {
      const a = ev.target && ev.target.closest ? ev.target.closest('a.concept-link') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      const base = href.split('/').pop().split('#')[0].split('?')[0];
      let name = '';
      try { name = decodeURIComponent(base); } catch (e) { name = base; }
      if (name.toLowerCase().endsWith('.md')) name = name.slice(0, -3);
      name = (name || '').trim();
      if (!name) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof onConceptCardClick === 'function') onConceptCardClick(name, null);
    });
  }
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
  const lang = (typeof currentLanguage !== 'undefined') ? currentLanguage : 'en';
  const zh = lang === 'zh', ja = lang === 'ja';
  const sel = (window.getSelection ? window.getSelection().toString() : '').trim();
  const items = [];
  if (sel) {
    const lblSel = zh ? '📋 複製選取文字' : (ja ? '📋 選択テキストをコピー' : '📋 Copy selection');
    const toastSel = zh ? '📋 已複製選取文字' : (ja ? '📋 選択テキストをコピーしました' : '📋 Selection copied');
    items.push({ label: lblSel, fn: () => copyTextToClipboard(sel, toastSel) });
  }
  items.push({ label: zh ? '📄 複製本節 Markdown' : (ja ? '📄 この見出しのMarkdownをコピー' : '📄 Copy section markdown'), fn: () => copyCurrentSection() });
  items.push({ label: zh ? '🤖 複製給 Agent' : (ja ? '🤖 AIエージェント用にコピー' : '🤖 Copy for Agent'), fn: () => copyMcpPayload() });
  (viewCtx.sources || []).slice(0, 5).forEach(rel => {
    const base = rel.split('/').pop();
    const url = viewSourceUrl(rel);
    if (!url) return;
    const prefix = zh ? '📂 開啟來源檔案：' : (ja ? '📂 ソースファイルを開く: ' : '📂 Open source: ');
    items.push({ label: prefix + base, fn: () => window.open(url, '_blank', 'noopener') });
  });
  if (viewCtx.sources.length) {
    items.push({ label: zh ? '📁 複製來源絕對路徑' : (ja ? '📁 ソースの絶対パスをコピー' : '📁 Copy source absolute path'), fn: () => {
      const abs = viewCtx.sources.map(r => `${viewCtx.repo}\\${r.replace(/\//g, '\\')}`).join('\n');
      copyTextToClipboard(abs, zh ? '📁 已複製來源路徑' : (ja ? '📁 ソースパスをコピーしました' : '📁 Source path copied'));
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

  // A deliberate LOD change supersedes any temporary unhide from a selection
  userLODHiddenSnapshot = null;

  applyLODAndFilter();
  updateLegendUI();
}

function applyLODAndFilter(reframe = true) {
  const activeNodes = (rawData.nodes || []).filter(n => {
    if (n.kind === 'concept') {
      // 1. If a specific concept is spotlighted/selected, ONLY that exact concept tag is visible!
      if (activeSpotlightConcept) {
        return (n.name === activeSpotlightConcept) || (n.id === `concept::${activeSpotlightConcept}`) || n.id.endsWith(`::concept::${activeSpotlightConcept}`);
      }
      // 2. If a document or heading node is active/highlighted, show concepts linked to this document!
      if (activeNode) {
        const activeDocPath = (activeNode.file || activeNode.name || '').replace(/\\/g, '/');
        const hasDirectLink = (rawData.links || []).some(l => {
          if (l.kind !== 'wiki_link') return false;
          const sId = typeof l.source === 'object' ? l.source.id : l.source;
          const tId = typeof l.target === 'object' ? l.target.id : l.target;
          const isThisConcept = (tId === n.id || sId === n.id);
          const isThisDoc = sId.includes(activeDocPath) || tId.includes(activeDocPath) || (activeNode.id && (sId === activeNode.id || tId === activeNode.id));
          return isThisConcept && isThisDoc;
        });
        if (hasDirectLink) return true;
      }
      return false; // Keep unrelated concept tags hidden to prevent visual clutter
    }
    // LOD-hidden kinds are skipped — unless temporarily revealed by drill-down
    // (tempRevealIds is selection-scoped and never touches hiddenKinds/legend)
    if (hiddenKinds.has(n.kind) && !tempRevealIds.has(n.id)) return false;
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
    if (reframe) {
      setTimeout(() => {
        autoFrameGraph();
      }, 250);
    }
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
  
  const lang = currentLanguage;
  const zh = lang === 'zh';
  const ja = lang === 'ja';

  const KIND_LABELS = {
    concept: zh ? '概念標籤' : (ja ? '概念タグ' : 'Concept'),
    file: zh ? '文件' : (ja ? 'ドキュメント' : 'Document'),
    heading_1: zh ? 'H1 大標題' : (ja ? 'H1 大見出し' : 'H1 Section'),
    heading_2: zh ? 'H2 次標題' : (ja ? 'H2 中見出し' : 'H2 Section'),
    heading_3: zh ? 'H3 子章節' : (ja ? 'H3 小見出し' : 'H3 Subsection'),
    heading_4: zh ? 'H4 細部條目' : (ja ? 'H4 詳細見出し' : 'H4 Detail'),
  };

  const kinds = [
    { kind: 'concept', label: KIND_LABELS.concept },
    { kind: 'file', label: KIND_LABELS.file },
    { kind: 'heading_1', label: KIND_LABELS.heading_1 },
    { kind: 'heading_2', label: KIND_LABELS.heading_2 },
    { kind: 'heading_3', label: KIND_LABELS.heading_3 },
    { kind: 'heading_4', label: KIND_LABELS.heading_4 },
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

  const EDGE_LABELS = {
    parent_child: zh ? 'AST 階層包含' : (ja ? 'AST階層包含' : 'AST Contains'),
    doc_link: zh ? '跨文件引用' : (ja ? '文書間リンク' : 'Cross-Doc Reference')
  };

  const edgeKinds = [
    { kind: 'parent_child', label: EDGE_LABELS.parent_child },
    { kind: 'doc_link', label: EDGE_LABELS.doc_link }
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
  } else if (currentLanguage === 'ja') {
    if (isSwapped) {
      lbl.textContent = '右へ戻す';
      btn.title = '右側パネルへ戻す';
    } else {
      lbl.textContent = '左右切替';
      btn.title = 'Markdownリーダーと配置を入れ替え';
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
  updateActivityBarI18n();

  if (!isSwapped) {
    showToast(currentLanguage === 'zh' ? '3D 圖已置中，Markdown 移至右側' : (currentLanguage === 'ja' ? '3Dグラフを中央に配置、Markdownを右側へ移動' : '3D Graph centered, Markdown in right panel'));
  } else {
    showToast(currentLanguage === 'zh' ? '已恢復標準版面配置' : (currentLanguage === 'ja' ? '標準レイアウトに戻しました' : 'Standard layout restored'));
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
  // Resizer 1: Tree vs Doc — drags the OUTER drawer (post activity-bar
  // layout). Dragging the inner panel splits it from the drawer and leaves
  // a dead gap, so the inner panel is reset to follow the drawer width.
  const resizerTreeDoc = document.getElementById('resizer-tree-doc');
  const drawer = document.getElementById('left-sidebar-drawer');
  const treePanel = document.getElementById('tree-panel');
  if (treePanel && treePanel.style.width) treePanel.style.width = '';
  if (resizerTreeDoc && drawer) {
    let isDragging = false;
    resizerTreeDoc.addEventListener('mousedown', (e) => {
      isDragging = true;
      resizerTreeDoc.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const newWidth = Math.max(240, Math.min(700, e.clientX));
      drawer.style.width = `${newWidth}px`;
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

  const lang = currentLanguage;
  const zh = lang === 'zh', ja = lang === 'ja';
  const T = {
    indexed: zh ? '已索引' : (ja ? 'インデックス済' : 'Indexed'),
    unindexed: zh ? '未索引' : (ja ? '未インデックス' : 'Unindexed'),
    pendingTip: zh ? '尚未索引的檔案：' : (ja ? '未インデックスのファイル: ' : 'Files not yet indexed: '),
    sync: zh ? '增量同步' : (ja ? '増分同期' : 'Incremental Sync'),
    syncPending: (n) => zh ? `同步（${n} 待索引）` : (ja ? `同期（未処理 ${n} 件）` : `Sync (${n} pending)`),
    rebuild: zh ? '完整重建' : (ja ? '完全再構築' : 'Full Rebuild'),
    uninit: zh ? '移除索引' : (ja ? 'インデックス削除' : 'Uninit'),
    create: zh ? '建立索引' : (ja ? 'インデックス作成' : 'Create Index'),
    exclude: zh ? '排除' : (ja ? '除外' : 'Exclude'),
    pendingTag: (n) => zh ? `${n} 待索引` : (ja ? `${n} 件未処理` : `${n} pending`),
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
          <button class="act-btn" style="color:#d29922; border-color:#9e6a03;" onclick="uninitRepo('${escapedPath}', this)">${T.uninit}</button>
          <button class="act-btn danger" onclick="excludeRepo('${escapedPath}', '${(p.name||'').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')" title="${zh ? '從專案清單移除此專案（非實體刪除硬碟檔案）' : 'Remove repository from project list (does not delete disk files)'}">✕ ${T.exclude}</button>
        </div>
      `;
    } else {
      actionsHtml = `
        <div class="action-btn-group">
          <button class="act-btn green" onclick="initRepo('${escapedPath}', this)">${T.create}</button>
          <button class="act-btn danger" onclick="excludeRepo('${escapedPath}', '${(p.name||'').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')" title="${zh ? '從專案清單移除此專案（非實體刪除硬碟檔案）' : 'Remove repository from project list (does not delete disk files)'}">✕ ${T.exclude}</button>
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
      <td style="font-family:monospace; font-size:13px; color:#8b949e;" title="${escapeHtml(p.path)}">${escapeHtml(p.path)}</td>
      <td style="font-family:monospace; font-size:13px; color:#c9d1d9;">${metricsText}</td>
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
      setBusy(btn, false);
    } else {
      setBusy(btn, false);
      alert('Sync failed: ' + res.error);
    }
  })
  .catch(err => { setBusy(btn, false); alert('Sync error: ' + err); });
}

function promptToIndexFile(projName, fileName) {
  const proj = (allProjectsList || []).find(p => p.name === projName);
  const repoPath = proj ? proj.path : '';
  const lang = currentLanguage;
  const zh = lang === 'zh';
  const ja = lang === 'ja';

  const title = zh ? '⚡ 將檔案納入索引' : (ja ? '⚡ ファイルをインデックスに追加' : '⚡ Include File in Index');
  const msg = zh
    ? `即將對「${projName}」專案執行增量同步，將「${fileName}」及所有未索引文檔正式納入知識庫圖譜。`
    : (ja
      ? `「${projName}」の未処理ファイル「${fileName}」をインデックスに追加してナレッジグラフに同期します。`
      : `Perform incremental sync for "${projName}" to incorporate "${fileName}" into the knowledge graph.`);

  const tip = zh ? '💡 增量同步只需數毫秒，現有概念與筆記完全保留。' : (ja ? '💡 増分同期はミリ秒単位で完了し、既存データは安全に保持されます。' : '💡 Incremental sync takes milliseconds and preserves all data.');

  showCyberConfirm(title, msg, () => {
    showToast(zh ? '⏳ 正在增量解析並更新圖譜…' : (ja ? '⏳ インデックス更新中…' : '⏳ Indexing and updating graph…'));
    const url = repoPath ? '/api/sync' : '/api/sync_all';
    const opts = repoPath
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: repoPath }) }
      : { method: 'POST' };

    fetch(url, opts)
      .then(r => r.json())
      .then(res => {
        if (res.success) {
          showToast(zh ? `✅ 已成功納入索引！` : (ja ? `✅ インデックス完了！` : `✅ Successfully indexed!`));
          loadProjects();
          if (typeof updateLintBadgeOnly === 'function') updateLintBadgeOnly();
          if (typeof fetchConceptsData === 'function') fetchConceptsData();
        } else {
          showToast('❌ 索引失敗: ' + (res.error || 'unknown'));
        }
      })
      .catch(err => showToast('❌ 網路連線錯誤: ' + err.message));
  }, {
    tip: tip,
    titleColor: '#58a6ff',
    confirmText: zh ? '立即納入索引' : (ja ? 'インデックス実行' : 'Index Now'),
    cancelText: zh ? '取消' : (ja ? 'キャンセル' : 'Cancel'),
    btnBg: '#238636',
    btnBorder: '#2ea043'
  });
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
      setBusy(btn, false);
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
      setBusy(btn, false);
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
      setBusy(btn, false);
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
  const items = files.map(f => `<div style="font-family:monospace; font-size:13px; color:#c9d1d9; padding:1px 0;">📄 ${escapeHtml(f)}</div>`).join('');
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
  const lang = currentLanguage;
  const zh = lang === 'zh', ja = lang === 'ja';
  if (!indexed.length) {
    showToast(zh ? '沒有已索引的 repo 可同步' : (ja ? '同期対象のインデックス済リポジトリがありません' : 'No indexed repositories to sync'));
    return;
  }
  setBusy(btn, true, zh ? '⏳ 全域同步中…' : (ja ? '⏳ 一括同期中…' : '⏳ Syncing all…'));
  showToast(zh ? `⏳ 正在同步 ${indexed.length} 個已索引 repo…` : (ja ? `⏳ ${indexed.length} 件のリポジトリを同期中…` : `⏳ Syncing ${indexed.length} indexed repos…`));
  fetch('/api/sync_all', { method: 'POST' })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      const t = res.totals || {};
      showToast(currentLanguage === 'zh'
        ? `⚡ 全域同步完成：${res.synced} 個 repo，解析 ${t.parsed || 0}，跳過 ${t.skipped || 0}，移除 ${t.removed || 0}`
        : `⚡ Synced ${res.synced} repos: ${t.parsed || 0} parsed, ${t.skipped || 0} skipped, ${t.removed || 0} removed`);
      loadProjects();
      setBusy(btn, false);
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
function ingCurEntry() {
  const st = ingState;
  return (st && st.picked && st.sel >= 0 && st.picked[st.sel]) ? st.picked[st.sel] : null;
}
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
  return () => {
    clearInterval(timer);
    lock(false);
    if (m) { m.innerHTML = ''; m.style.color = ''; }
  };
}
function openIngestDialog(absDir) {
  const lang = currentLanguage;
  const zh = lang === 'zh', ja = lang === 'ja';
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
  if (!repoPath) { showToast(zh ? '❌ 找不到所屬 repo' : (ja ? '❌ 対象のリポジトリが見つかりません' : '❌ Owning repo not found')); return; }
  // Per-file batch state: each picked item carries its own staged path / url / text / images,
  // status and summary.
  ingState = {
    dir: absDir,
    repo: repoPath,
    proj: projName,
    picked: [],
    sel: -1,
    zh,
    ja,
    activeTab: 'files',
    clipboardImages: []
  };

  const o = document.createElement('div');
  o.id = 'ing-overlay';
  o.style.cssText = 'position:fixed;inset:0;z-index:1000002;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
  const dlgTitle = zh ? '📥 新增文件 — LLM 摘要入庫' : (ja ? '📥 ドキュメント追加 — LLM要約・取り込み' : '📥 New document — LLM summary ingest');
  const targetLabel = zh ? '目標目錄：' : (ja ? '保存先ディレクトリ: ' : 'Target: ');
  const step1Title = zh ? '① 來源素材' : (ja ? '① 素材ソース' : '① Source Material');
  const sumBtnText = zh ? '✨ 整批生成摘要' : (ja ? '✨ 一括要約を生成' : '✨ Summarize all');
  const step2Title = zh ? '② LLM 摘要預覽與設定' : (ja ? '② LLM要約プレビューと設定' : '② LLM summary & settings');
  const tabPrev = zh ? '預覽' : (ja ? 'プレビュー' : 'Preview');
  const tabEdit = zh ? '編輯' : (ja ? '編集' : 'Edit');
  const editHint = zh ? '存檔前可自由修改摘要內文' : (ja ? '保存前に要約内容を調整できます' : 'review & edit before saving');
  const emptyPrev = zh ? '（摘要會顯示在這裡）' : (ja ? '（要約結果がここに表示されます）' : '(summary appears here)');
  const saveBtnText = zh ? '✅ 確認產出 md 並入庫' : (ja ? '✅ 要約mdを作成して取り込む' : '✅ Confirm: write md & index');

  o.innerHTML = `
  <div style="width:92vw;max-width:1720px;height:90vh;overflow:hidden;display:flex;flex-direction:column;background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:16px;color:#e6edf3;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <span style="font-weight:600;font-size:22px;">${dlgTitle} <span style="font-size:13px;color:#58a6ff;background:#1f6feb22;padding:2px 6px;border-radius:4px;border:1px solid #388bfd44;margin-left:6px;">Multi-Source v4.0</span></span>
      <button onclick="closeIngestDialog()" style="background:transparent;border:none;color:#8b949e;cursor:pointer;font-size:16px;">✕</button>
    </div>
    <div style="font-size:15px;color:#8b949e;margin-bottom:12px;word-break:break-all;">${targetLabel}<span style="color:#c9d1d9;">${escapeHtml(absDir)}</span>${projName ? ` &nbsp;·&nbsp; <span style="color:#58a6ff;">${escapeHtml(projName)}</span>` : ''}</div>
    
    <div style="display:flex;gap:14px;flex:1;min-height:0;">
      <!-- Left Column: Source Acquisition Tabs & Staged Queue -->
      <div style="flex:0 1 440px;min-width:380px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:18px;font-weight:700;color:#e6edf3;">${step1Title}</div>
          <span style="font-size:13px;color:#8b949e;">支援獨立或批次入庫</span>
        </div>

        <!-- Mode Tabs -->
        <div style="display:flex;gap:4px;background:#161b22;padding:3px;border-radius:8px;border:1px solid #30363d;">
          <button id="ing-mode-file" onclick="ingSwitchSourceTab('files')" style="flex:1;background:#1f6feb;border:none;color:#fff;border-radius:6px;padding:9px 8px;font-size:15px;cursor:pointer;font-weight:600;">📁 ${zh ? '本機檔案' : 'Files'}</button>
          <button id="ing-mode-url" onclick="ingSwitchSourceTab('url')" style="flex:1;background:transparent;border:none;color:#8b949e;border-radius:6px;padding:9px 8px;font-size:15px;cursor:pointer;font-weight:600;">🌐 ${zh ? '網址爬網' : 'Web URL'}</button>
          <button id="ing-mode-clip" onclick="ingSwitchSourceTab('clipboard')" style="flex:1;background:transparent;border:none;color:#8b949e;border-radius:6px;padding:9px 8px;font-size:15px;cursor:pointer;font-weight:600;">📋 ${zh ? '剪貼簿混貼' : 'Clipboard'}</button>
        </div>

        <!-- Tab 1: File Drop Zone -->
        <div id="ing-panel-files" style="display:flex;flex-direction:column;gap:6px;">
          <div id="ing-drop" style="border:1.5px dashed #30363d;border-radius:8px;padding:22px 12px;text-align:center;color:#c9d1d9;font-size:16px;cursor:pointer;transition:border-color .15s,background .15s;">
            🖱️ ${zh ? '拖放檔案至此，或點此選取' : 'Drag files here, or click to browse'}
            <div style="font-size:13px;color:#8b949e;margin-top:4px;">(pptx/docx/pdf/txt/md/csv/eml/圖片)</div>
            <input type="file" id="ing-file-input" multiple accept=".pptx,.ppt,.docx,.doc,.pdf,.txt,.md,.markdown,.csv,.html,.htm,.eml,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif" style="display:none;" />
          </div>
        </div>

        <!-- Tab 2: URL Crawling Zone -->
        <div id="ing-panel-url" style="display:none;flex-direction:column;gap:6px;background:#161b22;padding:10px;border-radius:8px;border:1px solid #30363d;">
          <label style="font-size:15px;color:#c9d1d9;font-weight:600;">輸入技術網址 (URL):</label>
          <input type="url" id="ing-url-input" placeholder="https://example.com/spec/..." style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px 12px;font-size:15px;color:#e6edf3;" />
          <button onclick="ingFetchUrl()" style="background:#238636;border:1px solid #2ea043;color:#fff;border-radius:6px;padding:9px 14px;font-size:15px;cursor:pointer;font-weight:600;">📥 ${zh ? '抓取網頁並加入佇列' : 'Fetch URL & Queue'}</button>
        </div>

        <!-- Tab 3: Mixed Clipboard Paste Zone -->
        <div id="ing-panel-clipboard" style="display:none;flex-direction:column;gap:6px;background:#161b22;padding:10px;border-radius:8px;border:1px solid #30363d;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <label style="font-size:15px;color:#c9d1d9;font-weight:600;">筆記與截圖混貼 (Ctrl+V):</label>
            <span style="font-size:13px;color:#58a6ff;">文字+好幾張截圖可湊成1個</span>
          </div>
          <textarea id="ing-clipboard-text" placeholder="${zh ? '在此輸入或貼上文字、Markdown 片段，亦可直接按 Ctrl+V 貼上多張截圖！' : 'Paste notes here or press Ctrl+V to attach screenshots...'}" style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px 12px;font-size:15px;color:#e6edf3;height:180px;min-height:160px;resize:vertical;font-family:inherit;"></textarea>
          <!-- Thumbnails of pasted screenshots -->
          <div id="ing-clipboard-imgs-bar" style="display:none;gap:6px;flex-wrap:wrap;padding:4px 0;"></div>
          <button onclick="ingCommitClipboardItem()" style="background:#1f6feb;border:1px solid #388bfd;color:#fff;border-radius:6px;padding:9px 14px;font-size:15px;cursor:pointer;font-weight:600;">➕ ${zh ? '合成一個來源項目' : 'Add to Queue as 1 Item'}</button>
        </div>

        <!-- Staged Items Queue Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:2px;">
          <span style="font-size:12px;font-weight:600;color:#8b949e;">待摘要來源佇列:</span>
          <button onclick="ingClearPicked()" style="background:transparent;border:none;color:#6e7681;font-size:13px;cursor:pointer;">${zh ? '清空佇列' : 'Clear all'}</button>
        </div>
        <div id="ing-file-list" style="display:flex;flex-direction:column;gap:5px;flex:1;min-height:120px;overflow-y:auto;background:#0d111755;border:1px solid #21262d;border-radius:6px;padding:6px;"></div>
        
        <button id="ing-btn-sum" onclick="ingSummarizeAll(this)" style="background:#1f6feb;border:1px solid #388bfd;color:#fff;border-radius:6px;padding:11px 16px;cursor:pointer;font-weight:700;font-size:16px;white-space:nowrap;">${sumBtnText}</button>
      </div>

      <!-- Right Column: Filename Setting, Live Preview, and Compound Pills -->
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:18px;font-weight:700;color:#e6edf3;">${step2Title}</div>
          <span id="ing-sel-name" style="font-size:14px;color:#8b949e;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
        </div>

        <!-- Custom Filename & Extension Input Slot -->
        <div style="display:flex;align-items:center;gap:8px;background:#161b22;padding:6px 10px;border-radius:8px;border:1px solid #30363d;">
          <span style="font-size:15px;font-weight:600;color:#58a6ff;white-space:nowrap;">📄 ${zh ? '產出檔名：' : 'Output Filename: '}</span>
          <div style="display:flex;align-items:center;flex:1;background:#0d1117;border:1px solid #30363d;border-radius:6px;overflow:hidden;">
            <input type="text" id="ing-custom-filename" oninput="ingOnFilenameChange(this.value)" placeholder="${zh ? '例如：技術規格周報摘要' : 'filename'}" style="flex:1;background:transparent;border:none;padding:6px 10px;font-size:16px;color:#e6edf3;font-weight:600;outline:none;" />
            <span style="padding:6px 12px;background:#21262d;color:#8b949e;font-size:14px;font-family:monospace;font-weight:700;border-left:1px solid #30363d;user-select:none;">.md</span>
          </div>
          <span style="font-size:13px;color:#8b949e;">${zh ? '(自動生成 .md 副檔名)' : '(auto .md)'}</span>
        </div>

        <!-- View Tabs -->
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="ing-tab-prev" onclick="ingShowTab('prev')" style="background:#1f6feb44;border:1px solid #1f6feb;color:#58a6ff;border-radius:6px;padding:6px 15px;cursor:pointer;font-size:15px;font-weight:600;">👁 ${tabPrev}</button>
          <button id="ing-tab-edit" onclick="ingShowTab('edit')" style="background:transparent;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;padding:6px 15px;cursor:pointer;font-size:15px;font-weight:600;">✏️ ${tabEdit}</button>
          <span style="font-size:12px;color:#8b949e;">${editHint}</span>
        </div>

        <!-- Markdown Preview Box -->
        <div id="ing-preview" style="background:#010409;border:1px solid #21262d;border-radius:6px;padding:14px;font-size:13px;flex:1;min-height:180px;overflow-y:auto;color:#c9d1d9;word-break:break-word;line-height:1.6;">${emptyPrev}</div>
        <textarea id="ing-edit" oninput="ingOnEditorInput(this.value)" style="display:none;background:#010409;border:1px solid #1f6feb;border-radius:6px;padding:14px;font-size:13px;color:#e6edf3;flex:1;min-height:180px;overflow-y:auto;font-family:inherit;white-space:pre-wrap;line-height:1.6;"></textarea>

        <!-- Compound Tagging Visualization Tray -->
        <div id="ing-compound-tray" style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:8px 12px;display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:15px;font-weight:600;color:#e2e8f0;display:flex;align-items:center;gap:5px;">
              <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#3fb950;"></span>
              ${zh ? '知識拓撲滾動複利 (Compound Ingest)' : 'Knowledge Topology Compound'}
            </span>
            <span id="ing-compound-status" style="font-size:13px;color:#8b949e;">${zh ? '點擊標籤/候選詞可自由勾選或剔除' : 'Click pills to toggle'}</span>
          </div>
          <div id="ing-compound-pills" style="display:flex;flex-wrap:wrap;gap:8px;min-height:26px;align-items:center;">
            <span style="font-size:13px;color:#8b949e;">${zh ? '（產生摘要後將顯示比對命中之官方概念與新發掘候選術語）' : '(Compound terms will appear here)'}</span>
          </div>
        </div>

        <button id="ing-btn-save" onclick="ingSave(this)" style="background:#238636;border:1px solid #2ea043;color:#fff;border-radius:6px;padding:12px 18px;cursor:pointer;font-weight:700;font-size:17px;">${saveBtnText}</button>
      </div>
    </div>
    <div id="ing-msg" style="font-size:15px;font-weight:600;margin-top:10px;min-height:16px;"></div>
  </div>`;

  document.body.appendChild(o);
  o.addEventListener('click', (ev) => { if (ev.target === o) closeIngestDialog(); });

  // Bind file inputs & drag-drop
  const dz = document.getElementById('ing-drop');
  const fi = document.getElementById('ing-file-input');
  if (dz && fi) {
    dz.addEventListener('click', () => fi.click());
    fi.addEventListener('change', (ev) => {
      ingAddPicked(Array.from(ev.target.files || []));
      fi.value = '';
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
      const ok = files.filter(f => /\.(pptx?|docx?|pdf|txt|md|markdown|csv|html?|eml|jpe?g|png|webp|bmp|tiff?)$/i.test(f.name || ''));
      ingAddPicked(ok);
    });
  }

  // Bind Clipboard paste listener for mixed text + multiple screenshots
  const clipTextarea = document.getElementById('ing-clipboard-text');
  if (clipTextarea) {
    clipTextarea.addEventListener('paste', (ev) => {
      const items = (ev.clipboardData || window.clipboardData || {}).items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            ev.preventDefault();
            ingHandleClipboardImagePaste(file);
          }
        }
      }
    });
  }
}

function ingSwitchSourceTab(tab) {
  if (!ingState) return;
  ingState.activeTab = tab;
  const pFiles = document.getElementById('ing-panel-files');
  const pUrl = document.getElementById('ing-panel-url');
  const pClip = document.getElementById('ing-panel-clipboard');
  const bFiles = document.getElementById('ing-mode-file');
  const bUrl = document.getElementById('ing-mode-url');
  const bClip = document.getElementById('ing-mode-clip');

  const onCss = 'flex:1;background:#1f6feb;border:none;color:#fff;border-radius:6px;padding:9px 8px;font-size:15px;cursor:pointer;font-weight:600;';
  const offCss = 'flex:1;background:transparent;border:none;color:#8b949e;border-radius:6px;padding:9px 8px;font-size:15px;cursor:pointer;font-weight:600;';

  if (pFiles) pFiles.style.display = tab === 'files' ? 'flex' : 'none';
  if (pUrl) pUrl.style.display = tab === 'url' ? 'flex' : 'none';
  if (pClip) pClip.style.display = tab === 'clipboard' ? 'flex' : 'none';

  if (bFiles) bFiles.style.cssText = tab === 'files' ? onCss : offCss;
  if (bUrl) bUrl.style.cssText = tab === 'url' ? onCss : offCss;
  if (bClip) bClip.style.cssText = tab === 'clipboard' ? onCss : offCss;
}

function ingHandleClipboardImagePaste(file) {
  if (!ingState) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const imgName = `pasted_img_${stamp}_${ingState.clipboardImages.length + 1}.png`;
    ingState.clipboardImages.push({ name: imgName, dataUrl, file });
    ingRenderClipboardImages();
    // Auto-insert markdown reference in textarea
    const ta = document.getElementById('ing-clipboard-text');
    if (ta) {
      const ins = `\n![${imgName}](${imgName})\n`;
      ta.value += ins;
    }
  };
  reader.readAsDataURL(file);
}

function ingRenderClipboardImages() {
  const bar = document.getElementById('ing-clipboard-imgs-bar');
  if (!bar || !ingState) return;
  if (!ingState.clipboardImages.length) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }
  bar.style.display = 'flex';
  bar.innerHTML = ingState.clipboardImages.map((img, idx) => `
    <div style="position:relative;display:inline-flex;align-items:center;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:3px 6px;gap:4px;">
      <img src="${img.dataUrl}" style="width:24px;height:24px;object-fit:cover;border-radius:4px;" />
      <span style="font-size:13px;color:#c9d1d9;">${img.name}</span>
      <button onclick="ingRemoveClipboardImg(${idx})" style="background:transparent;border:none;color:#8b949e;cursor:pointer;font-size:12px;padding:0 2px;">✕</button>
    </div>
  `).join('');
}

function ingRemoveClipboardImg(idx) {
  if (!ingState) return;
  ingState.clipboardImages.splice(idx, 1);
  ingRenderClipboardImages();
}

function ingCommitClipboardItem() {
  if (!ingState) return;
  const ta = document.getElementById('ing-clipboard-text');
  const text = (ta ? ta.value : '').trim();
  const imgs = ingState.clipboardImages || [];

  if (!text && !imgs.length) {
    showToast('⚠️ ' + (ingState.zh ? '請至少輸入文字或貼入一張截圖' : 'Please input text or paste a screenshot'));
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const name = `剪貼簿筆記_${stamp}`;
  const customFilename = `${name}.md`;

  ingState.picked.push({
    type: 'clipboard',
    name,
    customFilename,
    text,
    images: [...imgs],
    size: text.length + imgs.length * 1024,
    stagedPath: '',
    stagedImagePaths: [],
    status: 'picked',
    summary: '',
    model: '',
    error: '',
    compounding: null
  });

  // Reset clipboard inputs
  if (ta) ta.value = '';
  ingState.clipboardImages = [];
  ingRenderClipboardImages();

  if (ingState.sel < 0) ingState.sel = ingState.picked.length - 1;
  ingRenderPicked();
  showToast('✅ ' + (ingState.zh ? '已加入剪貼簿混合項目' : 'Added clipboard item'));
}

function ingFetchUrl() {
  if (!ingState) return;
  const inp = document.getElementById('ing-url-input');
  const url = (inp ? inp.value : '').trim();
  if (!url) {
    showToast('⚠️ ' + (ingState.zh ? '請輸入網址' : 'Please enter a URL'));
    return;
  }
  showToast('⏳ ' + (ingState.zh ? '正在抓取網頁...' : 'Fetching web page...'));
  fetch('/api/ingest/fetch_url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })
  .then(r => r.json())
  .then(res => {
    if (res.success && res.data) {
      const d = res.data;
      const cleanTitle = (d.title || 'WebPage').replace(/[\\/:*?"<>|]/g, '_').trim();
      const customFilename = `${cleanTitle}.md`;
      ingState.picked.push({
        type: 'url',
        name: d.title,
        url: d.url,
        text: d.text,
        customFilename,
        size: d.chars || d.text.length,
        status: 'picked',
        summary: '',
        model: '',
        error: '',
        compounding: null
      });
      if (inp) inp.value = '';
      if (ingState.sel < 0) ingState.sel = ingState.picked.length - 1;
      ingRenderPicked();
      showToast('✅ ' + (ingState.zh ? `已收錄網址：${d.title}` : `Fetched: ${d.title}`));
    } else {
      showToast('❌ ' + (res.error || 'Fetch failed'));
    }
  })
  .catch(err => showToast('❌ ' + err));
}

function ingClearPicked() {
  if (!ingState) return;
  ingState.picked = [];
  ingState.sel = -1;
  ingRenderPicked();
}

// Append files to the ingest pick list (shared by picker + drag&drop).
function ingAddPicked(files) {
  if (!ingState || !files || !files.length) return;
  const seen = new Set(ingState.picked.map(f => `${f.name}::${f.size}`));
  files.forEach(f => {
    const k = `${f.name}::${f.size}`;
    if (!seen.has(k)) {
      seen.add(k);
      const stem = f.name.replace(/\.[^.]+$/, '');
      const customFilename = `${stem}.md`;
      ingState.picked.push({
        type: 'file',
        file: f,
        name: f.name,
        customFilename,
        size: f.size,
        stagedPath: '',
        status: 'picked',
        summary: '',
        model: '',
        error: '',
        compounding: null
      });
    }
  });
  if (ingState.sel < 0 && ingState.picked.length) ingState.sel = 0;
  ingRenderPicked();
}

function ingEntryIcon(e) {
  if (e.status === 'done') return '✅';
  if (e.status === 'error') return '❌';
  if (e.status === 'working') return '⏳';
  if (e.type === 'url') return '🌐';
  if (e.type === 'clipboard') return '📋';
  return '📎';
}

function ingRenderPicked() {
  const box = document.getElementById('ing-file-list');
  if (!box || !ingState) return;
  box.innerHTML = '';
  if (!ingState.picked.length) {
    box.innerHTML = `<div style="font-size:13px;color:#8b949e;padding:12px;text-align:center;">${ingState.zh ? '（佇列目前無項目，請從上方新增）' : '(queue empty)'}</div>`;
    ingState.sel = -1;
    paintIngSelName();
    paintIngSaveBtn();
    renderIngCompoundTray(null);
    return;
  }
  ingState.picked.forEach((e, idx) => {
    const d = document.createElement('div');
    const sel = idx === ingState.sel;
    d.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:15px;font-weight:500;color:#e6edf3;border:1px solid ' + (sel ? '#1f6feb' : '#21262d') + ';border-radius:6px;padding:8px 12px;cursor:pointer;transition:background .1s;';
    if (sel) d.style.background = '#1f6feb22';
    const ic = document.createElement('span');
    ic.textContent = ingEntryIcon(e);
    ic.style.cssText = e.status === 'working' ? 'color:#58a6ff;' : '';
    if (e.status === 'working') ic.className = 'ing-spin';
    d.appendChild(ic);

    const tx = document.createElement('span');
    tx.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const szText = e.size ? ` (${Math.round(e.size / 1024)} KB)` : '';
    tx.textContent = `${e.name}${szText}`;
    tx.title = e.customFilename || e.name;
    d.appendChild(tx);

    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = ingState.zh ? '移除' : 'Remove';
    x.style.cssText = 'background:transparent;border:none;color:#8b949e;cursor:pointer;font-size:13px;padding:0 2px;';
    x.onclick = (ev) => {
      ev.stopPropagation();
      ingState.picked.splice(idx, 1);
      if (ingState.sel >= ingState.picked.length) ingState.sel = ingState.picked.length - 1;
      ingRenderPicked();
    };
    d.appendChild(x);
    d.onclick = () => ingSelectFile(idx);
    box.appendChild(d);
  });
  paintIngSelName();
  paintIngSaveBtn();
  const cur = ingCurEntry();
  renderIngCompoundTray(cur ? cur.compounding : null);
}

function ingOnFilenameChange(val) {
  const cur = ingCurEntry();
  if (cur) {
    let clean = val.trim();
    if (clean.toLowerCase().endsWith('.md')) clean = clean.slice(0, -3).trim();
    cur.customFilename = clean;
  }
}

function ingOnEditorInput(val) {
  const cur = ingCurEntry();
  if (cur) cur.summary = val;
}

function paintIngSelName() {
  const el = document.getElementById('ing-sel-name');
  const fnInput = document.getElementById('ing-custom-filename');
  if (!ingState) return;
  const e = ingCurEntry();
  if (el) el.textContent = e ? `來源：${e.name}` : '';
  if (fnInput) {
    let fn = e ? (e.customFilename || e.name || '') : '';
    if (fn.toLowerCase().endsWith('.md')) fn = fn.slice(0, -3).trim();
    fnInput.value = fn;
    fnInput.disabled = !e;
  }
}

function paintIngSaveBtn() {
  const btn = document.getElementById('ing-btn-save');
  if (!btn || !ingState) return;
  const n = ingState.picked.filter(e => e.status === 'done').length;
  btn.textContent = n
    ? (ingState.zh ? `✅ 確認產出 ${n} 個 md 並入庫` : (ingState.ja ? `✅ ${n} 件の要約mdを作成して取り込む` : `✅ Confirm: write ${n} md & index`))
    : (ingState.zh ? '✅ 確認產出 md 並入庫' : (ingState.ja ? '✅ 要約mdを作成して取り込む' : '✅ Confirm: write md & index'));
}

function renderIngCompoundTray(comp) {
  const tray = document.getElementById('ing-compound-pills');
  const statusEl = document.getElementById('ing-compound-status');
  if (!tray) return;
  const cur = ingCurEntry();
  if (!comp || (!comp.matched && !comp.candidates && !comp.matched_concepts && !comp.discovered_candidates)) {
    tray.innerHTML = `<span style="font-size:13px;color:#8b949e;">${ingState && ingState.zh ? '（產生摘要後將顯示比對命中之官方概念與新發掘候選術語）' : '(Compound terms will appear here)'}</span>`;
    if (statusEl) statusEl.textContent = ingState && ingState.zh ? '摘要生成後自動打標與術語發掘' : 'Ready';
    return;
  }

  const matched = comp.matched || (comp.matched_concepts || []).map(m => m.name) || [];
  const candidates = comp.candidates || (comp.discovered_candidates || []).map(c => c.term) || [];

  // Initialize selection sets if not present
  if (!cur.selectedMatched) {
    cur.selectedMatched = new Set(matched);
  }
  if (!cur.selectedCandidates) {
    cur.selectedCandidates = new Set(candidates);
  }

  const selMatchedCount = cur.selectedMatched.size;
  const selCandCount = cur.selectedCandidates.size;

  if (statusEl) {
    statusEl.innerHTML = `<span style="color:#3fb950;font-weight:600;">已選鏈接 ${selMatchedCount}/${matched.length} 個</span> &nbsp;·&nbsp; <span style="color:#d29922;font-weight:600;">已選候選 ${selCandCount}/${candidates.length} 個</span> <span style="font-size:11.5px;color:#8b949e;margin-left:6px;">(點擊膠囊切換選取)</span>`;
  }

  let html = '';
  matched.forEach(name => {
    const isSelected = cur.selectedMatched.has(name);
    const bg = isSelected ? '#23863628' : '#21262d44';
    const border = isSelected ? '#2ea043' : '#30363d';
    const color = isSelected ? '#3fb950' : '#8b949e';
    const checkIcon = isSelected ? '✓ ' : '';
    const opacity = isSelected ? '1' : '0.6';
    const lineThrough = isSelected ? 'none' : 'line-through';
    html += `<span onclick="ingToggleCompoundPill('matched', '${escapeHtml(name)}')" title="${isSelected ? '已選取入庫 (點擊取消)' : '已排除 (點擊啟用)'}" style="display:inline-flex;align-items:center;gap:4px;background:${bg};border:1px solid ${border};color:${color};padding:3px 9px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;user-select:none;transition:all 0.15s ease;opacity:${opacity};text-decoration:${lineThrough};">🏷️ ${checkIcon}${escapeHtml(name)}</span>`;
  });
  candidates.forEach(term => {
    const isSelected = cur.selectedCandidates.has(term);
    const bg = isSelected ? '#d2992228' : '#21262d44';
    const border = isSelected ? '#d29922' : '#30363d';
    const color = isSelected ? '#e3b341' : '#8b949e';
    const checkIcon = isSelected ? '✓ ' : '';
    const opacity = isSelected ? '1' : '0.6';
    const lineThrough = isSelected ? 'none' : 'line-through';
    html += `<span onclick="ingToggleCompoundPill('candidate', '${escapeHtml(term)}')" title="${isSelected ? '已選取收錄 (點擊取消)' : '已排除 (點擊啟用)'}" style="display:inline-flex;align-items:center;gap:4px;background:${bg};border:1px solid ${border};color:${color};padding:3px 9px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;user-select:none;transition:all 0.15s ease;opacity:${opacity};text-decoration:${lineThrough};">✨ ${checkIcon}${escapeHtml(term)}</span>`;
  });
  if (!html) {
    html = `<span style="font-size:13px;color:#8b949e;">（本次摘要內容無新領域術語）</span>`;
  }
  tray.innerHTML = html;
}

window.ingToggleCompoundPill = function(type, val) {
  const cur = ingCurEntry();
  if (!cur) return;
  if (type === 'matched') {
    if (!cur.selectedMatched) cur.selectedMatched = new Set();
    if (cur.selectedMatched.has(val)) {
      cur.selectedMatched.delete(val);
    } else {
      cur.selectedMatched.add(val);
    }
  } else if (type === 'candidate') {
    if (!cur.selectedCandidates) cur.selectedCandidates = new Set();
    if (cur.selectedCandidates.has(val)) {
      cur.selectedCandidates.delete(val);
    } else {
      cur.selectedCandidates.add(val);
    }
  }
  renderIngCompoundTray(cur.compounding);
};

// Click a row: stash current editor draft, show that file's summary.
function ingSelectFile(idx) {
  const st = ingState;
  if (!st || !st.picked[idx]) return;
  const ed = document.getElementById('ing-edit');
  if (ed && st.picked[st.sel] && st.picked[st.sel].status === 'done') {
    st.picked[st.sel].summary = ed.value;
  }
  st.sel = idx;
  const e = st.picked[idx];
  if (ed) ed.value = e.summary || '';
  paintIngSelName();
  ingShowTab('prev');
  ingRenderPicked();
  renderIngCompoundTray(e.compounding);
}

function ingShowTab(which) {
  const st = ingState;
  if (!st) return;
  const pv = document.getElementById('ing-preview');
  const ed = document.getElementById('ing-edit');
  const tp = document.getElementById('ing-tab-prev');
  const te = document.getElementById('ing-tab-edit');
  if (!pv || !ed || !tp || !te) return;
  const cur = ingCurEntry();
  const on = 'background:#1f6feb44;border:1px solid #1f6feb;color:#58a6ff;border-radius:6px;padding:6px 15px;cursor:pointer;font-size:15px;font-weight:600;';
  const off = 'background:transparent;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;padding:6px 15px;cursor:pointer;font-size:15px;font-weight:600;';
  if (which === 'edit') {
    if (cur && !ed.value) ed.value = cur.summary || '';
    pv.style.display = 'none';
    ed.style.display = 'block';
    tp.style.cssText = off;
    te.style.cssText = on;
    ed.focus();
  } else {
    if (cur && ed.style.display === 'block') cur.summary = ed.value;
    ed.style.display = 'none';
    pv.style.display = 'block';
    tp.style.cssText = on;
    te.style.cssText = off;
    const txt = ((cur && cur.summary) || '').trim();
    if (!txt) {
      pv.textContent = st.zh ? '（摘要會顯示在這裡）' : '(summary appears here)';
      return;
    }
    try {
      if (window.marked && typeof window.marked.parse === 'function') pv.innerHTML = window.marked.parse(txt);
      else if (typeof window.marked === 'function') pv.innerHTML = window.marked(txt);
      else pv.textContent = txt;
      if (typeof resolveMarkdownImages === 'function') {
        const previewDocPath = (st.dir ? st.dir + '/' : '') + (cur.customFilename || cur.filename || 'preview.md');
        resolveMarkdownImages(pv, previewDocPath);
      }
    } catch (e) { pv.textContent = txt; }
  }
}

// Stage physical files and clipboard images
function ingStageAll(done) {
  const st = ingState;
  if (!st) return;
  const needStage = st.picked.filter(e => e.type === 'file' && e.file && !e.stagedPath);
  const needClipStage = st.picked.filter(e => e.type === 'clipboard' && e.images && e.images.length && !e.stagedImagePaths.length);

  if (!needStage.length && !needClipStage.length) { done(); return; }

  const fd = new FormData();
  fd.append('target_dir', st.dir);
  fd.append('stage', '1');

  needStage.forEach(e => fd.append('files', e.file, e.name));

  needClipStage.forEach(e => {
    e.images.forEach(im => {
      if (im.file) {
        fd.append('files', im.file, im.name);
      }
    });
  });

  fetch('/api/ingest/upload', { method: 'POST', body: fd })
  .then(r => r.json())
  .then(d => {
    if (d.success && d.files) {
      const fileMap = {};
      d.files.forEach(f => { fileMap[f.name] = f.path; });
      needStage.forEach(e => {
        if (fileMap[e.name]) { e.stagedPath = fileMap[e.name]; e.status = 'staged'; }
      });
      needClipStage.forEach(e => {
        e.stagedImagePaths = e.images.map(im => fileMap[im.name]).filter(Boolean);
      });
      ingRenderPicked();
      done();
    } else {
      if (st._stop) st._stop();
      ingMsg('❌ ' + ((d && d.error) || 'Upload staging failed'), true);
    }
  })
  .catch(err => { if (st._stop) st._stop(); ingMsg('❌ ' + err, true); });
}

// Batch: summarize file-by-file / url-by-url / clip-by-clip
function ingSummarizeAll(btn) {
  const st = ingState;
  if (!st) return;
  const zh = st.zh;
  if (!st.picked.length) { ingMsg(zh ? '請先新增來源' : 'Queue is empty', true); return; }
  setBusy(btn, true, '⏳…');

  ingStageAll(() => {
    const queue = st.picked.filter(e => e.status !== 'done');
    if (!queue.length) {
      setBusy(btn, false);
      ingMsg(zh ? '全部已完成' : 'All done already', true);
      return;
    }
    if (st._stop) st._stop();
    let i = 0;
    const pv0 = document.getElementById('ing-preview');

    const step = () => {
      if (i >= queue.length) {
        if (st._stop) st._stop();
        setBusy(btn, false);
        const nd = st.picked.filter(e => e.status === 'done').length;
        const ne = st.picked.filter(e => e.status === 'error').length;
        const successMsg = zh ? `✅ 整批完成：${nd} 成功` : `✅ Batch done: ${nd} ok`;
        const failMsg = ne ? (zh ? `，${ne} 失敗` : `, ${ne} failed`) : '';
        ingMsg(successMsg + failMsg);
        return;
      }
      const e = queue[i];
      if (st._stop) st._stop();
      st._stop = ingProgress(zh ? `摘要生成中 ${i + 1}/${queue.length}：${e.name}` : `Summarizing ${i + 1}/${queue.length}: ${e.name}`);
      e.status = 'working'; e.error = '';
      ingRenderPicked();
      if (pv0) pv0.innerHTML = `<span class="ing-spin">◌</span> ${zh ? 'LLM 生成中…' : 'Generating…'}`;

      let summarizePayload = {};
      if (e.type === 'url') {
        summarizePayload = { text: e.text, paths: [] };
      } else if (e.type === 'clipboard') {
        summarizePayload = {
          text: e.text,
          paths: e.stagedImagePaths || [],
          pasted_image_rels: (e.images || []).map(im => im.name)
        };
      } else {
        summarizePayload = { paths: [e.stagedPath] };
      }

      fetch('/api/ingest/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(summarizePayload)
      })
      .then(r => r.json().then(d => ({ status: r.status, body: d })))
      .then(({ status, body }) => {
        if (status === 200 && body.success) {
          e.status = 'done';
          e.summary = body.summary || '';
          e.model = body.model || '';

          // Auto-derive filename from LLM H1 if title was untitled or clipboard
          const h1Match = e.summary.match(/^#\s+(.+)$/m);
          if (h1Match && h1Match[1] && (e.type === 'clipboard' || !e.customFilename)) {
            let h1Clean = h1Match[1].replace(/[\/:*?"<>|]/g, '_').trim();
            if (h1Clean.toLowerCase().endsWith('.md')) h1Clean = h1Clean.slice(0, -3).trim();
            e.customFilename = h1Clean;
          }

          const k = st.picked.indexOf(e);
          if (k >= 0) { st.sel = k; }
          const ed0 = document.getElementById('ing-edit');
          if (ed0) ed0.value = e.summary;
          paintIngSelName();
          ingShowTab('prev');
          ingRenderPicked();

          // Trigger Compound Preview
          fetch('/api/ingest/compound_preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ summary_md: e.summary, repo: st.repo })
          })
          .then(cr => cr.json())
          .then(cd => {
            if (cd.success && cd.compounding) {
              e.compounding = cd.compounding;
              if (st.sel === k) renderIngCompoundTray(e.compounding);
            }
          }).catch(() => {});

          ingMsg((zh ? `✅ ${e.name}（${body.model || ''}）` : `✅ ${e.name} (${body.model || ''})`));
        } else {
          e.status = 'error';
          e.error = (body && body.error) || String(status);
          ingRenderPicked();
          if (pv0) pv0.textContent = zh ? '（摘要會顯示在這裡）' : '(summary appears here)';
          ingMsg(`❌ ${e.name}：` + e.error, true);
        }
        i++;
        step();
      })
      .catch(err => {
        e.status = 'error';
        e.error = String(err);
        ingRenderPicked();
        ingMsg(`❌ ${e.name}：` + err, true);
        i++;
        step();
      });
    };
    step();
  });
}

// Confirm save
function ingSave(btn) {
  const st = ingState;
  if (!st) return;
  const zh = st.zh;
  const ed0 = document.getElementById('ing-edit');
  const cur = ingCurEntry();
  if (ed0 && cur && cur.status === 'done') cur.summary = ed0.value;
  const done = st.picked.filter(e => e.status === 'done' && (e.summary || '').trim());
  if (!done.length) {
    ingMsg(zh ? '還沒有完成的摘要（請先點擊整批生成摘要）' : 'No finished summaries yet', true);
    return;
  }
  setBusy(btn, true, '⏳…');
  if (st._stop) st._stop();
  let i = 0, okCount = 0;
  const outs = [];
  st._stop = ingProgress(zh ? `寫檔＋增量索引中 0/${done.length}` : `Writing + indexing 0/${done.length}`);

  const step = () => {
    if (i >= done.length) {
      if (st._stop) st._stop();
      setBusy(btn, false);
      showToast(zh ? `✅ 已產出 ${okCount}/${done.length} 個 md` : `✅ Wrote ${okCount}/${done.length} md`);
      ingMsg((zh ? `✅ 完成 ${okCount}/${done.length}：` : `✅ Done ${okCount}/${done.length}: `) + outs.join('、'));
      loadProjects();
      if (typeof fetchConceptsData === 'function') fetchConceptsData();
      if (okCount === done.length) setTimeout(closeIngestDialog, 1200);
      return;
    }
    const e = done[i];
    if (st._stop) st._stop();
    st._stop = ingProgress(zh ? `寫檔＋增量索引中 ${i + 1}/${done.length}：${e.name}` : `Writing + indexing ${i + 1}/${done.length}: ${e.name}`);

    // Use customized filename if available
    let outFilename = (e.customFilename || e.name).trim();
    if (outFilename.endsWith('.md')) outFilename = outFilename.slice(0, -3);

    const savePayload = {
      target_dir: st.dir,
      filename: outFilename,
      summary_md: e.summary.trim(),
      source_paths: e.type === 'clipboard' ? (e.stagedImagePaths || []) : (e.stagedPath ? [e.stagedPath] : []),
      source_urls: e.type === 'url' ? [e.url] : [],
      model: e.model,
      selected_matched: e.selectedMatched ? Array.from(e.selectedMatched) : null,
      selected_candidates: e.selectedCandidates ? Array.from(e.selectedCandidates) : null
    };

    fetch('/api/ingest/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(savePayload)
    })
    .then(r => r.json().then(d => ({ status: r.status, body: d })))
    .then(({ status, body }) => {
      if (status === 200 && body.success) {
        okCount++;
        outs.push(outFilename);
        if (body.compounding) {
          e.compounding = body.compounding;
          renderIngCompoundTray(e.compounding);
        }
      } else {
        e.status = 'error';
        e.error = (body && body.error) || String(status);
        ingRenderPicked();
        ingMsg(`❌ ${e.name}：` + e.error, true);
      }
      i++;
      step();
    })
    .catch(err => {
      e.status = 'error';
      e.error = String(err);
      ingRenderPicked();
      ingMsg(`❌ ${e.name}：` + err, true);
      i++;
      step();
    });
  };
  step();
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
  if (typeof syncScanScopeIfOpen === 'function') syncScanScopeIfOpen();
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
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const ja = (typeof currentLanguage !== 'undefined' && currentLanguage === 'ja');
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
    items.push({ label: zh ? '＋ 新增文件…' : (ja ? '＋ 新規ドキュメント…' : '＋ New document…'), fn: () => {
      if (typeof openIngestDialog === 'function') openIngestDialog(absPath);
      else showToast(zh ? '⏳ 文件匯入即將推出' : (ja ? '⏳ ドキュメント取り込みは準備中' : '⏳ Document ingest coming soon'));
    }});
    items.push({ label: zh ? '📁 新增資料夾…' : (ja ? '📁 新規フォルダ…' : '📁 New folder…'), fn: () => treeNewFolder(absPath) });
    items.push({ label: zh ? '🗑️ 刪除此資料夾…' : (ja ? '🗑️ このフォルダを削除…' : '🗑️ Delete folder…'), fn: () => treeDeleteDir(absPath, treePath.split('/').pop() || treePath) });
    addCopyAbs(zh ? '📋 複製絕對路徑' : (ja ? '📋 絶対パスをコピー' : '📋 Copy absolute path'));
  } else if (kind === 'file') {
    items.push({ label: zh ? '🎯 在圖上定位' : (ja ? '🎯 グラフで位置を特定' : '🎯 Locate in graph'), fn: () => focusGraphNodeById(nodeId) });
    items.push({ label: zh ? '🗑️ 刪除此文件…' : (ja ? '🗑️ このドキュメントを削除…' : '🗑️ Delete document…'), fn: () => treeDeleteFile(absPath, treePath.split('/').pop() || treePath) });
    addCopyAbs(zh ? '📋 複製絕對路徑' : (ja ? '📋 絶対パスをコピー' : '📋 Copy absolute path'));
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
  const lang = currentLanguage;
  const zh = lang === 'zh';
  const ja = lang === 'ja';
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setAttr = (id, attr, txt) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, txt); };

  set('btn-repo-mgr', zh ? '⚙ 倉庫' : (ja ? '⚙ リポジトリ' : '⚙ Repos'));
  set('btn-sel-all', zh ? '全選' : (ja ? 'すべて選択' : 'Select All'));
  set('btn-sel-none', zh ? '取消選取' : (ja ? '選択解除' : 'Deselect'));
  set('btn-clear-filter', '✕');
  setAttr('btn-clear-filter', 'title', zh ? '清除篩選' : (ja ? 'フィルター解除' : 'Clear filter'));

  const treeSearch = document.getElementById('tree-search');
  if (treeSearch) treeSearch.placeholder = zh ? '篩選文件樹…' : (ja ? 'ドキュメントツリーを検索…' : 'Filter documentation tree...');

  const summary = document.getElementById('lbl-proj-summary');
  if (summary) summary.innerText = `${selectedProjects.size} ${zh ? '個啟用' : (ja ? '件有効' : 'Active')}`;

  set('th-proj', zh ? '專案' : (ja ? 'プロジェクト' : 'Project'));
  set('th-path', zh ? '目錄路徑' : (ja ? 'パス' : 'Directory Path'));
  set('th-metrics', zh ? '指標' : (ja ? 'メトリクス' : 'Metrics'));
  set('th-status', zh ? '狀態' : (ja ? 'ステータス' : 'Status'));
  set('th-actions', zh ? '操作' : (ja ? '操作' : 'Actions'));

  set('lbl-modal-title', zh ? '專案儲存庫管理' : (ja ? 'リポジトリ管理' : 'Repository Management'));
  set('lbl-add-dir', zh ? '掃描專案目錄：' : (ja ? 'プロジェクトをスキャン：' : 'Scan Project Directory:'));
  set('lbl-repo-list', zh ? '已發現的專案儲存庫：' : (ja ? '検出されたリポジトリ：' : 'Discovered Repositories:'));
  set('btn-sync-all', zh ? '⚡ 全部同步' : (ja ? '⚡ すべて同期' : '⚡ Sync all'));
  set('btn-sync-all-tree', zh ? '⚡ 全部同步' : (ja ? '⚡ すべて同期' : '⚡ Sync all'));
  paintShowSourceBtn();
  renderRepoTable(allProjectsList);
  return;
}
function _unused_updateExplorerI18n() {
  const zh = currentLanguage === 'zh';
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setAttr = (id, attr, txt) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, txt); };

  set('btn-repo-mgr', zh ? '⚙ 儲存庫' : '⚙ Repos');
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

  set('lbl-modal-title', zh ? '專案儲存庫管理' : 'Repository Management');
  set('lbl-add-dir', zh ? '掃描專案目錄：' : 'Scan Project Directory:');
  set('lbl-repo-list', zh ? '已發現的專案儲存庫：' : 'Discovered Repositories:');
  set('btn-sync-all', zh ? '⚡ 全部同步' : '⚡ Sync all');
  set('btn-sync-all-tree', zh ? '⚡ 全部同步' : '⚡ Sync all');
  paintShowSourceBtn();

  renderRepoTable(allProjectsList);
}

// (Old toggleLanguage superseded by tri-state applyAppLanguage below)

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getCategoryDisplayName(cat) {
  const isUncat = !cat || cat === '未分類' || cat === 'Uncategorized';
  if (!isUncat) return cat;
  if (typeof currentLanguage !== 'undefined') {
    if (currentLanguage === 'zh') return '未分類';
    if (currentLanguage === 'ja') return '未分類';
  }
  return 'Uncategorized';
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
  updateActivityBarI18n();
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

    // Copy hotkey handling (Ctrl+C / Cmd+C)
    if ((e.ctrlKey || e.metaKey) && code === 'KeyC') {
      const sel = (window.getSelection ? window.getSelection().toString() : '').trim();
      if (sel) {
        // Active text selection: copy selected text and show confirmation toast
        const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
        copyTextToClipboard(sel, zh ? '📋 已複製選取文字' : '📋 Selection copied');
        return; // Handled cleanly!
      }
      return; // No text selected, let native browser copy proceed
    }

    // View control hotkeys (Standalone keys only — NEVER hijack Ctrl/Cmd combos!)
    if (code === 'KeyC' && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
      lockEl.textContent = stripMdLinks(activeNode.name);
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
    if (kSpace) kSpace.textContent = '靜止 / 停止移動';
    if (kC) kC.textContent = '鏡頭置中並對齊目標節點';
    if (kF) kF.textContent = '最適全景視角';
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
  } else if (currentLanguage === 'en') {
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
  } else if (currentLanguage === 'ja') {
    if (btnHelp) btnHelp.title = '3Dナビゲーション操作ヘルプ';
    if (modalTitle) modalTitle.textContent = '3D操作・ナビゲーション';
    if (secKb) secKb.textContent = 'キーボード操作';
    if (secView) secView.textContent = '視点・表示階層制御';
    if (secMouse) secMouse.textContent = 'マウス操作';

    if (kWs) kWs.textContent = '前進 / 後退';
    if (kAd) kAd.textContent = '左移動 / 右移動';
    if (kQe) kQe.textContent = '視線上見上げ / 視線下見下ろし';
    if (kShift) kShift.textContent = '移動加速 (2.5倍)';
    if (kSpace) kSpace.textContent = '静止 / ブレーキ';
    if (kC) kC.textContent = 'ターゲットノードにカメラを中央合わせ';
    if (kF) kF.textContent = '全体を最適表示';
    if (kLod) kLod.textContent = 'LODレベル切替 (構造 / 標準 / すべて)';
    if (footer) footer.textContent = 'Esc または閉じるボタンで戻る';

    if (mClickT) mClickT.textContent = '左クリック';
    if (mClickD) mClickD.textContent = 'ノード選択 & Markdown同期';
    if (mRightT) mRightT.textContent = '右ドラッグ';
    if (mRightD) mRightD.textContent = '視点回転 (オービット)';
    if (mPanT) mPanT.textContent = '中クリック / Shift + ドラッグ';
    if (mDblT) mDblT.textContent = '背景ダブルクリック';
    if (mDblD) mDblD.textContent = '全体ビューへリセット';
  }
  if (typeof updatePromptsI18n === 'function') {
    updatePromptsI18n();
  if (typeof updateLintI18n === 'function') updateLintI18n();
  }
}

// ==================== App-wide LLM Provider Settings Dialog ====================
// Ported from codegraph-galaxy (galaxy.js provider dialog), re-rooted to
// /api/llm/* — this provider serves the WHOLE app (ingest / chat / anything
// that burns tokens), not just a chat panel. Backend: docgraphical/llm_provider.py.
let provCurrentType = 'llamacpp';
let provFetchedModels = [];

function provT(key) {
  const lang = currentLanguage;
  const dic = {
    prov_title: lang === 'zh' ? 'LLM 模型供應商' : (lang === 'ja' ? 'LLM プロバイダー' : 'LLM Providers'),
    prov_note: lang === 'zh' ? '此供應商為整支 APP 共用（ingest 摘要、對話與所有 LLM 功能）。'
              : (lang === 'ja' ? 'このプロバイダーはアプリ全体（Ingest要約、チャット、全LLM機能）で共有されます。'
              : 'This provider is used by the whole app (ingest, chat, and all LLM features).'),
    prov_cur: lang === 'zh' ? '啟用模型' : (lang === 'ja' ? 'アクティブモデル' : 'Active model'),
    prov_add: lang === 'zh' ? '設定供應商與金鑰' : (lang === 'ja' ? 'プロバイダーとキーの設定' : 'Configure Provider & Key'),
    prov_f_label: lang === 'zh' ? '供應商名稱' : (lang === 'ja' ? 'プロバイダー名' : 'Provider Name'),
    prov_f_base: 'Base URL',
    prov_f_key: lang === 'zh' ? 'API 金鑰 (API Token / Key)' : (lang === 'ja' ? 'APIキー (API Token / Key)' : 'API Key / Token'),
    prov_f_models: lang === 'zh' ? '可選模型' : (lang === 'ja' ? '利用可能モデル' : 'Available Models'),
    prov_fetch: lang === 'zh' ? '⇩ 自動偵測模型 (Auto-fill)' : (lang === 'ja' ? '⇩ モデル自動取得 (Auto-fill)' : '⇩ Auto-fill Models'),
    prov_cancel: lang === 'zh' ? '取消' : (lang === 'ja' ? 'キャンセル' : 'Cancel'),
    prov_save: lang === 'zh' ? '儲存並啟用' : (lang === 'ja' ? '保存して適用' : 'Save & Activate'),
    prov_models_empty: lang === 'zh' ? '請先填入 API Key 並點擊自動偵測' : 'Please enter API Key and click Auto-fill',
    prov_ok_models: (n, k) => (lang === 'zh' ? `已成功獲取 ${n} 個可用模型（${k}）` : (lang === 'ja' ? `${n} 個のモデルを取得しました（${k}）` : `Found ${n} models (${k})`))
  };
  return dic[key] || key;
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
  set('lbl-prov-f-label', currentLanguage === 'zh' ? '選擇服務商 (Provider Name)' : (currentLanguage === 'ja' ? 'プロバイダーの選択 (Provider Name)' : 'Provider Name'));
  set('lbl-prov-f-base', provT('prov_f_base'));
  set('lbl-prov-f-key', provT('prov_f_key'));
  set('lbl-prov-f-models', provT('prov_f_models'));
  set('lbl-prov-fetch', provT('prov_fetch'));
  set('lbl-prov-cancel', provT('prov_cancel'));
  set('lbl-prov-save', provT('prov_save'));
  set('lbl-prov-configured-title', currentLanguage === 'zh' ? '已儲存的自訂供應商 (Configured Providers)' : (currentLanguage === 'ja' ? '保存済みのプロバイダー (Configured Providers)' : 'Configured Providers'));

  const filterInput = document.getElementById('prov-model-filter');
  if (filterInput) {
    filterInput.placeholder = currentLanguage === 'zh' ? '🔎 篩選模型清單…' : (currentLanguage === 'ja' ? '🔎 モデルを絞り込み…' : '🔎 Filter models…');
  }
}

function provTypes() {
  return [
    // --- 知名雲端大廠 (Official Cloud Providers) ---
    { id: 'openai', label: 'OpenAI', category: 'Cloud', base: 'https://api.openai.com/v1', key: '', urlMode: 'fixed', keyMode: 'require' },
    { id: 'anthropic', label: 'Anthropic Claude', category: 'Cloud', base: 'https://api.anthropic.com/v1', key: '', urlMode: 'fixed', keyMode: 'require' },
    { id: 'deepseek', label: 'DeepSeek', category: 'Cloud', base: 'https://api.deepseek.com/v1', key: '', urlMode: 'fixed', keyMode: 'require' },
    { id: 'gemini', label: 'Google Gemini', category: 'Cloud', base: 'https://generativelanguage.googleapis.com/v1beta/openai/', key: '', urlMode: 'fixed', keyMode: 'require' },
    { id: 'groq', label: 'Groq (Ultra-Fast Llama)', category: 'Cloud', base: 'https://api.groq.com/openai/v1', key: '', urlMode: 'fixed', keyMode: 'require' },
    { id: 'grok', label: 'xAI Grok', category: 'Cloud', base: 'https://api.x.ai/v1', key: '', urlMode: 'fixed', keyMode: 'require' },
    { id: 'mistral', label: 'Mistral AI', category: 'Cloud', base: 'https://api.mistral.ai/v1', key: '', urlMode: 'fixed', keyMode: 'require' },
    { id: 'perplexity', label: 'Perplexity AI', category: 'Cloud', base: 'https://api.perplexity.ai', key: '', urlMode: 'fixed', keyMode: 'require' },
    { id: 'cohere', label: 'Cohere', category: 'Cloud', base: 'https://api.cohere.ai/v1', key: '', urlMode: 'fixed', keyMode: 'require' },
    { id: 'together', label: 'Together AI', category: 'Cloud', base: 'https://api.together.xyz/v1', key: '', urlMode: 'fixed', keyMode: 'require' },
    { id: 'fireworks', label: 'Fireworks AI', category: 'Cloud', base: 'https://api.fireworks.ai/inference/v1', key: '', urlMode: 'fixed', keyMode: 'require' },
    { id: 'openrouter', label: 'OpenRouter (All-in-One Aggregator)', category: 'Cloud', base: 'https://openrouter.ai/api/v1', key: '', urlMode: 'fixed', keyMode: 'require' },

    // --- 本機與自建服務 (Local & Self-Hosted /v1) ---
    { id: 'local_openai', label: 'Local / vLLM / llama.cpp / LM Studio (/v1)', category: 'Local', base: 'http://172.22.20.125:8080/v1', key: 'EMPTY', urlMode: 'edit', keyMode: 'optional' },
    { id: 'local_ollama', label: 'Local Ollama (/v1)', category: 'Local', base: 'http://127.0.0.1:11434/v1', key: '', urlMode: 'edit', keyMode: 'optional' },
    { id: 'local_anthropic', label: 'Local Anthropic Proxy (/v1)', category: 'Local', base: 'http://127.0.0.1:8000/v1', key: '', urlMode: 'edit', keyMode: 'optional' },
    { id: 'custom', label: 'Custom OpenAI-Compatible API (/v1)', category: 'Custom', base: '', key: '', urlMode: 'edit', keyMode: 'optional' },
  ];
}

function renderProvPresets() {
  // Fetch opencode presets in background if not loaded
  fetch('/api/llm/opencode-presets')
    .then(r => r.json())
    .then(list => {
      if (Array.isArray(list) && list.length) {
        cachedOpencodePresets = list;
        rebuildProviderNameDropdown();
      }
    }).catch(() => {});

  rebuildProviderNameDropdown();
}

function rebuildProviderNameDropdown() {
  const sel = document.getElementById('chat-prov-label') || document.getElementById('prov-type-select');
  if (!sel) return;
  sel.innerHTML = '';

  const zh = currentLanguage === 'zh';
  const ja = currentLanguage === 'ja';

  const categories = {
    'Cloud': zh ? '🌐 常見雲端服務商 (僅需 API Key)' : (ja ? '🌐 クラウドプロバイダー (APIキーのみ)' : '🌐 Cloud Providers (API Key Only)'),
    'Local': zh ? '🖥️ 本地 Opencode 與自建推論 (需指定 Base URL)' : (ja ? '🖥️ ローカル推論 & Opencode (Base URL必須)' : '🖥️ Local & Self-Hosted (Requires Base URL)')
  };

  const grpCloud = document.createElement('optgroup');
  grpCloud.label = categories['Cloud'];
  const grpLocal = document.createElement('optgroup');
  grpLocal.label = categories['Local'];

  sel.appendChild(grpCloud);
  sel.appendChild(grpLocal);

  for (const p of provTypes()) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    if (p.category === 'Cloud') {
      grpCloud.appendChild(opt);
    } else {
      grpLocal.appendChild(opt);
    }
  }

  sel.value = provCurrentType || 'openai';
  onSelectProviderName(sel.value);
}

function onSelectProviderName(id) {
  const p = provTypes().find(x => x.id === id) || provTypes()[0];
  provCurrentType = p.id;
  provFetchedModels = [];

  const sel = document.getElementById('chat-prov-label') || document.getElementById('prov-type-select');
  if (sel && sel.value !== p.id) sel.value = p.id;

  const rowUrl = document.getElementById('prov-row-url');
  const baseInp = document.getElementById('chat-prov-base');
  const fixedUrl = document.getElementById('prov-fixed-url');

  // 常見雲端不需要給 URL 直接填 API 就好，如果是地端的才要 URL
  if (p.category === 'Cloud') {
    if (rowUrl) rowUrl.style.display = 'none';
    if (fixedUrl) {
      fixedUrl.style.display = 'block';
      fixedUrl.innerHTML = `<span style="color:#388bfd;">🌐 官方端點 (Cloud Endpoint):</span> <code>${p.base}</code>`;
    }
    if (baseInp) baseInp.value = p.base;
  } else {
    if (fixedUrl) fixedUrl.style.display = 'none';
    if (rowUrl) rowUrl.style.display = 'block';
    if (baseInp) baseInp.value = p.base || 'http://172.22.20.125:8080/v1';
  }

  const rowKey = document.getElementById('prov-row-key');
  const keyInp = document.getElementById('chat-prov-key');
  const keyLbl = document.getElementById('lbl-prov-f-key');

  if (rowKey) rowKey.style.display = 'block';
  if (keyInp) {
    keyInp.value = p.key || '';
    keyInp.placeholder = p.category === 'Cloud' ? 'sk-…' : (p.key || 'EMPTY (可選/留空)');
  }
  if (keyLbl) {
    keyLbl.textContent = provT('prov_f_key') + (p.category === 'Cloud' ? ' *' : '');
  }

  renderProvModelList(p.suggest || p.models || []);
  const msg = document.getElementById('chat-prov-msg');
  if (msg) msg.textContent = '';
}

// Backward compatibility alias
function selectProvType(id) {
  onSelectProviderName(id);
}

function selectProvType(id) {
  const tt = provTypes().find((p) => p.id === id) || provTypes()[0];
  provCurrentType = tt.id;
  provFetchedModels = [];
  const sel = document.getElementById('prov-type-select');
  if (sel && sel.value !== tt.id) sel.value = tt.id;
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

function formatProvError(err) {
  if (!err) return '';
  const zh = currentLanguage === 'zh';
  const ja = currentLanguage === 'ja';
  if (err.includes('Base URL 不可為空') || err.includes('Base URL cannot be empty') || err.includes('Base URL is required')) {
    return zh ? 'Base URL 不可為空' : (ja ? 'Base URL を入力してください' : 'Base URL cannot be empty');
  }
  if (err.includes('label 與 base URL 不可為空') || err.includes('Label and base URL are required') || err.includes('名稱與 Base URL 不可為空')) {
    return zh ? '供應商名稱與 Base URL 不可為空' : (ja ? 'プロバイダー名と Base URL は必須です' : 'Provider name and Base URL are required');
  }
  return err;
}

function fetchProvModels() {
  const msg = document.getElementById('chat-prov-msg');
  const base = provFormBase();
  const key = provFormKey();
  const zh = currentLanguage === 'zh';
  const ja = currentLanguage === 'ja';

  if (!base) {
    if (msg) msg.textContent = `❌ ${zh ? 'Base URL 不可為空' : (ja ? 'Base URL を入力してください' : 'Base URL cannot be empty')}`;
    return;
  }

  if (msg) msg.textContent = '…';
  fetch('/api/llm/providers/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base, key, strLang: zh ? 'zh' : (ja ? 'ja' : 'en') }),
  })
    .then((res) => res.json())
    .then((d) => {
      if (d.ok && d.models && d.models.length) {
        renderProvModelList(d.models.slice(0, 300));
        if (msg) msg.textContent = `✅ ${provT('prov_ok_models')(d.models.length, d.kind || '')}`;
      } else {
        renderProvModelList([]);
        if (msg) msg.textContent = `❌ ${formatProvError((d && d.error) || 'empty')}`;
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
  const zh = currentLanguage === 'zh';
  const ja = currentLanguage === 'ja';

  const base = provFormBase();
  if (!base) {
    if (msg) msg.textContent = `❌ ${zh ? 'Base URL 不可為空' : (ja ? 'Base URL を入力してください' : 'Base URL cannot be empty')}`;
    return;
  }

  const pDef = provTypes().find(x => x.id === provCurrentType) || {};
  const provLabel = pDef.label || val('chat-prov-label') || provCurrentType;

  if (!provFetchedModels.length || !picked) {
    if (msg) msg.textContent = `❌ ${provT('prov_models_empty')}`;
    return;
  }
  const payload = {
    label: provLabel,
    base: base,
    key: provFormKey(),
    models: provFetchedModels,
    strLang: zh ? 'zh-TW' : 'en-US',
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
        showToast(currentLanguage === "zh" ? "✅ 已成功儲存並啟用供應商！" : "✅ Provider saved & activated!");
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


function bindMarkdownInternalLinks(container) {
  if (!container) return;
  const nodes = (masterGraphData.nodes && masterGraphData.nodes.length) ? masterGraphData.nodes : (rawData.nodes || []);

  // 1. Interactive Internal Links (Colorized with 3D Galaxy ball colors)
  container.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href');
    if (!href) return;
    // A1: Never intercept external web URLs, protocols, or mailto
    if (/^(https?:|\/\/|mailto:|ftp:)/i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      return;
    }
    // A0: Tag-page links belong to the concept-link interceptor below —
    // leave them alone or the doc opener swallows tag clicks.
    // (Matches raw href: CJK names stay percent-encoded here, but the
    // ASCII ".docgraphical/tags/" segment never is.)
    if (/\.docgraphical\/tags\//i.test(href)) return;
    // Intercept internal markdown links (.md or #anchor)
    let dec = href;
    try { dec = decodeURIComponent(href); } catch (e) {}
    if (dec.toLowerCase().endsWith('.md') || dec.includes('.md#') || dec.startsWith('#')) {
      a.style.cursor = 'pointer';

      // Dynamically match and colorize link to reflect 3D node ball color
      let matchedKind = 'file';
      if (dec.includes('#')) {
        const hName = decodeURIComponent(dec.split('#')[1] || '').trim().toLowerCase();
        const foundH = nodes.find(n => (n.kind || '').startsWith('heading') && (n.name || '').trim().toLowerCase() === hName);
        if (foundH) matchedKind = foundH.kind;
        else matchedKind = 'heading_2';
      }
      const ballColor = KIND_COLORS[matchedKind] || '#f0883e';
      a.style.color = ballColor;
      a.style.fontWeight = matchedKind === 'file' ? '600' : '500';

      a.onclick = function(e) {
        e.preventDefault();
        navigateToMarkdownTarget(dec);
      };
    }
  });

  // 2. Interactive Headings Drill-Down in ALL Markdown Documents
  // Any H1~H6 in the viewer can be clicked to drill-down into its sliced section!
  container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(hEl => {
    const headingText = hEl.textContent.replace(/🔍.*$/, '').trim();
    if (!headingText) return;
    hEl.title = `🎯 Click to drill down into section: "${headingText}"`;
    hEl.onclick = function(e) {
      e.stopPropagation();
      const curFile = (viewCtx && viewCtx.file) ? viewCtx.file : (activeNode ? (activeNode.file || activeNode.abs_path || '') : '');
      dispatchUnifiedSelection({ file: curFile, heading: headingText });
    };
  });
}

// Intercept and resolve markdown images (![alt](path))
function resolveMarkdownImages(container, docFilePath) {
  if (!container) return;
  container.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src');
    if (!src) return;
    // Don't modify web URLs or data URIs
    if (/^(https?:|\/\/|data:)/i.test(src)) return;

    // Route through /api/doc/image
    const docParam = docFilePath ? encodeURIComponent(docFilePath) : '';
    const imgParam = encodeURIComponent(src);
    const resolvedUrl = `/api/doc/image?doc=${docParam}&img=${imgParam}`;
    img.src = resolvedUrl;
    img.style.maxWidth = '100%';
    img.style.borderRadius = '6px';
    img.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    img.style.cursor = 'zoom-in';
    img.title = img.alt || '點擊在新分頁開啟全圖';
    img.onclick = function(e) {
      e.stopPropagation();
      window.open(resolvedUrl, '_blank', 'noopener');
    };
  });
}

function navigateToMarkdownTarget(target) {
  if (!target) return;
  let fileTarget = target;
  let headingTarget = '';
  if (target.includes('#')) {
    const parts = target.split('#');
    fileTarget = parts[0];
    headingTarget = decodeURIComponent(parts[1] || '');
  }

  // Resolve target via unified pipeline
  dispatchUnifiedSelection({ file: fileTarget, heading: headingTarget });
}


// ═══════════════════════════════════════════════════════════════════════════
// 🌟 UNIFIED SELECTION PIPELINE (唯一真中樞選取管路)
// ═══════════════════════════════════════════════════════════════════════════
function dispatchUnifiedSelection(target, options = {}) {
  if (!target) return;
  const nodes = (masterGraphData.nodes && masterGraphData.nodes.length) ? masterGraphData.nodes : (rawData.nodes || []);
  let targetNode = null;

  // Case A: target is already a node object
  if (typeof target === 'object' && target.id && target.kind) {
    targetNode = target;
  }
  // Case B: target is a node ID string
  else if (typeof target === 'string' && (target.startsWith('file::') || target.startsWith('heading::') || target.startsWith('concept::'))) {
    targetNode = nodes.find(n => n.id === target);
  }
  // Case C: target is a descriptor { file, heading }
  else if (typeof target === 'object' && (target.file || target.heading)) {
    const cleanFile = (target.file || '').replace(/\\/g, '/').toLowerCase();
    const targetBase = cleanFile.split('/').pop();
    const hText = (target.heading || '').trim().toLowerCase();

    if (hText) {
      // Find matching heading node
      targetNode = nodes.find(n => {
        if (!n.kind || !n.kind.startsWith('heading')) return false;
        const nFile = (n.file || n.abs_path || '').replace(/\\/g, '/').toLowerCase();
        const fileMatch = !targetBase || nFile.endsWith(targetBase);
        const nameMatch = (n.name || '').trim().toLowerCase() === hText || (n.name || '').trim().toLowerCase().includes(hText);
        return fileMatch && nameMatch;
      });
    }

    if (!targetNode && targetBase) {
      // Fallback to file node
      targetNode = nodes.find(n => {
        if (n.kind !== 'file') return false;
        const nFile = (n.file || n.abs_path || n.name || '').replace(/\\/g, '/').toLowerCase();
        return nFile.endsWith(targetBase);
      });
    }
  }

  // If node resolved from AST graph:
  if (targetNode) {
    if (targetNode.kind === 'concept') {
      if (typeof switchActivityTab === 'function') switchActivityTab('concepts', true);
      onConceptCardClick(targetNode.name);
      return;
    }
    // Automatically switch left drawer to Explorer for documents/headings
    if (typeof switchActivityTab === 'function') switchActivityTab('explorer', true);

    // 1. Sync Explorer Selection (open parent folders/files, select target heading/file, smooth scroll)
    syncExplorerSelection(targetNode);

    // 1b. "Child highlights upward" (concept learned from codegraph-galaxy):
    // Drill-down display is TEMPORARY: recompute tempRevealIds as this
    // selection's upward chain (node → … → H1 → file). hiddenKinds / legend
    // are NEVER touched — a kind stays drawn only while the current
    // selection's chain needs it (clicking back up re-hides the lower kinds).
    const chainIds = chainIdsUpward(targetNode);
    let revealChanged = chainIds.length !== tempRevealIds.size;
    if (!revealChanged) {
      for (const id of chainIds) { if (!tempRevealIds.has(id)) { revealChanged = true; break; } }
    }
    if (revealChanged) {
      const next = new Set(chainIds);
      // Tidy: park sprites of nodes leaving the visible set — off-scene state
      // must never look lit if re-attached before the next refresh pass.
      tempRevealIds.forEach(id => {
        if (!next.has(id)) {
          const n = (rawData.nodes || []).find(x => x.id === id);
          if (n && n.__labelSprite && n.__labelSprite.material) n.__labelSprite.material.opacity = 0.0;
        }
      });
      tempRevealIds = next;
      seedChainPositions(chainIds);
      applyLODAndFilter(false); // no auto reframe — focusOnNode owns the camera
    }

    // Synchronize coordinates back to targetNode object if populated in rawData
    const rawTarget = (rawData.nodes || []).find(x => x.id === targetNode.id);
    if (rawTarget && rawTarget.x !== undefined) {
      targetNode.x = rawTarget.x;
      targetNode.y = rawTarget.y;
      targetNode.z = rawTarget.z;
    }

    // 2. Sync 3D Galaxy (focus camera, highlight neighborhood cluster)
    highlightScope('node', targetNode);
    focusOnNode(targetNode);

    // 3. Central Markdown Viewer (fetches sliced section if heading, full doc if file)
    selectActiveNode(targetNode, true);

    showToast(`🎯 Selected [${targetNode.kind.toUpperCase()}]: ${targetNode.name}`);
  } else {
    // Fallback: direct API fetch if node not in index
    console.warn('dispatchUnifiedSelection: target node not indexed in AST graph:', target);
    if (typeof target === 'object' && target.file) {
      const headingQuery = target.heading ? `&heading=${encodeURIComponent(target.heading)}` : '';
      fetch(`/api/doc/section?file=${encodeURIComponent(target.file)}${headingQuery}&sub=1`)
        .then(res => res.json())
        .then(data => {
          if (data.content) {
            renderMarkdown(data.content);
            showToast(`📄 Loaded slice: ${target.heading || target.file}`);
          }
        });
    }
  }
}


// ==========================================================================
// VS Code Style Activity Bar & Collapsible Drawer Controller
// ==========================================================================

let currentActivityTab = 'explorer'; // 'explorer' | 'concepts'
let isDrawerCollapsed = false;
// (declared in concepts engine) // 'official' | 'candidates'

function switchActivityTab(tabName, forceOpen = false) {
  const drawer = document.getElementById('left-sidebar-drawer');
  const resizer = document.getElementById('resizer-tree-doc');
  const tabExplorer = document.getElementById('act-tab-explorer');
  const tabConcepts = document.getElementById('act-tab-concepts');
  const tabLint = document.getElementById('act-tab-lint');
  const tabPrompts = document.getElementById('act-tab-prompts');
  const panelExplorer = document.getElementById('tree-panel');
  const panelConcepts = document.getElementById('concepts-panel');
  const panelLint = document.getElementById('lint-panel');
  const panelPrompts = document.getElementById('prompts-panel');

  if (!drawer) return;

  // Clicking currently active tab collapses/expands the drawer (VS Code behavior) unless forceOpen is requested
  if (!forceOpen && currentActivityTab === tabName && !isDrawerCollapsed) {
    isDrawerCollapsed = true;
    drawer.classList.add('collapsed');
    if (resizer) resizer.style.display = 'none';
    if (tabExplorer) tabExplorer.classList.remove('active');
    if (tabConcepts) tabConcepts.classList.remove('active');
    if (tabLint) tabLint.classList.remove('active');
    if (tabPrompts) tabPrompts.classList.remove('active');
    return;
  }

  // Otherwise, ensure drawer is visible and switch panels
  isDrawerCollapsed = false;
  drawer.classList.remove('collapsed');
  if (resizer) resizer.style.display = '';

  currentActivityTab = tabName;

  // Clear active on all tabs and hide all panels
  [tabExplorer, tabConcepts, tabLint, tabPrompts].forEach(t => t && t.classList.remove('active'));
  [panelExplorer, panelConcepts, panelLint, panelPrompts].forEach(p => p && (p.style.display = 'none'));

  if (tabName === 'explorer') {
    if (tabExplorer) tabExplorer.classList.add('active');
    if (panelExplorer) panelExplorer.style.display = 'flex';
  } else if (tabName === 'concepts') {
    if (tabConcepts) tabConcepts.classList.add('active');
    if (panelConcepts) panelConcepts.style.display = 'flex';
    renderConceptsDrawerList();
  } else if (tabName === 'lint') {
    if (tabLint) tabLint.classList.add('active');
    if (panelLint) panelLint.style.display = 'flex';
    // Auto-scan instantly on tab switch (2ms pure SQLite query)
    refreshLintResults(false);
  } else if (tabName === 'prompts') {
    if (tabPrompts) tabPrompts.classList.add('active');
    if (panelPrompts) panelPrompts.style.display = 'flex';
    if (typeof loadPromptsDrawerList === 'function') {
      loadPromptsDrawerList();
    }
  }
}
function toggleTreePanel() {
  switchActivityTab(currentActivityTab || 'explorer');
}


// ─── Real Concepts Registry Engine (Two-Tier Hierarchy & Linking) ─────
let conceptsTreeData = { tree: {}, candidates: [], counts: { official: 0, candidates: 0 } };
let selectedConceptName = null;
let selectedCandidateName = null;
let currentConceptSubTab = 'official';
let expandedCategories = new Set();
let activeConceptLinkedFiles = {}; // cache conceptName -> files list

function getActiveReposParam() {
  const activeRepos = Array.from(selectedProjects).map(pName => {
    const p = (allProjectsList || []).find(x => x.name === pName);
    return p ? p.path : '';
  }).filter(Boolean);
  if (activeRepos.length > 0) return activeRepos.join(',');
  const p = getActiveRepoPath();
  return p || '';
}

function getActiveRepoPath() {
  if (viewCtx && viewCtx.repo) return viewCtx.repo;
  const curProj = (allProjectsList || []).find(p => selectedProjects.has(p.name));
  if (curProj && curProj.path) return curProj.path;
  if (allProjectsList && allProjectsList.length > 0 && allProjectsList[0].path) {
    return allProjectsList[0].path;
  }
  return '';
}

function switchConceptSubTab(subTab) {
  currentConceptSubTab = subTab;
  const btnOfficial = document.getElementById('btn-cpt-official');
  const btnCandidates = document.getElementById('btn-cpt-candidates');
  const btnBlacklist = document.getElementById('btn-cpt-blacklist');
  if (btnOfficial) btnOfficial.classList.toggle('active', subTab === 'official');
  if (btnCandidates) btnCandidates.classList.toggle('active', subTab === 'candidates');
  if (btnBlacklist) btnBlacklist.classList.toggle('active', subTab === 'blacklist');
  renderConceptsDrawerList();
}

function filterConcepts(kw) {
  renderConceptsDrawerList(kw);
}

function clearConceptFilter() {
  const inp = document.getElementById('concept-search');
  if (inp) inp.value = '';
  renderConceptsDrawerList('');
}

function fetchConceptsData() {
  const activeRepos = Array.from(selectedProjects).map(pName => {
    const p = (allProjectsList || []).find(x => x.name === pName);
    return p ? p.path : '';
  }).filter(Boolean);
  const repoParam = activeRepos.length > 0 ? activeRepos.join(',') : (getActiveRepoPath() || '');
  const url = repoParam ? `/api/concepts?repo=${encodeURIComponent(repoParam)}` : '/api/concepts';
  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data.ok) {
        conceptsTreeData = data;
        // Expand all categories by default
        Object.keys(data.tree || {}).forEach(c => expandedCategories.add(c));
        // llm-scan evidence overlay (DF/TF/snippets per mined term).
        // Additive: failure leaves the map empty and the old render intact.
        const evUrl = repoParam ? `/api/concepts/scan/evidence?repo=${encodeURIComponent(repoParam)}` : '/api/concepts/scan/evidence';
        fetch(evUrl)
          .then(r => r.json())
          .then(ev => {
            try { scanEvidenceMap = (ev && ev.evidence) || {}; }
            catch (e) { scanEvidenceMap = {}; }
            return fetchBlacklistData(repoParam);
          })
          .then(() => renderConceptsDrawerList())
          .catch(() => { scanEvidenceMap = {}; renderConceptsDrawerList(); });
      }
    })
    .catch(err => console.error('fetchConceptsData error:', err));
}
// Mining evidence by term (DF/TF/snippets); empty until fetched.
let scanEvidenceMap = {};
// Global blacklist rows (rejected_terms); empty until fetched.
let blacklistData = [];
function fetchBlacklistData(repoParam) {
  const url = repoParam ? `/api/concepts/scan/blacklist?repo=${encodeURIComponent(repoParam)}` : '/api/concepts/scan/blacklist';
  return fetch(url).then(r => r.json()).then(d => {
    blacklistData = ((d && d.blacklist) || []).slice();
    return blacklistData;
  }).catch(() => { blacklistData = []; return blacklistData; });
}
// Un-blacklist: term becomes eligible for future scans again.
// restore=true also puts it straight back into the candidates pool.
function unblacklistTerm(name, restore) {
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  fetch('/api/concepts/scan/blacklist/remove', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ term: name, restore: !!restore })
  })
    .then(r => r.json())
    .then(d => {
      if (d && d.ok) {
        showToast(restore
          ? (zh ? `已送回候選池：${name}` : `Returned to candidates: ${name}`)
          : (zh ? `已移出黑名單：${name}（下次掃描可再發現）` : `Un-blacklisted ${name}`));
        if (typeof fetchConceptsData === 'function') fetchConceptsData();
        if (restore && typeof switchConceptSubTab === 'function') switchConceptSubTab('candidates');
      } else {
        showToast('❌ ' + ((d && d.error) || 'remove failed'));
      }
    })
    .catch(err => showToast('❌ ' + err));
}


// Breadcrumb for raw edge source ids. Internals never display (no
// heading::, no L13): doc (orange, opens file) › heading (green, opens at
// line). Colours match KIND_COLORS (file / H2).
function parseRefId(src) {
  let s = String(src || '');
  // Strip multi-repo namespace prefixes like p6:: or p0::
  s = s.replace(/^p\d+::/, '');
  let m = s.match(/^heading::(.+?)::L(\d+)::([\s\S]*)$/);
  if (m) return { kind: 'heading', file: m[1], line: parseInt(m[2], 10) || 1, title: (m[3] || '').trim() };
  m = s.match(/^file::([\s\S]*)$/);
  if (m) return { kind: 'file', file: m[1], line: 1, title: '' };
  return { kind: 'file', file: s, line: 1, title: '' };
}
// Display-only: strip md link syntax ([t](u) -> t, [[t]] -> t). Used by
// crumbs, 3D labels and telemetry so raw `[...](...)` never reaches eyes.
// Node ids truncate long titles mid-URL (`[T](.doc`), so broken trailing
// links are stripped too — otherwise the crumb shows raw markup.
function stripMdLinks(s) {
  return String(s || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\[([^\]]+)\]\([^)]*$/g, '$1');
}
function refCrumbText(src) {
  const p = parseRefId(src);
  const docName = p.file.split(/[\\/]/).pop() || p.file;
  return (p.kind === 'heading' && p.title)
    ? `${docName} › ${stripMdLinks(p.title)}` : docName;
}
// ONE shared node plate: title line (kind colour) + sub line
// (`Kind · file · Line n`). Used by the 3D hover tooltip AND the tag-table
// crumb cell — identical look both places, single source of truth.
// o: {title, kind, level?, file, line?, clickable?} (clickable wires the
// canonical file/section openers; tooltip passes false).
function nodePlateHtml(o) {
  o = o || {};
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (x => String(x));
  const strip = (typeof stripMdLinks === 'function') ? stripMdLinks : (x => String(x || ''));
  const clean = s => String(s || '').replace(/\|/g, '/');
  const noQ = s => String(s || '').replace(/"/g, '');
  const kind = o.kind || 'file';
  const color = (typeof KIND_COLORS !== 'undefined' && KIND_COLORS[kind]) || '#58a6ff';
  let level = o.level;
  if (level == null) { const m = String(kind).match(/(\d+)$/); level = m ? parseInt(m[1], 10) : 1; }
  const kindLabel = kind === 'concept' ? 'Concept Tag'
    : (kind === 'file' ? 'Document' : ('H' + level + ' Section'));
  const rawFile = clean(String(o.file || '').replace(/^p\d+::/, '').replace(/^file::/, ''));
  const docName = rawFile ? (rawFile.split(/[\\/]/).pop() || rawFile) : '';
  const proj = o.project || '';
  const fullDispPath = proj ? `[${proj}] ${rawFile}` : rawFile;
  const title = clean(strip(o.title));
  const line = o.line || 1;
  const js = String(o.file || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let titleHtml, subInner;
  if (kind === 'file') {
    titleHtml = `<span style="color:${color};font-weight:600;${o.clickable ? 'cursor:pointer;' : ''}"${o.clickable ? ` onclick="openFileInEditor('${js}', 1)"` : ''} title="${esc(noQ(fullDispPath))}">${esc(docName || title)}</span>`;
    const fileHtml = o.clickable
      ? `<span style="cursor:pointer;" onclick="openFileInEditor('${js}', 1)" title="${esc(noQ(fullDispPath))}">${esc(rawFile || docName)}</span>`
      : `<span title="${esc(noQ(fullDispPath))}">${esc(rawFile || docName)}</span>`;
    const projPrefix = proj ? `<span style="color:#58a6ff;font-weight:600;margin-right:2px;">[${esc(proj)}]</span> ` : '';
    subInner = `${projPrefix}${fileHtml}`;
  } else {
    const enc = encodeURIComponent(o.title || '').replace(/'/g, '%27');
    const open = o.clickable ? `openHeadingInEditor('${js}', ${line}, '${enc}')` : '';
    titleHtml = `<span style="color:${color};font-weight:600;${o.clickable ? 'cursor:pointer;' : ''}"${o.clickable ? ` onclick="${open}"` : ''} title="${esc(noQ(fullDispPath ? title + ' (' + fullDispPath + ')' : title))}">${esc(title)}</span>`;
    const fileHtml = o.clickable
      ? `<span style="cursor:pointer;" onclick="openFileInEditor('${js}', 1)" title="${esc(noQ(fullDispPath))}">${esc(rawFile || docName)}</span>`
      : `<span title="${esc(noQ(fullDispPath))}">${esc(rawFile || docName)}</span>`;
    const projPrefix = proj ? `<span style="color:#58a6ff;font-weight:600;margin-right:2px;">[${esc(proj)}]</span> ` : '';
    subInner = `${projPrefix}${fileHtml}`;
  }
  return `${titleHtml}<div style="font-size:13px;color:#8b949e;">${subInner}</div>`;
}
function refCrumbHtml(src, optLevel) {
  // Delegates to the ONE shared plate (same look as the 3D tooltip):
  // title line in kind colour + `Kind · file · Line n` sub line.
  const p = parseRefId(src);
  let nodeKind = (p.kind === 'heading') ? 'heading_2' : 'file';
  let nodeLevel = (optLevel != null && optLevel > 0) ? parseInt(optLevel, 10) : null;
  let proj = '';
  try {
    const allN = (typeof masterGraphData !== 'undefined' && masterGraphData && masterGraphData.nodes && masterGraphData.nodes.length)
      ? masterGraphData.nodes
      : ((typeof rawData !== 'undefined' && rawData && rawData.nodes) ? rawData.nodes : []);
    const cleanF = (p.file || '').replace(/\\/g, '/').toLowerCase();
    const fBase = cleanF.split('/').pop();
    const cleanT = (p.title || '').trim().toLowerCase();

    // 1. Direct ID match
    let nd = allN.find(n => n && (n.id === src || (typeof n.id === 'string' && n.id.endsWith('::' + src))));

    // 2. Fallback: match by file and heading text / line
    if (!nd && p.kind === 'heading' && cleanT) {
      nd = allN.find(n => {
        if (!n || !n.kind || !n.kind.startsWith('heading')) return false;
        const nf = (n.file || n.abs_path || '').replace(/\\/g, '/').toLowerCase();
        const fMatch = !fBase || nf.endsWith(fBase);
        const name = (n.name || '').trim().toLowerCase();
        return fMatch && (name === cleanT || name.includes(cleanT) || cleanT.includes(name));
      });
    }

    if (nd) {
      if (nd.kind) nodeKind = nd.kind;
      if (nd.level) nodeLevel = nd.level;
      if (nd.project) proj = nd.project;
    }
  } catch (e) {}

  if (p.kind === 'heading') {
    if (nodeLevel != null && nodeLevel > 0) {
      nodeKind = 'heading_' + nodeLevel;
    } else if (nodeKind === 'heading_2') {
      // Deduce level by title prefix if not found
      if (/^[一二三四五六七八九十]+[、.]/.test(p.title) || /^[A-Z][、.]/.test(p.title) || /^#\s/.test(p.title)) {
        nodeKind = 'heading_1';
        nodeLevel = 1;
      } else if (/^\d+\.\d+/.test(p.title) || /^###\s/.test(p.title)) {
        nodeKind = 'heading_3';
        nodeLevel = 3;
      } else if (/^\d+[、.]/.test(p.title) || /^##\s/.test(p.title)) {
        nodeKind = 'heading_2';
        nodeLevel = 2;
      } else if (/^####\s/.test(p.title)) {
        nodeKind = 'heading_4';
        nodeLevel = 4;
      }
    }
    return nodePlateHtml({ title: p.title, kind: nodeKind, level: nodeLevel, file: p.file, line: p.line, project: proj, clickable: true });
  }
  return nodePlateHtml({ title: (p.file.split(/[\\/]/).pop() || p.file), kind: 'file', file: p.file, line: 1, project: proj, clickable: true });
}

function renderLinkedFilesHtml(conceptName, files, zh) {
  if (!files || files.length === 0) {
    return `<div style="font-size:13px; color:#8b949e; padding:4px 0;">${zh ? '尚無文檔引用此標籤' : 'No files reference this concept'}</div>`;
  }
  let h = `<div style="font-size:13px; color:#58a6ff; font-weight:600; margin-bottom:4px;">📄 ${zh ? '引用文件清單' : 'Referenced Documents'} (${files.length}):</div>`;
  h += '<div style="display:flex; flex-direction:column; gap:4px; max-height:160px; overflow-y:auto;">';
  files.forEach(f => {
    h += `
      <div style="background:#0d1117; border:1px solid #30363d; border-radius:4px; padding:4px 8px; font-size:13px; display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#c9d1d9; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px; display:flex; align-items:center;" title="${escapeHtml(refCrumbText(f.filePath))}">${(f.filePath||'').startsWith('heading::') ? '<span style="color:#58a6ff; font-weight:700; margin-right:4px;">#</span>' : getDocIconSvg('#f0883e')} <span style="margin-left:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${refCrumbHtml(f.filePath)}</span></span>
        <button class="mini-btn" style="color:#f85149; border-color:#da3633; padding:1px 4px; font-size:10px;" onclick="unlinkConcept('${escapeHtml(conceptName)}', '${escapeHtml(f.filePath)}', event)" title="${zh ? '解除關聯並永久排除' : 'Unlink & Exclude'}">✕</button>
      </div>
    `;
  });
  h += '</div>';
  return h;
}

function renderConceptsDrawerList(filterKw = '') {
  const container = document.getElementById('concepts-list-container');
  if (!container) return;
  const zh = currentLanguage === 'zh';
  const ja = currentLanguage === 'ja';
  const kw = (filterKw || '').trim().toLowerCase();

  const countOfficialEl = document.getElementById('count-cpt-official');
  const countCandidatesEl = document.getElementById('count-cpt-candidates');
  const badgeEl = document.getElementById('badge-concept-candidates');

  const offCount = (conceptsTreeData.counts && conceptsTreeData.counts.official) || 0;
  const candCount = (conceptsTreeData.counts && conceptsTreeData.counts.candidates) || 0;
  const blCount = (typeof blacklistData !== 'undefined') ? blacklistData.length : 0;

  if (countOfficialEl) countOfficialEl.innerText = offCount;
  if (countCandidatesEl) countCandidatesEl.innerText = candCount;
  const countBlacklistEl = document.getElementById('count-cpt-blacklist');
  if (countBlacklistEl) countBlacklistEl.innerText = blCount;
  if (badgeEl) {
    badgeEl.innerText = candCount;
    badgeEl.style.display = candCount > 0 ? 'inline-block' : 'none';
  }

  if (currentConceptSubTab === 'candidates') {
    // ─── Render Candidates List ──────────────────────────
    const candidates = (conceptsTreeData.candidates || []).filter(c => {
      if (!kw) return true;
      return c.name.toLowerCase().includes(kw) || (c.aliases && c.aliases.toLowerCase().includes(kw));
    });

    if (candidates.length === 0) {
      container.innerHTML = `<div style="color:#8b949e; font-size:12px; text-align:center; padding:30px 10px;">${zh ? '尚無待審候選標籤' : 'No candidates awaiting review'}</div>`;
      return;
    }

    let h = '<div style="display:flex; flex-direction:column; gap:8px; padding:4px;">';
    // Legend: the two productive sources. (Edge-auto has no entry: with no
    // bracket pipeline it never fires; its blue branch below stays only as
    // a fallback in case hand brackets ever produce one.)
    const SRC_LEGEND = [
      { k: 'mined', icon: '⛏', fg: '#e3b341', label: zh ? '詞頻探勘' : 'Prospect' },
      { k: 'crawl', icon: '🌿', fg: '#3fb950', label: 'Vine' }
    ];
    h += `<div style="display:flex; gap:10px; flex-wrap:wrap; font-size:13px; color:#8b949e; padding:0 2px 2px;">${SRC_LEGEND.map(s => `<span><span style="color:${s.fg};">${s.icon} ${s.label}</span></span>`).join('')}</div>`;
    candidates.forEach(c => {
      // Source is encoded in category: mining (②) vs crawl (③) vs
      // edge-autodiscovery. Distinct colour per source, and never show
      // a bare "0 Refs" (crawl candidates have no edges yet by design).
      const cat = (c.category || '').trim();
      const isCrawl = (cat === 'Vine' || cat === '順藤摸瓜');
      const isAuto = (cat === '待審候選' || cat === '' || cat === 'Uncategorized');
      const col = isCrawl
        ? { bd: '#2ea043', nm: '#3fb950', bg: '#0f2a17', fg: '#3fb950', icon: '🌿', label: 'Vine' }
        : (isAuto
          ? { bd: '#1f6feb', nm: '#58a6ff', bg: '#0d1a2e', fg: '#58a6ff', icon: '🕸', label: zh ? '多檔同框' : 'Cited' }
          : { bd: '#9e6a03', nm: '#f0883e', bg: '#382800', fg: '#e3b341', icon: '⛏', label: zh ? '詞頻探勘' : 'Prospect' });
      const evd = (typeof scanEvidenceMap !== 'undefined') ? scanEvidenceMap[c.name] : null;
      // Crawl candidates have no edges yet — their number IS the staged
      // node count (kept link/tag pairs). Others show mining DF/TF or refs.
      const stagedN = (typeof c.staged === 'number') ? c.staged : (c.refs || 0);
      const pillTxt = isCrawl
        ? (zh ? `${stagedN} 節點暫存` : `${stagedN} staged`)
        : (evd && (evd.df || evd.tf))
          ? (zh ? `出現${evd.df || 0}檔·${evd.tf || 0}次` : `${evd.df || 0} docs·${evd.tf || 0} hits`)
          : `${c.refs} ${zh ? '次引用' : 'Refs'}`;
      const pillTitle = isCrawl ? (zh ? 'Vine 暫存的節點數，轉正後套用' : 'Vine staged nodes; applied on promote') : '';
      const firstEv = (evd && evd.files && evd.files[0]) || null;
      const note = (c.aliases && c.aliases !== 'AI 自動偵測') ? ` · ${escapeHtml(c.aliases)}` : '';
      const isCandSelected = selectedCandidateName === c.name;
      h += `
        <div class="concept-card" id="cpt-cand-${escapeHtml(c.name)}" data-candidate-name="${escapeHtml(c.name)}" style="border:1px ${isCandSelected ? 'solid #388bfd' : 'dashed ' + col.bd}; background:${isCandSelected ? '#131d2e' : '#161b22'}; box-shadow:${isCandSelected ? '0 0 10px rgba(56,139,253,0.35)' : 'none'}; border-radius:6px; padding:10px; cursor:pointer;" onclick="openCandidatePage('${escapeHtml(c.name)}', '${isCrawl ? 'vine' : 'prospect'}', event)" title="${zh ? '點開審核底稿' : 'Open draft review'}">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:600; color:${col.nm}; font-size:14.5px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${col.icon} ${escapeHtml(c.name)}</span>
            <span class="concept-status-pill candidate" title="${escapeHtml(pillTitle)}" style="background:${col.bg}; color:${col.fg}; border:1px solid ${col.bd}; font-size:12px; padding:2px 8px; border-radius:10px; flex-shrink:0;">${pillTxt}</span>
          </div>
          <div style="font-size:13px; color:#8b949e; margin-top:4px;">${zh ? '來源' : 'Source'}: <span style="color:${col.fg};">${col.label}</span>${note}</div>
          ${firstEv ? `<div style="font-size:12.5px; color:#a5d6ff; margin-top:4px; word-break:break-word;" title="${escapeHtml(firstEv.rel || '')}">“${escapeHtml((firstEv.snippet || '').slice(0, 60))}” — ${escapeHtml((firstEv.rel || '').split('/').pop() || '')}</div>` : ''}
          <div class="concept-card-actions" style="display:flex; gap:5px; justify-content:flex-end; margin-top:8px; flex-wrap:wrap;">
            <button class="mini-btn" style="background:transparent; border:1px solid #1f6feb; color:#58a6ff;" onclick="openCardRefresh('${escapeHtml(c.name)}')" title="${zh ? '更新此候選（詞頻重算 / 關聯深度探索）' : 'Refresh this candidate (Prospect / Vine)'}">↻ ${zh ? '更新' : 'Refresh'}</button>
            <button class="mini-btn" style="background:#238636; border-color:#2ea043; color:#fff;" onclick="promoteCandidate('${escapeHtml(c.name)}')">✓ ${zh ? '正式發佈' : (ja ? '承認して適用' : 'Promote')}</button>
            <button class="mini-btn" style="background:#21262d; border-color:#30363d; color:#f85149;" onclick="dismissCandidate('${escapeHtml(c.name)}')">✕ ${zh ? '移除' : 'Remove'}</button>
          </div>
        </div>
      `;
    });
    h += '</div>';
    container.innerHTML = h;
    return;
  }

  if (currentConceptSubTab === 'blacklist') {
    // ─── Render Blacklist (rejected_terms: dismissed, may return) ───
    const rows = (typeof blacklistData !== 'undefined' ? blacklistData : []).filter(b => {
      if (!kw) return true;
      return (b.term || '').toLowerCase().includes(kw);
    });
    if (!rows.length) {
      container.innerHTML = `<div style="color:#8b949e; font-size:12px; text-align:center; padding:30px 10px;">${zh ? '黑名單是空的 — 駁回的候選會進到這裡' : 'Blacklist is empty — dismissed candidates land here'}</div>`;
      return;
    }
    let h = '<div style="display:flex; flex-direction:column; gap:8px; padding:4px;">';
    rows.forEach(b => {
      h += `
        <div class="concept-card" style="border:1px dashed #5a2d2d; background:#161b22; border-radius:6px; padding:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:600; color:#f85149; font-size:14.5px;">🚫 ${escapeHtml(b.term)}</span>
            <span style="font-size:12.5px; color:#8b949e;">${escapeHtml(b.decided_at || '')}</span>
          </div>
          <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:8px;">
            <button class="mini-btn" style="background:transparent; border:1px solid #238636; color:#3fb950; font-size:14px; font-weight:500; padding:5px 14px;" onclick="unblacklistTerm('${escapeHtml(b.term)}', true)" title="${zh ? '送回待審候選池' : 'Return to candidates pool'}">↩ ${zh ? '返回候選' : 'To candidates'}</button>
            <button class="mini-btn" style="background:transparent; border:1px solid #1f6feb; color:#58a6ff; font-size:14px; font-weight:500; padding:5px 14px;" onclick="unblacklistTerm('${escapeHtml(b.term)}', false)" title="${zh ? '只移出黑名單，下次掃描可能再發現' : 'Remove from blacklist only'}">↩ ${zh ? '移出黑名單' : 'Un-blacklist'}</button>
          </div>
        </div>
      `;
    });
    h += '</div>';
    container.innerHTML = h;
    return;
  }

  // ─── Render Official Two-Tier Categories ─────────────
  const tree = conceptsTreeData.tree || {};
  const catNames = Object.keys(tree);

  if (catNames.length === 0) {
    // If counts say we have official concepts but tree was empty due to repo mismatch, force fetch
    if (conceptsTreeData.counts && conceptsTreeData.counts.official > 0) {
      container.innerHTML = `<div style="color:#8b949e; font-size:12px; text-align:center; padding:30px 10px;">⏳ 正在加載正式概念清單...</div>`;
      setTimeout(() => fetchConceptsData(), 300);
      return;
    }
    container.innerHTML = `<div style="color:#8b949e; font-size:12px; text-align:center; padding:30px 10px;">${zh ? '知識庫尚無正式概念，請點擊上方 + New 建立' : 'No concepts defined yet. Click + New to define one.'}</div>`;
    return;
  }

  let html = '<div style="display:flex; flex-direction:column; gap:10px; padding:4px;">';
  catNames.forEach(cat => {
    const rawConcepts = tree[cat] || [];
    const concepts = rawConcepts.filter(c => {
      if (!kw) return true;
      return c.name.toLowerCase().includes(kw) || (c.aliases && c.aliases.toLowerCase().includes(kw));
    });

    if (concepts.length === 0 && kw) return;

    const isExpanded = expandedCategories.has(cat);
    html += `
      <div class="concept-category-block" style="background:#1f242c; border:1px solid #38424f; border-radius:6px; overflow:hidden;">
        <!-- Category Header (Accordion) -->
        <div onclick="toggleCategoryExpand('${escapeHtml(cat)}')" style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:#161b22; cursor:pointer; user-select:none; border-bottom:${isExpanded ? '1px solid #30363d' : 'none'};">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:10px; color:#8b949e; transition:transform 0.2s; transform:${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'};">▶</span>
            <span style="font-weight:600; font-size:14.5px; color:#58a6ff;">📁 ${escapeHtml(getCategoryDisplayName(cat))}</span>
          </div>
          <span style="font-size:12.5px; background:#282e38; color:#c9d1d9; padding:1px 6px; border-radius:8px;">${concepts.length}</span>
        </div>

        <!-- Concepts Items (Light slate white-gray inner tray) -->
        <div style="display:${isExpanded ? 'flex' : 'none'}; flex-direction:column; gap:6px; padding:8px; background:#262c36;">
    `;

    concepts.forEach(c => {
      const isSelected = selectedConceptName === c.name;
      const linkedFiles = activeConceptLinkedFiles[c.name] || null;
      html += `
        <div class="concept-card" id="cpt-card-${escapeHtml(c.name)}" data-concept-name="${escapeHtml(c.name)}" style="border:1px solid ${isSelected ? '#388bfd' : '#21262d'}; background:${isSelected ? '#131d2e' : '#161b22'}; box-shadow:${isSelected ? '0 0 10px rgba(56,139,253,0.35)' : 'none'}; border-radius:6px; padding:8px; cursor:pointer;" onclick="onConceptCardClick('${escapeHtml(c.name)}', event)">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:600; color:#e2e8f0; font-size:14.5px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">🏷️ ${escapeHtml(c.name)}</span>
            <span class="concept-status-pill official" style="background:#1f6feb22; color:#58a6ff; border:1px solid #388bfd44; font-size:12px; padding:2px 8px; border-radius:10px; flex-shrink:0;">${c.refs} ${zh ? '引用' : 'Refs'}</span>
          </div>
          <div style="font-size:13px; color:#8b949e; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${zh ? '別名' : 'Aliases'}: ${escapeHtml(c.aliases || (zh ? '無' : 'None'))}
          </div>
          <div class="concept-card-actions">
            <button class="mini-btn" onclick="openCardRefresh('${escapeHtml(c.name)}', event)" title="${zh ? '更新此概念（詞頻重算 / 關聯深度探索）' : 'Refresh this concept (Prospect / Vine)'}">↻ ${zh ? '更新' : 'Refresh'}</button>
            <button class="mini-btn" onclick="openEditConceptModal('${escapeHtml(c.name)}', '${escapeHtml(c.category)}', '${escapeHtml(c.aliases || '')}', event)">✏️ ${zh ? '編輯' : (currentLanguage === 'ja' ? '編集' : 'Edit')}</button>
            <button class="mini-btn" onclick="openMergeConceptModal('${escapeHtml(c.name)}', event)">🔗 ${zh ? '合併' : (currentLanguage === 'ja' ? '統合' : 'Merge')}</button>
            <button class="mini-btn" style="color:#f85149; border-color:#da363388;" onclick="deleteConcept('${escapeHtml(c.name)}', event)">🗑️ ${zh ? '刪除' : (currentLanguage === 'ja' ? '削除' : 'Delete')}</button>
          </div>

          <!-- Dynamic Linked Files Drawer Area -->
          <div id="cpt-files-${escapeHtml(c.name)}" style="display:${(isSelected && linkedFiles) ? 'block' : 'none'}; margin-top:8px; border-top:1px dashed #30363d; padding-top:6px;">
            ${renderLinkedFilesHtml(c.name, linkedFiles, zh)}
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

function toggleCategoryExpand(cat) {
  if (expandedCategories.has(cat)) expandedCategories.delete(cat);
  else expandedCategories.add(cat);
  renderConceptsDrawerList();
}

// ─── Bidirectional Linking & Spotlight Engine ───────────────────────

// ─── Tag-Pages & 3D Right-Click Context Menu Engine ──────────────────
let ctxSelectedNode = null;

function hideNodeContextMenu() {
  const m = document.getElementById('graph-node-context-menu');
  if (m) m.style.display = 'none';
}

document.addEventListener('click', () => hideNodeContextMenu());

function openNodeContextMenu(node, event) {
  if (!node) return;
  ctxSelectedNode = node;
  const m = document.getElementById('graph-node-context-menu');
  const nameEl = document.getElementById('ctx-node-name');
  if (!m || !nameEl) return;

  nameEl.innerText = `${(node.kind || 'node').toUpperCase()}: ${node.name || 'Unnamed'}`;
  m.style.left = `${Math.min(window.innerWidth - 200, event.clientX || 100)}px`;
  m.style.top = `${Math.min(window.innerHeight - 150, event.clientY || 100)}px`;
  m.style.display = 'block';
}

function ctxActionOpenViewer() {
  hideNodeContextMenu();
  if (ctxSelectedNode) {
    dispatchUnifiedSelection(ctxSelectedNode);
  }
}

function ctxActionAttachTag() {
  hideNodeContextMenu();
  if (!ctxSelectedNode) return;
  // If heading node, pass file and heading
  const file = ctxSelectedNode.file || ctxSelectedNode.abs_path || '';
  const heading = ctxSelectedNode.kind !== 'file' ? ctxSelectedNode.name : '';
  openAttachTagToSpecificTarget(file, heading);
}

function ctxActionCopyMarkdown() {
  hideNodeContextMenu();
  if (ctxSelectedNode && ctxSelectedNode.content) {
    navigator.clipboard.writeText(ctxSelectedNode.content);
    showToast('📋 已複製 Markdown 內容！');
  }
}

// ─── Click Concept -> Load Tag-Page in Center Markdown Viewer ───────


// ─── In-App Cyber Confirm System (Zero Native Popups) ───────────────
let cyberConfirmCallback = null;

let cyberPromptCallback = null;

function showCyberPrompt(title, msg, defaultValue, onSubmit, options = {}) {
  const modal = document.getElementById('cyber-prompt-modal');
  const tEl = document.getElementById('cyber-prompt-title');
  const mEl = document.getElementById('cyber-prompt-msg');
  const iEl = document.getElementById('cyber-prompt-input');
  const tipEl = document.getElementById('cyber-prompt-tip');
  const okBtn = document.getElementById('btn-cyber-prompt-ok');
  const cancelBtn = document.getElementById('btn-cyber-prompt-cancel');

  if (!modal) {
    const val = prompt(msg, defaultValue || '');
    if (val !== null && onSubmit) onSubmit(val);
    return;
  }

  if (tEl) tEl.innerText = title || '📁 輸入名稱';
  if (mEl) mEl.innerText = msg || '';
  if (iEl) {
    iEl.value = defaultValue || '';
    iEl.placeholder = options.placeholder || '';
  }
  if (tipEl) {
    tipEl.innerText = options.tip || '';
    tipEl.style.display = options.tip ? 'block' : 'none';
  }
  if (okBtn) {
    okBtn.innerText = options.confirmText || (currentLanguage === 'zh' ? '建立' : (currentLanguage === 'ja' ? '作成' : 'Create'));
  }
  if (cancelBtn) {
    cancelBtn.innerText = options.cancelText || (currentLanguage === 'zh' ? '取消' : (currentLanguage === 'ja' ? 'キャンセル' : 'Cancel'));
  }

  cyberPromptCallback = onSubmit;
  modal.style.display = 'flex';
  setTimeout(() => {
    if (iEl) {
      iEl.focus();
      iEl.select();
    }
  }, 60);
}

function submitCyberPrompt() {
  const iEl = document.getElementById('cyber-prompt-input');
  const val = iEl ? (iEl.value || '').trim() : '';
  closeCyberPrompt(val);
}

function closeCyberPrompt(val) {
  const modal = document.getElementById('cyber-prompt-modal');
  if (modal) modal.style.display = 'none';
  if (val !== null && typeof cyberPromptCallback === 'function') {
    cyberPromptCallback(val);
  }
  cyberPromptCallback = null;
}

function showCyberConfirm(title, msg, onConfirm, options = {}) {
  const modal = document.getElementById('cyber-confirm-modal');
  const tEl = document.getElementById('cyber-confirm-title');
  const mEl = document.getElementById('cyber-confirm-msg');
  const tipEl = document.getElementById('cyber-confirm-tip');
  const okBtn = document.getElementById('btn-cyber-confirm-ok');
  const cancelBtn = document.getElementById('btn-cyber-confirm-cancel');

  if (!modal) {
    if (confirm(msg)) onConfirm();
    return;
  }
  if (tEl) tEl.innerText = title || '⚠ 操作確認';
  if (mEl) mEl.innerText = msg;
  if (tipEl) {
    tipEl.innerText = options.tip || '';
    tipEl.style.display = options.tip ? 'block' : 'none';
  }
  if (okBtn) {
    okBtn.innerText = options.confirmText || (currentLanguage === 'zh' ? '確定' : (currentLanguage === 'ja' ? '確認' : 'Confirm'));
  }
  if (cancelBtn) {
    cancelBtn.innerText = options.cancelText || (currentLanguage === 'zh' ? '取消' : (currentLanguage === 'ja' ? 'キャンセル' : 'Cancel'));
  }
  cyberConfirmCallback = onConfirm;
  modal.style.display = 'flex';
}

function closeCyberConfirm(isConfirmed) {
  const modal = document.getElementById('cyber-confirm-modal');
  if (modal) modal.style.display = 'none';
  if (isConfirmed && typeof cyberConfirmCallback === 'function') {
    cyberConfirmCallback();
  }
  cyberConfirmCallback = null;
}

// ─── Concept Unlink Controller (Clean & Elegant) ────────────────────
function unlinkConcept(conceptName, filePath, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const zh = currentLanguage === 'zh';
  const ja = currentLanguage === 'ja';
  const repo = getActiveRepoPath();

  const title = zh ? '⚠ 解除概念標籤關聯確認' : '⚠ Unlink Concept Confirmation';
  const msg = zh 
    ? `確定要解除「${filePath}」與標籤「${conceptName}」的關聯嗎？
（僅會解除此文件的關聯，不會影響其他引用檔案）`
    : `Unlink '${filePath}' from tag '${conceptName}'? (Other documents will remain untouched)`;

  const tip = zh ? '💡 此操作僅會解除此特定文件與概念標籤的關聯，不會影響其他文檔。' : (ja ? '💡 この操作は該当ファイルとタグの関連付けのみを解除し、他のドキュメントには影響しません。' : '💡 This action only unlinks this specific document from the tag.');
  const confirmText = zh ? '確定解除關聯' : (ja ? 'タグ解除' : 'Unlink');
  const cancelText = zh ? '取消' : (ja ? 'キャンセル' : 'Cancel');

  showCyberConfirm(title, msg, () => {
    fetch('/api/concepts/unlink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, name: conceptName, filePath, rewriteDisk: true })
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          showToast(zh ? `✅ 已成功為「${filePath}」解除「${conceptName}」標籤關聯！` : `✅ Unlinked '${conceptName}'!`);
          fetchConceptsData();
          loadMasterGraphAndFilter();
          setTimeout(() => {
            buildProjectTree();
          }, 120);
          if (selectedConceptName === conceptName) {
            onConceptCardClick(conceptName);
          }
          // Refresh active document editor if currently open
          let cleanDoc = filePath;
          if (cleanDoc.startsWith('heading::')) {
            const p = cleanDoc.split('::');
            if (p.length >= 2) cleanDoc = p[1];
          } else if (cleanDoc.startsWith('file::')) {
            cleanDoc = cleanDoc.substring(6);
          }
          const curF = (viewCtx && viewCtx.file) ? viewCtx.file : '';
          if (curF && (curF.endsWith(cleanDoc) || cleanDoc.endsWith(curF))) {
            if (activeNode) selectActiveNode(activeNode);
            else openFileInEditor(cleanDoc);
          }
        } else {
          alert(data.error || 'Unlink failed');
        }
      })
      .catch(err => alert('Network error: ' + err));
  });
}


// ─── 3D Synchronous Spotlight Engine for Concepts ────────────────────
let userLODHiddenSnapshot = null; // remembers user's chosen LOD filters

function spotlightConceptNode(conceptName) {
  if (!Graph) return;
  activeSpotlightConcept = conceptName;
  applyLODAndFilter(false);

  // Snapshot current hiddenKinds so we can revert when deselecting
  if (!userLODHiddenSnapshot) {
    userLODHiddenSnapshot = new Set(hiddenKinds);
  }

  highlightNodes.clear();
  highlightLinks.clear();

  const gNodes = (rawData && rawData.nodes) ? rawData.nodes : [];
  const gLinks = (rawData && rawData.links) ? rawData.links : [];

  const cid = `concept::${conceptName}`;
  const targetNodes = [];

  // 1. Find the concept node itself (handles multi-repo namespaces e.g. p1::concept::越南廠)
  const cNode = gNodes.find(n => n.id === cid || n.id.endsWith(`::${cid}`) || (n.kind === 'concept' && n.name === conceptName));
  if (cNode) {
    activeNode = cNode;
    highlightNodes.add(cNode.id);
    targetNodes.push(cNode);
  }

  // 2. Trace all connected nodes & links via wiki_link
  let needsGraphDataUpdate = false;
  gLinks.forEach(l => {
    const sId = typeof l.source === 'object' ? l.source.id : l.source;
    const tId = typeof l.target === 'object' ? l.target.id : l.target;
    const isTargetConcept = (tId === cid || tId.endsWith(`::${cid}`) || (cNode && tId === cNode.id));
    const isSourceConcept = (sId === cid || sId.endsWith(`::${cid}`) || (cNode && sId === cNode.id));

    if (isTargetConcept || isSourceConcept) {
      highlightLinks.add(l);
      highlightNodes.add(sId);
      highlightNodes.add(tId);

      const otherId = isTargetConcept ? sId : tId;
      const otherNode = gNodes.find(n => n.id === otherId);
      if (otherNode) {
        targetNodes.push(otherNode);
        // Only temporarily unhide the SPECIFIC other node's kind during focus
        if (hiddenKinds.has(otherNode.kind)) {
          hiddenKinds.delete(otherNode.kind);
          needsGraphDataUpdate = true;
        }
      }
    }
  });

  if (needsGraphDataUpdate) {
    applyLODAndFilter(false);
  }

  // 3. Trigger 3D Glow and Refresh labels
  Graph.nodeColor(Graph.nodeColor())
    .linkColor(Graph.linkColor())
    .linkWidth(l => highlightLinks.has(l) ? 0.7 : 0.12)
    .linkDirectionalParticles(l => highlightLinks.has(l) ? 4 : 0);

  if (typeof updateLabelsVisibility === 'function') updateLabelsVisibility();

  // 3c. Synchronously refresh Connected Relations Panel for the concept node!
  const targetConceptNode = cNode || (gNodes.find(n => n.id === cid || n.id.endsWith(`::${cid}`)));
  if (targetConceptNode && typeof renderConnectedRelationsPanel === 'function') {
    renderConnectedRelationsPanel(targetConceptNode);
  }

  // 4. Smooth 3D Camera Flight directly focusing on the Concept Node (Consistent with focusOnNode)
  const attemptFly = () => {
    const curNodes = (Graph && Graph.graphData) ? (Graph.graphData().nodes || []) : (rawData.nodes || []);
    const curCNode = curNodes.find(n => n.id === cid || n.id.endsWith(`::${cid}`) || (n.kind === 'concept' && n.name === conceptName)) || cNode;
    if (curCNode) {
      focusOnNode(curCNode);
      return true;
    }
    return false;
  };

  if (!attemptFly()) {
    setTimeout(attemptFly, 260);
  } else {
    // Also re-verify after 260ms in case LOD graphData swap finished
    setTimeout(attemptFly, 260);
  }
}

function onConceptCardClick(name, event) {
  if (event && event.target && event.target.tagName && event.target.tagName.toLowerCase() === 'button') return;
  selectedConceptName = name;
  selectedCandidateName = null;
  const zh = currentLanguage === 'zh';
  const repo = getActiveReposParam();

  // 1. Ensure left drawer is on Concepts tab and 'official' subtab
  if (typeof switchActivityTab === 'function') switchActivityTab('concepts', true);
  if (typeof switchConceptSubTab === 'function' && currentConceptSubTab !== 'official') {
    switchConceptSubTab('official');
  }

  // 2. Auto-expand category containing this concept
  try {
    const tree = (conceptsTreeData && conceptsTreeData.tree) || {};
    for (const [cat, items] of Object.entries(tree)) {
      if ((items || []).some(c => c && c.name === name)) {
        expandedCategories.add(cat);
        break;
      }
    }
  } catch (e) {}

  // 3. Fetch Tag Markdown Page across all active repos!
  fetch(`/api/concepts/tag-page?name=${encodeURIComponent(name)}&repo=${encodeURIComponent(repo)}`)
    .then(res => res.json())
    .then(data => {
      if (data.ok) {
        // Cache linked files across all repos
        activeConceptLinkedFiles[name] = data.files || [];
        renderConceptsDrawerList();

        // Scroll selected concept card smoothly into view
        setTimeout(() => {
          const card = document.getElementById(`cpt-card-${name}`) || document.querySelector(`[data-concept-name="${CSS.escape(name)}"]`);
          if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 60);

        // Open Tag Page directly in Markdown Viewer!
        renderConceptTagPageInViewer(data);
      }
    });

  // 4. 3D Spotlight Focus
  spotlightConceptNode(name);
}

function renderConceptTagPageInViewer(tagData) {
  const zh = currentLanguage === 'zh';
  // Browser-history record (tag page view).
  try {
    if (tagData && tagData.concept && typeof navRecord === 'function') {
      navRecord({ view: 'tag', name: tagData.concept });
    }
  } catch (e) {}
  const dName = document.getElementById('d-name');
  const dSub = document.getElementById('d-sub');
  const badge = document.getElementById('d-kind-badge');
  const codeTitle = document.getElementById('d-code-title');

  if (dName) dName.innerText = zh ? `🏷️ ${tagData.concept}（標籤頁）` : `🏷️ ${tagData.concept} (Tag Page)`;
  if (dSub) dSub.innerText = `${tagData.path} · ${tagData.files.length} ${zh ? '個引用文件' : 'Referenced Documents'}`;
  if (badge) {
    badge.innerText = 'TAG';
    badge.style.background = '#8957e5';
    badge.style.color = '#ffffff';
    badge.style.fontWeight = '700';
    badge.style.textShadow = '0 1px 2px rgba(0,0,0,0.7)';
  }
  if (codeTitle) codeTitle.innerText = zh ? '🏷️ 標籤定義與引用管理' : '🏷️ Tag Definition & Reference Manager';

  // Build composite Markdown: Content + Dynamic Link Management Table
  let fullMd = tagData.content + '\n\n---\n\n### 🔗 關聯文檔引用管理 (Referenced Documents)\n';
  if (!tagData.files || tagData.files.length === 0) {
    fullMd += zh ? '\n*(目前尚無任何文檔引用此概念標籤。可在閱讀文檔時點選頂部「🏷️ + 貼標籤」或於 3D 圖右鍵貼上)*\n'
                 : '\n*(No documents cite this tag yet. Click "🏷️ + Tag" at the top while reading, or right-click → paste in 3D.)*\n';
  } else {
    fullMd += zh ? '\n| 序號 | 引用檔案路徑 | 提及段落摘要 | 操作 |\n| :--- | :--- | :--- | :--- |\n'
                 : '\n| # | File | Snippet | Action |\n| :--- | :--- | :--- | :--- |\n';
    tagData.files.forEach((f, idx) => {
      fullMd += `| ${idx + 1} | ${refCrumbHtml(f.filePath)} | ${f.snippet ? f.snippet.replace(/\|/g, '/') : (zh ? '(章節內文)' : '(Section body)')} | <button class="mini-btn" style="color:#f85149; border-color:#da3633; padding:3px 12px; font-weight:600; white-space:nowrap; min-width:54px; display:inline-block;" onclick="unlinkConcept('${tagData.concept}', '${f.filePath}', event)">${zh ? '解除' : (ja ? '解除' : 'Unlink')}</button> |\n`;
    });
  }

  // Set view context
  viewCtx = { project: '', file: tagData.path, repo: tagData.repo || getActiveRepoPath(), heading: '' };
  renderMarkdown(fullMd);
}

// ─── Attach Tag to Current Document or Sliced Section ───────────────
function openAttachTagFromViewer() {
  const zh = currentLanguage === 'zh';
  let curFile = (viewCtx && viewCtx.file) ? viewCtx.file : '';
  let curHeading = (viewCtx && viewCtx.heading) ? viewCtx.heading : '';

  // Fallback to activeNode if viewCtx is not populated yet
  if (!curFile && activeNode) {
    curFile = activeNode.file || activeNode.abs_path || '';
    curHeading = (activeNode.kind !== 'file') ? activeNode.name : '';
  }

  // If user is currently looking at a Concept Tag Page (e.g. .docgraphical/tags/xxx.md)
  if (curFile && (curFile.includes('.docgraphical/tags/') || (activeNode && activeNode.kind === 'concept') || selectedConceptName)) {
    const conceptName = selectedConceptName || (activeNode && activeNode.name) || curFile.split(/[/\\]/).pop().replace(/\.md$/, '');
    openAttachDocumentToConceptModal(conceptName);
    return;
  }

  if (!curFile) {
    showToast(zh ? '⚠ 請先於左側 Explorer 選取任一篇 Markdown 文檔！' : '⚠ Please select a document first!');
    return;
  }

  openAttachTagToSpecificTarget(curFile, curHeading);
}

function openAttachDocumentToConceptModal(conceptName) {
  taggerMode = 'concept_to_file';
  taggerContext = { conceptName, filePath: '', heading: '' };
  const zh = currentLanguage === 'zh';

  const modal = document.getElementById('concept-tagger-modal');
  if (!modal) return;

  const title = document.getElementById('tagger-modal-title');
  const targetLabel = document.getElementById('lbl-tagger-target');
  const targetDisplay = document.getElementById('tagger-target-display');
  const conceptLabel = document.getElementById('lbl-tagger-concept');
  const sel = document.getElementById('sel-tagger-concept') || document.getElementById('tagger-select-item');
  const hint = document.getElementById('tagger-hint');

  if (title) title.innerText = zh ? `🏷️ 為概念「${conceptName}」關聯新文檔` : `🏷️ Link Document to Concept '${conceptName}'`;
  if (targetLabel) targetLabel.innerText = zh ? '概念標籤 (Concept)' : 'Target Concept';
  if (targetDisplay) targetDisplay.innerText = `🏷️ ${conceptName}`;
  if (conceptLabel) conceptLabel.innerText = zh ? '選擇要引用此概念的文檔或章節 (Select Document / Section)' : 'Select Document to Link';

  if (hint) {
    hint.innerText = zh
      ? `將自動在此文檔段落追加 [[${conceptName}]] 概念標籤引用，並即時在 3D 圖建立引力光束！`
      : `Will inject [[${conceptName}]] wiki-link into the chosen document!`;
  }

  if (sel) {
    sel.innerHTML = '';
    const nodes = (rawData && rawData.nodes) ? rawData.nodes : [];
    const docNodes = nodes.filter(n => n.kind === 'file' || n.kind === 'heading_1' || n.kind === 'heading_2');
    
    // Group by file
    const fileGroups = {};
    docNodes.forEach(n => {
      const f = (n.file || n.abs_path || n.name || '').replace(/\\/g, '/');
      if (f.includes('.docgraphical/tags/')) return;
      if (!fileGroups[f]) fileGroups[f] = [];
      if (n.kind !== 'file') fileGroups[f].push(n);
    });

    let count = 0;
    Object.keys(fileGroups).sort().forEach(f => {
      const grp = document.createElement('optgroup');
      grp.label = `📄 ${f.split('/').pop()}`;
      // Add full document option
      const optDoc = document.createElement('option');
      optDoc.value = JSON.stringify({ file: f, heading: '' });
      optDoc.textContent = `📄 ${f} (全文尾部)`;
      grp.appendChild(optDoc);
      count++;

      // Add headings
      fileGroups[f].forEach(hNode => {
        const optH = document.createElement('option');
        optH.value = JSON.stringify({ file: f, heading: hNode.name });
        optH.textContent = `  § ${hNode.name}`;
        grp.appendChild(optH);
        count++;
      });
      sel.appendChild(grp);
    });

    if (count === 0) {
      sel.innerHTML = '<option value="">(暫無可用文檔)</option>';
    }
  }

  modal.classList.add('show');
  modal.style.display = 'flex';
}

function openAttachTagToSpecificTarget(filePath, heading = '') {
  taggerMode = 'file_to_concept';
  taggerContext = { filePath, heading };
  const zh = currentLanguage === 'zh';

  const modal = document.getElementById('concept-tagger-modal');
  if (!modal) return;

  const title = document.getElementById('tagger-modal-title');
  const targetLabel = document.getElementById('lbl-tagger-target');
  const targetDisplay = document.getElementById('tagger-target-display');
  const conceptLabel = document.getElementById('lbl-tagger-concept');
  const sel = document.getElementById('sel-tagger-concept') || document.getElementById('tagger-select-item');
  const hint = document.getElementById('tagger-hint');

  const targetDesc = heading ? `段落「${heading}」` : `文檔「${filePath}」`;
  if (title) title.innerText = zh ? `🏷️ 為 ${targetDesc} 貼上標籤` : `🏷️ Attach Tag to ${targetDesc}`;
  if (targetLabel) targetLabel.innerText = zh ? '目標對象 (Target)' : 'Target';
  if (targetDisplay) targetDisplay.innerText = heading ? `${filePath} > [${heading}]` : filePath;
  if (conceptLabel) conceptLabel.innerText = zh ? '選擇要貼上的概念標籤 (Select Concept)' : 'Select Concept Tag';

  if (hint) {
    hint.innerText = heading
      ? (zh ? `標籤將直接貼入此段落，3D 圖中引力光束將精確連繫該章節小球！` : `Tag will be injected directly under this heading!`)
      : (zh ? `標籤將追加至此文檔末尾，並即時建立拓撲關聯連線！` : `Tag will be appended to file footer!`);
  }

  if (sel) {
    sel.innerHTML = '';
    const tree = (conceptsTreeData && conceptsTreeData.tree) ? conceptsTreeData.tree : {};
    let count = 0;
    Object.keys(tree).forEach(cat => {
      const items = tree[cat] || [];
      if (!items.length) return;
      const grp = document.createElement('optgroup');
      grp.label = `📁 ${cat}`;
      items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.name;
        opt.textContent = `🏷️ ${item.name}`;
        grp.appendChild(opt);
        count++;
      });
      sel.appendChild(grp);
    });

    if (count === 0) {
      sel.innerHTML = '<option value="">(尚無概念標籤，請先至左側抽屜 + 新增)</option>';
    }
  }

  modal.classList.add('show');
  modal.style.display = 'flex';
}

function closeTaggerModal() {
  const modal = document.getElementById('concept-tagger-modal');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
  const errEl = document.getElementById('tagger-modal-error');
  if (errEl) {
    errEl.innerText = '';
    errEl.style.display = 'none';
  }
  taggerContext = { filePath: '', heading: '' };
}

function showTaggerModalError(msg) {
  const errEl = document.getElementById('tagger-modal-error');
  if (errEl) {
    errEl.innerText = `⚠ ${msg}`;
    errEl.style.display = 'block';
  }
}

function submitAttachTagFromModal() {
  submitTaggerModal();
}

function submitTaggerModal() {
  const zh = currentLanguage === 'zh';
  const sel = document.getElementById('sel-tagger-concept') || document.getElementById('tagger-select-item');
  const chosenConcept = sel ? (sel.value || '').trim() : '';
  const btnSubmit = document.getElementById('btn-tagger-submit');

  const errEl = document.getElementById('tagger-modal-error');
  if (errEl) {
    errEl.innerText = '';
    errEl.style.display = 'none';
  }

  if (!chosenConcept) {
    showTaggerModalError(zh ? '請先選擇目標！' : 'Please make a selection first!');
    return;
  }

  let nameToAttach = chosenConcept;
  let filePath = taggerContext.filePath;
  let heading = taggerContext.heading || '';

  if (taggerMode === 'concept_to_file') {
    nameToAttach = taggerContext.conceptName;
    try {
      const parsed = JSON.parse(chosenConcept);
      filePath = parsed.file;
      heading = parsed.heading || '';
    } catch (e) {
      filePath = chosenConcept;
      heading = '';
    }
  }

  // Prioritize activeNode repo or viewCtx repo, fallback to getActiveReposParam
  let repo = (activeNode && activeNode.project) ? ((allProjectsList || []).find(p => p.name === activeNode.project)?.path || '') : '';
  if (!repo && viewCtx && viewCtx.repo) repo = viewCtx.repo;
  if (!repo) repo = getActiveReposParam();

  if (!filePath) {
    showTaggerModalError(zh ? '無法取得目標文件路徑！' : 'Target file path missing!');
    return;
  }

  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerText = zh ? '貼上中...' : 'Attaching...';
  }

  fetch('/api/concepts/attach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo, name: nameToAttach, filePath, heading })
  })
    .then(res => res.json())
    .then(data => {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerText = zh ? '確定貼上' : 'Attach';
      }
      if (data.ok) {
        closeTaggerModal();
        const msg = heading 
          ? (zh ? `✅ 已成功為「${heading}」貼上「${chosenConcept}」！` : `✅ Attached '${chosenConcept}' to '${heading}'!`)
          : (zh ? `✅ 已成功為「${filePath}」貼上「${chosenConcept}」！` : `✅ Attached '${chosenConcept}' to '${filePath}'!`);
        showToast(msg);
        fetchConceptsData();
        activeSpotlightConcept = chosenConcept;
        loadMasterGraphAndFilter();
        setTimeout(() => {
          buildProjectTree();
          spotlightConceptNode(chosenConcept);
        }, 150);

        // Immediately re-fetch and render this document or tag page so the new tag pops up right away!
        if (taggerMode === 'concept_to_file' && nameToAttach) {
          onConceptCardClick(nameToAttach);
        } else if (activeNode && activeNode.kind !== 'concept') {
          selectActiveNode(activeNode);
        } else if (filePath) {
          openFileInEditor(filePath);
        }
      } else {
        showTaggerModalError(data.error || 'Attach failed');
      }
    })
    .catch(err => {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerText = zh ? '確定貼上' : 'Attach';
      }
      showTaggerModalError(err.message || String(err));
    });
}

function openAddConceptModal() {
  openConceptActionModal('add');
}

// Server-spoken display strings (crawl pick reasons, crawl trace) arrive
// in zh; normalize to the UI language so EN mode never shows 直接命中目標.
// (LLM-written content — titles, terms — is left untouched.)
function crawlUiSay(s) {
  const t = String(s || '');
  if ((typeof currentLanguage !== 'undefined' && currentLanguage === 'zh')) return t;
  if (t === '直接命中目標') return 'direct hit';
  let m = t.match(/^標籤 (.*)：CPU 按邊展開，推入 (\d+)$/);
  if (m) return 'tag ' + m[1] + ': CPU expand, +' + m[2];
  m = t.match(/^檔 (.*)：嚮導沒回，跳過$/);
  if (m) return 'file ' + m[1] + ': guide silent, skipped';
  m = t.match(/^檔 (.*)：念 (\d+)，入 (\d+)$/);
  if (m) return 'file ' + m[1] + ': read ' + m[2] + ' terms, push ' + m[3];
  return t;
}
// llm-scan review dialog: settings -> scanning -> results -> confirm.
// State machine in ONE overlay (fixed 480px, grows DOWNWARD, list scrolls
// internally). dry_run proposes; NOTHING is written until Confirm.
let scanDlg = null;
// Scan-scope panel inside the dialog: every repo with its .md files
// (indexed from graph nodes + pending from disk). Repo rows show the outer
// Explorer's selection as DISABLED checkboxes — a ONE-WAY reference
// (Explorer -> dialog). The dialog never writes back, so the outer graph
// stays untouched; to change the scan scope, close the dialog and toggle
// the Explorer. The checked repos are exactly what a Prospect scan covers
// (Vine stays single-repo: the first checked repo).
function renderScanScopeBox() {
  const box = document.getElementById('scan-scope-box');
  if (!box) return;
  const lang = (typeof currentLanguage !== 'undefined') ? currentLanguage : 'en';
  const zh = lang === 'zh', ja = lang === 'ja';
  const projs = (typeof allProjectsList !== 'undefined' && allProjectsList) ? allProjectsList : [];
  if (!projs.length) {
    box.innerHTML = `<div style="font-size:13px;color:#8b949e;">${zh ? '（無專案）' : (ja ? '（プロジェクトなし）' : '(no projects)')}</div>`;
    return;
  }
  // Indexed md files per project, from the same graph data the explorer tree uses.
  const sourceNodes = (typeof masterGraphData !== 'undefined' && masterGraphData && masterGraphData.nodes && masterGraphData.nodes.length > 0)
    ? masterGraphData.nodes
    : ((typeof rawData !== 'undefined' && rawData && rawData.nodes) || []);
  const mdByProj = {};
  sourceNodes.forEach(n => {
    if (n.kind !== 'file') return;
    const proj = getNodeProject(n);
    const rel = (typeof getNodeRelativePathInProject === 'function')
      ? getNodeRelativePathInProject(n, proj) : (n.file || '');
    if (!rel || !rel.toLowerCase().endsWith('.md')) return;
    if (!mdByProj[proj]) mdByProj[proj] = {};
    mdByProj[proj][rel] = true;
  });
  let h = '';
  projs.forEach(p => {
    const isOn = (typeof selectedProjects !== 'undefined') && selectedProjects.has(p.name);
    const mdSet = mdByProj[p.name] || {};
    const extra = (p.pending_files && p.pending_files.length) ? p.pending_files : (p.unindexed_files || []);
    const pendingMd = extra.filter(r => (r || '').toLowerCase().endsWith('.md') && !mdSet[r]);
    const indexedMd = Object.keys(mdSet).sort();
    const total = indexedMd.length + pendingMd.length;
    h += `<div style="border:1px solid ${isOn ? '#1f6feb' : '#21262d'};border-radius:8px;padding:9px 10px;background:${isOn ? '#0d1a2e' : '#161b22'};">`;
    h += `<div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:${isOn ? '#58a6ff' : '#c9d1d9'};">`
       + `<input type="checkbox" data-scope-proj="${escapeHtml(p.name)}" ${isOn ? 'checked' : ''} disabled style="margin:0;flex-shrink:0;width:15px;height:15px;opacity:0.85;" />`
       + `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.name)}</span>`
       + `<span style="margin-left:auto;font-size:13px;color:#8b949e;font-weight:500;flex-shrink:0;">${total} ${zh ? '個 md' : (ja ? '件のmd' : 'md')}</span></div>`;
    if (!total) {
      h += `<div style="font-size:13px;color:#8b949e;margin-top:6px;">${zh ? '（無 .md 檔案）' : (ja ? '（.md ファイルなし）' : '(no .md files)')}</div>`;
    } else {
      h += `<div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">`;
      indexedMd.forEach(rel => {
        h += `<div style="font-size:13.5px;color:#c9d1d9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4;" title="${escapeHtml(rel)}">📄 ${escapeHtml(rel)}</div>`;
      });
      pendingMd.forEach(rel => {
        h += `<div style="font-size:13.5px;color:#e3b341;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4;" title="${escapeHtml(rel)}">📄 ${escapeHtml(rel)} <span style="color:#8b949e;">${zh ? '（待索引）' : (ja ? '（未インデックス）' : '(pending)')}</span></div>`;
      });
      h += `</div>`;
    }
    h += `</div>`;
  });
  box.innerHTML = h;
}
// One-way reference: the outer Explorer is the source of truth for the
// scan scope. If it changes while the dialog is open, refresh the panel
// (the dialog itself never writes back).
function syncScanScopeIfOpen() {
  if (document.getElementById('scan-scope-box')) renderScanScopeBox();
}
function conceptScanAll(btn) {
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const ja = (typeof currentLanguage !== 'undefined' && currentLanguage === 'ja');
  if (document.getElementById('scan-opt-overlay')) return;
  scanDlg = { mode: 'full', maxNew: 3, minTf: 5, items: [], busy: false, dug: 0 };
  const o = document.createElement('div');
  o.id = 'scan-opt-overlay';
  o.style.cssText = 'position:fixed;inset:0;z-index:1000005;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
  o.innerHTML = `
  <div style="width:1000px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column;background:#0d1117;border:1px solid #30363d;border-radius:14px;padding:20px 22px;color:#e6edf3;gap:14px;box-shadow:0 12px 40px rgba(0,0,0,0.7);">
    <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #21262d;padding-bottom:10px;">
      <span style="font-weight:700;font-size:18px;">${zh ? '🔍 發掘新概念' : (ja ? '🔍 新規コンセプト発掘' : '🔍 Discover concepts')}</span>
      <button onclick="document.getElementById('scan-opt-overlay').remove()" style="background:transparent;border:none;color:#8b949e;cursor:pointer;font-size:18px;padding:4px 8px;line-height:1;">✕</button>
    </div>
    <div style="display:flex;gap:16px;flex:1;min-height:0;align-items:stretch;">
      <div style="width:330px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;border:1px solid #21262d;border-radius:10px;padding:12px;max-height:64vh;overflow-y:auto;background:#161b22;">
        <div style="font-size:14.5px;font-weight:700;color:#c9d1d9;">${zh ? '📂 掃描範圍' : (ja ? '📂 スキャン範囲' : '📂 Scan scope')}</div>
        <div style="font-size:13px;color:#8b949e;line-height:1.4;">${zh ? '勾選以左側 Explorer 為準（單向參考）；要調整範圍請先關閉對話框。僅列 .md。' : (ja ? 'チェックは左のExplorerを基準（片方向参照）；範囲を変更するにはまずダイアログを閉じてください（.md のみ）。' : 'Checked state follows the Explorer (one-way reference); close the dialog to adjust the scope. (.md only)')}</div>
        <div id="scan-scope-box" style="display:flex;flex-direction:column;gap:8px;margin-top:4px;"></div>
      </div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:14px;">
    <div id="scan-settings">
      <div style="display:flex;flex-direction:column;gap:10px;">
        <label style="display:flex;gap:12px;align-items:flex-start;border:1px solid #21262d;border-radius:10px;padding:12px 14px;cursor:pointer;background:#161b22;">
          <input type="radio" name="scan-mode" value="full" checked style="margin-top:4px;width:17px;height:17px;cursor:pointer;" />
          <span style="flex:1;line-height:1.4;"><b style="font-size:15.5px;color:#f0f6fc;">${zh ? '① 概念探勘（全庫詞頻探勘）' : (ja ? '① 概念発掘（頻出語句マイニング）' : '① Prospect (corpus frequency)')}</b><br/>
          <span style="font-size:13.5px;color:#8b949e;display:block;margin-top:2px;">${zh ? '先更新詞頻統計，選取高頻新詞由 LLM 評審後依檔案收錄（消耗 1 次 LLM）。' : (ja ? '出現頻度を更新し、高頻度の新語句をLLMで精査して登録します（LLM呼出 1回）。' : 'Refresh counts, then take the top new term; check files to approve (one LLM call).')}</span></span>
        </label>
        <label style="display:flex;gap:12px;align-items:flex-start;border:1px solid #21262d;border-radius:10px;padding:12px 14px;cursor:pointer;background:#161b22;">
          <input type="radio" name="scan-mode" value="crawl" style="margin-top:4px;width:17px;height:17px;cursor:pointer;" />
          <span style="flex:1;min-width:0;line-height:1.4;"><b style="font-size:15.5px;color:#f0f6fc;">${zh ? '② 關聯探索（種子語意深度探索）' : (ja ? '② 関連探索（シード意味探索・Vine）' : '② Vine (seed + DFS)')}</b><br/>
          <span style="font-size:13.5px;color:#8b949e;display:block;margin-top:2px;">${zh ? '輸入檢索主題 → LLM 定位語意關聯點 → 深度遍歷探索 → 產生建議標題並確認。確認前僅暫存不改動檔案，正式發佈後套用。' : (ja ? '検索テーマを入力 → LLMが関連箇所を特定 → 深層探索 → 推奨タイトルを生成・確認。承認するまでファイルは変更されません。' : 'Type what you seek first — LLM finds semantic footholds, then stack-walks (relevant only) to an editable title. Staged, applied on promote.')}</span></span>
        </label>
        <div id="scan-crawl-opts" style="display:none;flex-direction:column;gap:10px;border:1px dashed #30363d;border-radius:10px;padding:12px 14px;background:#090d13;">
          <label style="font-size:14.5px;color:#c9d1d9;font-weight:600;">${zh ? '探索主題或關鍵詞（必填）' : (ja ? '探索テーマ・キーワード（必須）' : 'What do you seek (required)')}
            <input id="scan-crawl-seed" placeholder="${zh ? '如：想找的設備或主題' : (ja ? '例：探したい機器や設計トピック' : 'e.g. equipment or topic you seek')}" style="display:block;width:100%;box-sizing:border-box;margin-top:6px;background:#010409;border:1px solid #30363d;border-radius:8px;padding:9px 12px;color:#e6edf3;font-size:14.5px;" />
            <div style="font-size:13px;color:#8b949e;margin-top:4px;font-weight:400;">${zh ? 'LLM 依此主題定位關聯文件段落，僅保留高關聯性內容。' : (ja ? '入力内容に基づき関連ドキュメントを探索し、関連性の高い段落のみを保持します。' : 'The LLM finds semantic footholds for this text; only related nodes enter the stack.')}</div>
          </label>
          <label style="font-size:14.5px;color:#c9d1d9;font-weight:600;display:flex;align-items:center;gap:10px;">${zh ? '探索檔案上限' : (ja ? '最大探索ファイル数' : 'Max files to read')}
            <input id="scan-crawl-max" type="number" min="1" max="50" value="10" style="width:75px;background:#010409;border:1px solid #30363d;border-radius:8px;padding:7px 10px;color:#e6edf3;font-size:14.5px;" />
            <div style="font-size:13px;color:#8b949e;font-weight:400;">${zh ? '大型儲存庫可調高（1–50）。每 5 個檔案批次呼叫一次 LLM。' : (ja ? '大規模リポジトリでは上限を増やせます（1–50）。5ファイルごとにバッチ呼出。' : 'Raise for big libraries (1-50). Batched: one LLM call per 5 files.')}</div>
          </label>
        </div>
        <div id="scan-full-opts" style="display:none;flex-direction:column;gap:10px;border:1px dashed #30363d;border-radius:10px;padding:12px 14px;background:#090d13;">
          <label style="font-size:14.5px;color:#c9d1d9;font-weight:600;display:flex;align-items:center;gap:10px;">${zh ? '最低出現次數' : (ja ? '最小出現回数' : 'Min occurrences')}
            <input id="scan-min-tf" type="number" min="1" max="999" value="5" style="width:75px;background:#010409;border:1px solid #30363d;border-radius:8px;padding:7px 10px;color:#e6edf3;font-size:14.5px;" />
            <div style="font-size:13px;color:#8b949e;font-weight:400;">${zh ? '排除全庫出現次數過低的詞彙，過濾偶發雜訊。' : (ja ? '出現頻度が低すぎる語句を除外し、ノイズを抑制します。' : 'Ignore terms seen fewer times corpus-wide.')}</div>
          </label>
          <div style="font-size:13px;color:#8b949e;">${zh ? '檔案異動將自動偵測並重新探勘（依 mtime 指紋）。' : (ja ? 'ファイル更新は自動検知され、再発掘されます。' : 'File changes auto-detected via mtime fingerprint.')}</div>
        </div>
      </div>
    </div>
    <div id="scan-settings-done" style="display:none;font-size:13.5px;color:#8b949e;"></div>
    <div id="scan-progress" style="display:none;align-items:center;gap:10px;font-size:15px;color:#58a6ff;font-weight:600;"></div>
    <div id="scan-results" style="display:none;flex-direction:column;gap:8px;overflow-y:auto;max-height:360px;min-height:50px;border:1px solid #21262d;border-radius:10px;padding:12px;background:#010409;"></div>
    <div id="scan-crawl-titlebar" style="display:none;flex-direction:column;gap:8px;border:1px solid #1f6feb;border-radius:10px;padding:12px 14px;background:#0d1a2e;">
      <div style="font-size:13.5px;color:#8b949e;">${zh ? '建議標題（可自訂，確認後收錄至候選池；正式發佈後寫入檔案）：' : (ja ? '推奨タイトル（編集可能・承認後に正式適用）: ' : 'Title (editable, goes to candidates; files written on promote):')}</div>
      <input id="scan-crawl-title" value="" style="background:#010409;border:1px solid #30363d;border-radius:8px;padding:8px 12px;color:#e6edf3;font-size:15px;font-weight:600;width:100%;box-sizing:border-box;" />
    </div>
    <div style="display:flex;gap:12px;align-items:center;margin-top:auto;">
      <button onclick="document.getElementById('scan-opt-overlay').remove()" style="background:transparent;border:1px solid #30363d;color:#c9d1d9;border-radius:8px;padding:9px 18px;font-size:14.5px;cursor:pointer;">${zh ? '取消' : (ja ? 'キャンセル' : 'Cancel')}</button>
      <button id="scan-go-btn" onclick="conceptScanStart()" style="flex:1;background:#1f6feb;border:1px solid #388bfd;color:#fff;border-radius:8px;padding:9px 18px;font-size:15px;cursor:pointer;font-weight:700;">${zh ? '✦ 開始掃描' : (ja ? '✦ 探索を開始' : '✦ Start scan')}</button>
      <button id="scan-confirm-btn" onclick="conceptScanConfirm()" style="display:none;background:#238636;border:1px solid #2ea043;color:#fff;border-radius:8px;padding:9px 20px;font-size:15px;cursor:pointer;font-weight:700;"></button>
    </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(o);
  renderScanScopeBox();
  // Locked: outside clicks do NOT dismiss (scan state + picks would be
  // lost silently). Close only via Cancel / X buttons.
  const radios = o.querySelectorAll('input[name="scan-mode"]');
  const fullBox = o.querySelector('#scan-full-opts');
  const crawlBox = o.querySelector('#scan-crawl-opts');
  const syncModeBoxes = () => {
    const v = o.querySelector('input[name="scan-mode"]:checked').value;
    if (fullBox) fullBox.style.display = v === 'full' ? 'flex' : 'none';
    if (crawlBox) crawlBox.style.display = v === 'crawl' ? 'flex' : 'none';
  };
  radios.forEach(r => r.addEventListener('change', syncModeBoxes));
  syncModeBoxes();
}
// Render the review list as Vine-identical blocks: one block per mined
// term (top-1 per round, highest TF first), sub-rows per evidence file.
// Keep/drop unit = the file row (only checked files get staged); the
// term itself is read-only, unwanted terms are simply left for 繼續挖.
function scanRenderResults() {
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const box = document.getElementById('scan-results');
  if (!box || !scanDlg) return;
  const items = scanDlg.items;
  if (!items.length) {
    box.innerHTML = `<div style="font-size:14px;color:#8b949e;text-align:center;padding:16px;">${zh ? '還沒有候選 — 按開始掃描，或把門檻調低再掃' : 'No candidates yet — start a scan or lower the threshold'}</div>`;
  } else {
    box.innerHTML = items.map((e, i) => {
      const files = e.files || [];
      const sub = files.map((f, fi) => {
        const rel = (f && f.rel) || '';
        const mf = rel.split(/[\\/]/).pop() || rel;
        const full = String((f && f.snippet) || '');
        const sn = full.slice(0, 90);
        return `<div style="display:flex;gap:10px;margin-top:6px;align-items:center;background:#0d1117;padding:6px 10px;border-radius:6px;">`
          + `<div style="flex:1.15;min-width:0;"><div style="font-size:14px;font-weight:600;color:#f0883e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(rel)}">${escapeHtml(mf)}</div></div>`
          + `<div style="flex:1;min-width:0;border-left:1px solid #30363d;padding-left:10px;color:#a5d6ff;font-size:13.5px;line-height:1.4;word-break:break-word;" title="${escapeHtml(full)}">${escapeHtml(sn)}${full.length > 90 ? '…' : ''}</div>`
          + `<input type="checkbox" data-scan-file="${i}:${fi}" checked onclick="scanSubToggle(this)" style="flex-shrink:0;width:17px;height:17px;cursor:pointer;" /></div>`;
      }).join('');
      return `<div data-scan-block="${i}" style="margin-top:6px;border:1px solid #30363d;border-radius:10px;padding:10px 12px;background:#161b22;">`
        + `<label style="display:flex;gap:10px;align-items:center;cursor:pointer;">`
        + `<span style="flex:1;min-width:0;font-size:16px;font-weight:700;color:#f0883e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(e.term)}">▸ ${escapeHtml(e.term)} <span style="font-size:14px;color:#8b949e;font-weight:400;">(${zh ? `出現 ${e.df || 0} 檔 · ${e.tf || 0} 次` : `${e.df || 0} docs · ${e.tf || 0}`})</span></span>`
        + `<input type="checkbox" data-scan-master="${i}" checked onclick="scanFileToggle(this)" style="flex-shrink:0;width:18px;height:18px;cursor:pointer;" /></label>`
        + (e.reason ? `<div style="font-size:13.5px;color:#8b949e;margin-top:4px;padding-left:16px;">💡 ${escapeHtml(e.reason)}</div>` : '')
        + `<div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">${sub}</div>`
        + `</div>`;
    }).join('');
  }
  scanPaintConfirm();
}
function scanPaintConfirm() {
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const btn = document.getElementById('scan-confirm-btn');
  if (!btn || !scanDlg) return;
  if (!scanDlg.items.length) {
    btn.style.display = 'none';
    return;
  }
  const n = document.querySelectorAll('#scan-results [data-scan-file]:checked').length;
  btn.style.display = '';
  btn.disabled = !n;
  btn.style.opacity = n ? '' : '0.45';
  btn.textContent = zh ? '確認收錄' : 'Confirm';
}
// Fires one dry-run round; results APPEND below previous rounds.
  function conceptScanStart() {
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const o = document.getElementById('scan-opt-overlay');
  if (!o || !scanDlg || scanDlg.busy) return;
  const mode = ((o.querySelector('input[name="scan-mode"]:checked') || {}).value || 'full');
  // Decree: one top term per round, no count picking (max_new input retired).
  const maxNew = 1;
  const minTf = parseInt(((o.querySelector('#scan-min-tf') || {}).value || '5'), 10) || 5;
  if (mode === 'crawl') {
    // Emperor crawl: user seed -> LLM semantic footholds -> DFS (LLM per
    // file, LIFO, relevant-only) -> judged staged + ONE recommended title
    // (EDITABLE) -> confirm. Nothing touches disk until a later promote.
    // No seed, no crawl: without the user's text the stack would eat the
    // whole library.
    const seedText = (((o.querySelector('#scan-crawl-seed') || {}).value || '').trim()).slice(0, 200);
    if (!seedText) {
      showToast(zh ? '先打一段要找的字，不打不給摸' : 'Type what you seek first');
      const si = o.querySelector('#scan-crawl-seed');
      if (si) si.focus();
      return;
    }
    const maxFiles = Math.max(1, Math.min(50, parseInt(((o.querySelector('#scan-crawl-max') || {}).value || '10'), 10) || 10));
    scanDlg.mode = mode;
    scanDlg.busy = true;
    const goBtn = o.querySelector('#scan-go-btn');
    if (goBtn) { goBtn.disabled = true; goBtn.textContent = zh ? '關聯探索中…' : 'Crawling…'; }
    const prog = o.querySelector('#scan-progress');
    const resBox = o.querySelector('#scan-results');
    const t0 = Date.now();
    let phase = zh ? '讀總綱選點中' : 'Picking starts';
    const tick = () => {
      if (prog) {
        prog.style.display = 'flex';
        prog.innerHTML = `<span class="ing-spin">◌</span> ${phase}… ${Math.floor((Date.now() - t0) / 1000)}s`;
      }
    };
    tick();
    const timer = setInterval(tick, 500);
    const CS = { run: null, spent: 0, files: 0, steps: 0, pushed: 0 };
    if (resBox) { resBox.style.display = 'flex'; resBox.innerHTML = ''; }
    // Vine layout decree: BIG dialog, ONLY the kept checklist scrolls,
    // everything else fixed. (Prospect keeps template defaults.)
    const dlgBox = o.firstElementChild;
    if (dlgBox) { dlgBox.style.width = '640px'; dlgBox.style.height = 'min(880px, 92vh)'; }
    if (resBox) {
      resBox.style.display = 'flex'; resBox.style.flexDirection = 'column';
      resBox.style.flex = '1'; resBox.style.minHeight = '0';
      resBox.style.overflow = 'hidden'; resBox.style.maxHeight = 'none';
    }
    const line = (html) => {
      if (!resBox) return;
      const d = document.createElement('div');
      d.style.cssText = 'font-size:12px;color:#c9d1d9;border-bottom:1px solid #21262d;padding:4px 2px;';
      d.innerHTML = html;
      resBox.appendChild(d);
      resBox.scrollTop = resBox.scrollHeight;
    };
    const restore = () => {
      clearInterval(timer);
      scanDlg.busy = false;
      if (goBtn) { goBtn.disabled = false; goBtn.textContent = zh ? '✦ 繼續摸' : '✦ Keep crawling'; }
      if (prog) prog.style.display = 'none';
    };
    const snap = (extra) => {
      try { window.__crawlLast = Object.assign({ run: CS.run, spent: CS.spent, files: CS.files, title: CS.title || '' }, extra || {}); } catch (e) {}
    };
    const fail = (msg) => {
      restore();
      line(`<span style="color:#f85149;">❌ ${escapeHtml(msg)}</span>`);
      showToast('❌ ' + msg);
      snap({ err: String(msg).slice(0, 80) });
    };
    const doFinish = () => {
      phase = zh ? '終審薦標題中' : 'Judging + titling';
      tick();
      return fetch('/api/crawl/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: CS.run })
      }).then(r => r.json()).then(f => {
        if (!(f && f.ok)) throw new Error((f && f.error) || 'finish failed');
        CS.spent = f.spent || CS.spent;
        CS.title = f.title || '';
        restore();
        const keptArr = (f.kept || []);
        const keptN = keptArr.length;
        // Per-NODE checklist (nodes are files: staged rows anchor to
        // files, concepts only transit free). Checkbox per md; the terms
        // underneath list WHAT related content that node holds.
        let vineOrder = [];
        let vineByFile = {};
        if (keptN) {
          keptArr.forEach((k, i) => {
            const fk = k.file || '';
            if (!vineByFile[fk]) { vineByFile[fk] = []; vineOrder.push(fk); }
            vineByFile[fk].push(i);
          });
          line(`<b style="font-size:15px;color:#f0f6fc;display:block;margin-bottom:6px;">${zh ? '挖到的（按節點勾留去留）：' : 'Dug up (tick nodes to keep):'}</b>` + vineOrder.map((fk, fi) => {
            const mf = String(fk).split(/[\\/]/).pop() || fk;
            const sub = vineByFile[fk].map(i => {
              const k = keptArr[i];
              const left = (k.heading && k.line)
                ? `<div style="flex:1.15;min-width:0;"><div style="font-size:13.5px;color:#3fb950;font-weight:600;">⤷ ${escapeHtml(String(k.heading).slice(0, 45))} · L${k.line}</div></div>`
                : `<div style="flex:1.15;min-width:0;"><div style="font-size:12px;color:#8b949e;">${zh ? '（僅知檔案）' : '(file only)'}</div></div>`;
              return `<div style="display:flex;gap:10px;margin-top:6px;align-items:center;background:#0d1117;padding:5px 8px;border-radius:6px;">${left}`
                + `<div style="flex:1;min-width:0;border-left:1px solid #30363d;padding-left:10px;color:#f0f6fc;font-size:14px;word-break:break-word;">${escapeHtml(k.term)}</div>`
                + `<input type="checkbox" data-vine-keep="${i}" checked onclick="vineSubToggle(this)" style="flex-shrink:0;width:17px;height:17px;cursor:pointer;" /></div>`;
            }).join('');
            return `<div data-vine-block="${fi}" style="margin-top:6px;border:1px solid #30363d;border-radius:10px;padding:10px 12px;background:#161b22;">`
              + `<label style="display:flex;gap:10px;align-items:center;cursor:pointer;">`
              + `<span style="flex:1;min-width:0;font-size:15px;font-weight:700;color:#f0883e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(fk)}">▸ ${escapeHtml(mf)} <span style="font-size:13.5px;color:#8b949e;font-weight:400;">(${vineByFile[fk].length})</span></span>`
              + `<input type="checkbox" data-vine-file="${fi}" checked onclick="vineFileToggle(this)" style="flex-shrink:0;width:18px;height:18px;cursor:pointer;" /></label>`
              + `<div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">${sub}</div>`
              + `</div>`;
          }).join(''));
        }
        // Plain-words round summary, always (this is the line humans read).
        line(`<span style="color:#8b949e;">${zh ? `― 本輪：讀了 ${CS.files} 檔 · 找到 ${keptN} 個新概念` : `― Round: ${CS.files} files read · ${keptN} new concepts`}</span>`);
        snap({ title: CS.title, kept: keptN });
        if (!keptN && !CS.title) {
          // Empty round: state BOTH facts (expansion + files read), then advice.
          const facts = [];
          if (CS.steps > 0 && CS.pushed === 0) facts.push(zh ? '沿邊 0 新節點' : '0 new nodes from expansion');
          if (CS.files > 0) facts.push(zh ? `讀 ${CS.files} 檔都判無關` : `${CS.files} file(s) read, all unrelated`);
          const why0 = zh ? `種子「${seedText}」：${facts.join('，') || '無暫存'}。換段種子再摸。`
                          : `Seed "${seedText}": ${facts.join(', ') || 'nothing staged'}. Try another seed.`;
          line(`<b style="color:#e3b341;">${zh ? '◇ 本輪沒挖到：' : '◇ Empty round: '}</b>${escapeHtml(why0)}`);
          // Empty round: no title, no confirm (bottom bar stays clean).
          scanDlg.vineKept = []; scanDlg.vineRun = null;
          { const tb = o.querySelector('#scan-crawl-titlebar'); if (tb) tb.style.display = 'none'; }
          { const cb = document.getElementById('scan-confirm-btn'); if (cb) cb.style.display = 'none'; }
          return;
        }
        // Bottom confirm, same slot as Prospect: editable title lands in
        // the fixed title bar, green confirm sits bottom-right beside
        // 繼續摸 (no mid-list confirm box anymore).
        scanDlg.vineKept = keptArr.slice();
        scanDlg.vineRun = CS.run;
        const titleBar = o.querySelector('#scan-crawl-titlebar');
        const titleInp = o.querySelector('#scan-crawl-title');
        if (titleInp) {
          titleInp.value = CS.title || '';
          titleInp.oninput = () => { if (typeof vinePaintConfirm === 'function') vinePaintConfirm(); };
        }
        if (titleBar) titleBar.style.display = 'flex';
        // Auto-seed: 續挖 defaults to the recommended title so the user
        // can edit the title and immediately click 繼續摸 without retyping.
        const seedInp = o.querySelector('#scan-crawl-seed');
        if (seedInp && CS.title) seedInp.value = CS.title;
        if (typeof vinePaintConfirm === 'function') vinePaintConfirm();
        else { const cb = document.getElementById('scan-confirm-btn'); if (cb) { cb.style.display = ''; cb.textContent = zh ? '確認收錄' : 'Confirm'; } }
        snap({ title: CS.title, kept: (f.kept || []).length });
      });
    };
    fetch('/api/crawl/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: (typeof getActiveRepoPath === 'function') ? getActiveRepoPath() : '', seed: seedText, lang: zh ? 'zh' : 'en' })
    }).then(r => r.json()).then(d => {
      if (!(d && d.ok)) {
        const g = (d && d.guide_text) ? '\n' + d.guide_text : '';
        throw new Error(((d && d.error) || 'start failed') + g);
      }
      CS.run = d.run_id;
      CS.spent = 1;
      const repoTail = String(d.repo || '').split(/[/\\]/).filter(Boolean).pop() || '';
      // Starts: one per line (count + trimmed name), never comma soup.
      const pickArr = (d.picks || []);
      const pickLines = pickArr.map(p => {
        const nm = String(p.name || '');
        const short = nm.length > 36 ? nm.slice(0, 36) + '…' : nm;
        const why = crawlUiSay(p.why) || '?';
        return zh ? `・${escapeHtml(short)}（${escapeHtml(why)}）` : `・${escapeHtml(short)} (${escapeHtml(why)})`;
      }).join('<br/>');
      line(`<b style="color:#58a6ff;">${zh ? `✦ 探索「${escapeHtml(seedText)}」關聯節點，起始共 ${pickArr.length} 個（目錄選取${repoTail ? '@' + repoTail : ''}）：` : `✦ Crawling for "${escapeHtml(seedText)}" — ${pickArr.length} starts (catalog picks${repoTail ? '@' + repoTail : ''}):`}</b>${pickLines ? '<br/>' + pickLines : ''}`);
      // GC sweep runs silently — housekeeping, not user-facing news.
      snap();
      phase = zh ? '逐檔摸索中' : 'Crawling files';
      tick();
      const step = () => fetch('/api/crawl/next', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: CS.run, max_files: maxFiles })
      }).then(r => r.json()).then(n => {
        if (!(n && n.ok)) throw new Error((n && n.error) || 'next failed');
        CS.spent = (typeof n.spent === 'number') ? n.spent : CS.spent;
        // Batched rounds return batch:[{node,kind,concepts,pushed}]; the
        // older single-node shape (node/kind/pushed) still works as 1 item.
        const items = Array.isArray(n.batch) && n.batch.length
          ? n.batch
          : (n.node ? [{ node: n.node, kind: n.kind, pushed: n.pushed || [] }] : []);
        // Plain-human rounds (emperor's decree): file names ONLY.
        // No 念/入, kept/queued, fan-out, or trace jargon. Names prove
        // the crawl is alive; the phase counter (x/10 read) is primary.
        const rnames = [];
        items.forEach(it => {
          CS.steps++;
          CS.pushed += ((it.pushed || []).length);
          if (it.kind === 'file') {
            CS.files++;
            const nm = String(it.node || '');
            rnames.push(nm.length > 32 ? '…' + nm.slice(-32) : nm);
          }
        });
        if (rnames.length) {
          const shown = escapeHtml(rnames.join(zh ? '、' : ', '));
          if (n.error) {
            line(`<span style="color:#e3b341;">⚠ ${shown} ${zh ? '未判讀，已跳過' : 'skipped (unreadable)'}</span>`);
          } else {
            line(`<span style="color:#8b949e;">📄 ${shown}</span>`);
          }
        }
        phase = zh ? `逐檔摸索中（已讀 ${CS.files}/${maxFiles}，候選 ${CS.steps}）` : `Crawling files (${CS.files}/${maxFiles} read, ${CS.steps} rounds)`;
        tick();
        snap();
        if (n.done) return doFinish();
        return step();
      });
      return step();
    }).catch(err => fail(err && err.message ? err.message : String(err)));
    return;
  }
  scanDlg.mode = mode; scanDlg.maxNew = maxNew; scanDlg.minTf = minTf;
  // Prospect rounds never show the Vine title bar.
  { const tb = o.querySelector('#scan-crawl-titlebar'); if (tb) tb.style.display = 'none'; }
  scanDlg.busy = true;
  // Settings stay visible and editable across rounds: Dig more always
  // reads live values, so thresholds can be tuned between rounds.
  const stDone = o.querySelector('#scan-settings-done');
  if (stDone) { stDone.style.display = 'none'; }
  const goBtn = o.querySelector('#scan-go-btn');
  if (goBtn) { goBtn.disabled = true; goBtn.textContent = zh ? '掃描中…' : 'Scanning…'; }
  const prog = o.querySelector('#scan-progress');
  const t0 = Date.now();
  const tick = () => {
    if (prog) {
      prog.style.display = 'flex';
      prog.innerHTML = `<span class="ing-spin">◌</span> ${zh ? '挖礦評審中' : 'Mining'}… ${Math.floor((Date.now() - t0) / 1000)}s`;
    }
  };
  tick();
  const timer = setInterval(tick, 500);
  const seen = scanDlg.items.map(e => e.term);
  fetch('/api/concepts/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // Scope = the CHECKED repos (shared selectedProjects, same as the
    // Explorer tree + the dialog's scope panel). Empty selection falls
    // back to the active repo; the server fans out over the comma list
    // with the shared budget.
    body: JSON.stringify({ mode, max_new: maxNew, min_tf: minTf, dry_run: true, exclude: seen,
      repo: (typeof getActiveReposParam === 'function') ? getActiveReposParam() : '' })
  })
    .then(r => r.json())
    .then(d => {
      clearInterval(timer);
      scanDlg.busy = false;
      if (goBtn) { goBtn.disabled = false; goBtn.textContent = zh ? '✦ 繼續挖' : '✦ Dig more'; }
      if (prog) prog.style.display = 'none';
      const got = ((d && d.inserted) || []).filter(x => x && x.term);
      if (d && d.ok && got.length) {
        got.forEach(x => {
          if (!scanDlg.items.some(e => e.term === x.term)) {
            scanDlg.items.push({ term: x.term, df: x.df || 0, tf: x.tf || 0,
              files: x.files || [], reason: x.reason || '', repo: x.repo || '',
              checked: true, rejected: false });
          }
        });
      } else if (d && d.ok) {
        // Empty round, but SAY WHY (mined/judged come back in the
        // response): dry well vs all-decided vs judge-rejected.
        const minedN = d.mined || 0, judgedN = d.judged || 0;
        showToast(zh
          ? (minedN <= 0 ? '本次未發現新候選詞（庫內無詞頻統計：尚未建立索引或請切換儲存庫）'
            : (judgedN > 0 ? `本次未發現新候選詞（LLM 評審 ${judgedN} 個詞彙均未達收錄標準）`
              : `本次未發現新候選詞（掃描 ${minedN} 個高頻詞，均已收錄、列入黑名單或已處理）`))
          : (minedN <= 0 ? 'No new faces (nothing mined — unindexed?)'
            : (judgedN > 0 ? `No new faces (LLM judged ${judgedN}, kept none)`
              : `No new faces (${minedN} mined, all decided)`)));
      } else {
        showToast('❌ ' + ((d && d.error) || 'scan failed'));
      }
      const resBox = o.querySelector('#scan-results');
      if (resBox) resBox.style.display = 'flex';
      scanRenderResults();
    })
    .catch(err => {
      clearInterval(timer);
      scanDlg.busy = false;
      if (goBtn) { goBtn.disabled = false; goBtn.textContent = zh ? '✦ 繼續挖' : '✦ Dig more'; }
      if (prog) prog.style.display = 'none';
      showToast('❌ ' + err);
    });
}
// Vine bottom confirm paint (same slot as Prospect's scanPaintConfirm:
// green button bottom-right, enabled only with a non-empty title).
function vinePaintConfirm() {
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const o = document.getElementById('scan-opt-overlay');
  const btn = document.getElementById('scan-confirm-btn');
  if (!o || !btn || !scanDlg) return;
  const titleInp = o.querySelector('#scan-crawl-title');
  const ok = !!((titleInp || {}).value || '').trim();
  btn.style.display = '';
  btn.disabled = !ok;
  btn.style.opacity = ok ? '' : '0.45';
  btn.textContent = zh ? '確認收錄' : 'Confirm';
}
// Vine confirm: title + checked node rows -> candidate pool (same
// FnCrawlConfirm as the old mid-list button used).
function vineConfirmGo() {
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const o = document.getElementById('scan-opt-overlay');
  if (!o || !scanDlg || scanDlg.busy) return;
  const t = (((o.querySelector('#scan-crawl-title') || {}).value) || '').trim();
  if (!t) { showToast(zh ? '標題不能為空，請輸入標題後再確認' : (currentLanguage === 'ja' ? 'タイトルを入力してください' : 'Title is empty — type one first')); return; }
  const keptArr = scanDlg.vineKept || [];
  // 去留以有內文的節點列為準（md 勾只是總開關）；只送勾的 pairs。
  const pairs = [...document.querySelectorAll('#scan-results [data-vine-keep]:checked')]
    .map(cb => keptArr[parseInt(cb.getAttribute('data-vine-keep'), 10)])
    .filter(Boolean)
    .map(k => ({ term: k.term, file: k.file }));
  if (!pairs.length) { showToast(zh ? '至少留一個，否則無需確認' : (currentLanguage === 'ja' ? '最低1つの項目を選択してください' : 'Keep at least one item')); return; }
  fetch('/api/crawl/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run_id: scanDlg.vineRun, title: t, keep: pairs })
  }).then(r => r.json()).then(d => {
    if (d && d.ok) {
      showToast(zh ? `已進候選池：${d.title}` : `Candidate: ${d.title}`);
      try { window.__crawlLast = Object.assign(window.__crawlLast || {}, { confirmed: d.title }); } catch (e) {}
      o.remove();
      scanDlg = null;
      if (typeof fetchConceptsData === 'function') fetchConceptsData();
      if (typeof switchConceptSubTab === 'function') switchConceptSubTab('candidates');
    } else {
      showToast('❌ ' + ((d && d.error) || 'confirm failed'));
    }
  }).catch(err => showToast('❌ ' + err));
}
// Commit checked as candidates + rejected to blacklist, then close.
function conceptScanConfirm() {
  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const o = document.getElementById('scan-opt-overlay');
  if (!o || !scanDlg || scanDlg.busy) return;
  // Vine confirms through the SAME bottom slot (title bar + green button).
  if (scanDlg.mode === 'crawl') { vineConfirmGo(); return; }
  // Prospect: approve carries only CHECKED files per term (Vine-identical
  // keep/drop); terms with nothing checked are simply left for 繼續挖.
  // There is no separate reject list here: unchecked files are just
  // skipped (not blacklisted), so the payload is { approve } only.
  const approve = [];
  const _seenTerms = new Set();
  scanDlg.items.forEach((e, i) => {
    const t = (e.term || '').trim().slice(0, 30);
    if (!t || _seenTerms.has(t)) return;
    const files = (e.files || []).filter((f, fi) => {
      const cb = document.querySelector(`#scan-results [data-scan-file="${i}:${fi}"]`);
      return cb && cb.checked;
    });
    if (!files.length) return;
    _seenTerms.add(t);
    approve.push({ term: t, df: e.df || 0, tf: e.tf || 0, files, reason: e.reason || '', repo: e.repo || '' });
  });
  if (!approve.length) { showToast(zh ? '至少留一個檔案，否則無需確認' : 'Keep at least one file'); return; }
  scanDlg.busy = true;
  fetch('/api/concepts/scan/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approve })
  })
    .then(r => r.json())
    .then(d => {
      scanDlg.busy = false;
      if (d && d.ok) {
        o.remove();
        scanDlg = null;
        const nApproved = new Set(d.approved || []).size;
        showToast(zh ? `已收錄 ${nApproved} 個，黑名單 ${d.rejected.length} 個`
                     : `Approved ${nApproved}, blacklisted ${d.rejected.length}`);
        if (typeof fetchConceptsData === 'function') fetchConceptsData();
        if (typeof switchConceptSubTab === 'function') switchConceptSubTab('candidates');
      } else {
        showToast('❌ ' + ((d && d.error) || 'confirm failed'));
      }
    })
    .catch(err => { scanDlg.busy = false; showToast('❌ ' + err); });
}

function openEditConceptModal(name, category, aliases, event) {
  if (event) event.stopPropagation();
  openConceptActionModal('edit', { name, category, aliases });
}

function openMergeConceptModal(sourceName, event) {
  if (event) event.stopPropagation();
  openConceptActionModal('merge', { sourceName });
}

function promoteCandidate(name) {
  openConceptActionModal('promote', { name });
}

function dismissCandidate(name) {
  const zh = currentLanguage === 'zh';
  if (document.getElementById('dismiss-opt-overlay')) return;
  const o = document.createElement('div');
  o.id = 'dismiss-opt-overlay';
  o.style.cssText = 'position:fixed;inset:0;z-index:1000005;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
  o.innerHTML = `
  <div style="width:420px;max-width:92vw;background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:16px;color:#e6edf3;display:flex;flex-direction:column;gap:10px;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="font-weight:600;font-size:15px;">${zh ? `移除「${escapeHtml(name)}」？` : `Remove "${escapeHtml(name)}"?`}</span>
      <button onclick="document.getElementById('dismiss-opt-overlay').remove()" style="background:transparent;border:none;color:#8b949e;cursor:pointer;font-size:15px;">✕</button>
    </div>
    <button onclick="dismissCandidateGo('blacklist', '${escapeHtml(name)}')" title="${zh ? '以後掃描不再出現此詞' : 'Never surface this term in future scans'}" style="text-align:left;background:transparent;border:1px solid #5a2d2d;color:#f85149;border-radius:8px;padding:9px 12px;cursor:pointer;font-size:14px;">🚫 ${zh ? '移至黑名單' : 'Move to blacklist'}</button>
    <button onclick="dismissCandidateGo('plain', '${escapeHtml(name)}')" title="${zh ? '只從清單移除，不進黑名單（下次掃描可能再出現）' : 'Remove from list only, not blacklisted (may reappear next scan)'}" style="text-align:left;background:transparent;border:1px solid #30363d;color:#c9d1d9;border-radius:8px;padding:9px 12px;cursor:pointer;font-size:14px;">🗑 ${zh ? '清除' : 'Remove'}</button>
    <button onclick="document.getElementById('dismiss-opt-overlay').remove()" title="${zh ? '什麼都不做' : 'Do nothing'}" style="text-align:left;background:transparent;border:1px solid #30363d;color:#8b949e;border-radius:8px;padding:9px 12px;cursor:pointer;font-size:14px;">${zh ? '取消' : 'Cancel'}</button>
  </div>`;
  document.body.appendChild(o);
  o.addEventListener('click', (ev) => { if (ev.target === o) o.remove(); });
}
// Candidate card click -> full-page draft review in the viewer, same look
// as the official tag page (action bar + management table with per-row
// 解除). The dialog overlay is retired.
// Buttons inside the card (Refresh/Promote/Remove) must NOT trigger this.
function openCandidatePage(name, source, ev) {
  if (ev && ev.target && ev.target.closest && ev.target.closest('button')) return;
  name = (name || '').trim();
  if (!name) return;
  selectedCandidateName = name;
  selectedConceptName = null;
  const isVine = source === 'vine';
  const repo = (typeof getActiveRepoPath === 'function') ? getActiveRepoPath() : '';
  try {
    window.__candName = name;
    window.__candSource = source || '';
    window.__candGroups = [];
  } catch (e) {}

  // 1. Ensure left drawer is on Concepts tab and 'candidates' subtab
  if (typeof switchActivityTab === 'function') switchActivityTab('concepts', true);
  if (typeof switchConceptSubTab === 'function' && currentConceptSubTab !== 'candidates') {
    switchConceptSubTab('candidates');
  } else if (typeof renderConceptsDrawerList === 'function') {
    renderConceptsDrawerList();
  }

  // 2. Smoothly scroll candidate card into view
  setTimeout(() => {
    const card = document.getElementById(`cpt-cand-${name}`) || document.querySelector(`[data-candidate-name="${CSS.escape(name)}"]`);
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, 60);

  // Loading plate first (same skeleton as the tag page).
  renderCandidatePageInViewer({ concept: name, source: source, repo: repo, groups: null, evd: null, loading: true });
  const draftUrl = `/api/concepts/candidates/draft?repo=${encodeURIComponent(repo)}&name=${encodeURIComponent(name)}`;
  const evP = !isVine
    ? fetch(repo ? `/api/concepts/scan/evidence?repo=${encodeURIComponent(repo)}` : '/api/concepts/scan/evidence')
        .then(r => r.json()).then(ev => ((ev && ev.evidence) || {})[name] || null).catch(() => null)
    : Promise.resolve(null);
  fetch(draftUrl)
    .then(r => r.json()).then(d => {
      if (!(d && d.ok)) {
        renderCandidatePageInViewer({ concept: name, source: source, repo: repo, groups: [], evd: null, error: (d && d.error) || 'draft failed' });
        return;
      }
      const rows = d.rows || [];
      let linkRows = rows.filter(r => r.kind !== 'tag');
      if (!linkRows.length) linkRows = rows;
      evP.then(evd => {
        const groups = [];
        linkRows.forEach(r => {
          const k = (r.file || '') + '\n' + (r.mention || '');
          let g = null;
          for (const x of groups) { if (x.k === k) { g = x; break; } }
          if (!g) { g = { k, file: r.file, mention: r.mention, head: null }; groups.push(g); }
          if (!g.head && r.heading && r.line) g.head = r;
        });
        try { window.__candGroups = groups.map(g => ({ file: g.file, mention: g.mention })); }
        catch (e) {}
        renderCandidatePageInViewer({ concept: name, source: source, repo: repo, groups, evd });
      });
    }).catch(err => {
      renderCandidatePageInViewer({ concept: name, source: source, repo: repo, groups: [], evd: null, error: String((err && err.message) || err) });
    });
}
// Candidate draft page: official-tag-page look. Header + action bar +
// management table (Keep | crumb | snippet | 解除 per row).
function renderCandidatePageInViewer(p) {
  const lang = currentLanguage;
  const zh = lang === 'zh', ja = lang === 'ja';
  const dName = document.getElementById('d-name');
  const dSub = document.getElementById('d-sub');
  const badge = document.getElementById('d-kind-badge');
  const codeTitle = document.getElementById('d-code-title');
  const name = p.concept || '';
  const isVine = p.source === 'vine';
  const groups = p.groups || [];
  const repoTail = String(p.repo || '').split(/[/\\]/).filter(Boolean).pop() || '';
  const srcLabel = isVine ? 'Vine' : (zh ? '探礦' : 'Prospect');

  // Browser-history record (candidate draft view).
  try {
    if (name && typeof navRecord === 'function') {
      navRecord({ view: 'candidate', name: name, source: isVine ? 'vine' : 'prospect' });
    }
  } catch (e) {}
  if (dName) dName.innerText = zh ? `🏷️ ${name}（候選審核）` : (ja ? `🏷️ ${name}（候補プレビュー）` : `🏷️ ${name} (Candidate)`);
  if (dSub) dSub.innerText = `${repoTail} · ${p.groups === null ? '…' : groups.length} ${zh ? '處落點' : 'spots'} · ${zh ? '來源' : 'Source'} ${srcLabel}`;
  if (badge) {
    badge.innerText = 'CANDIDATE';
    badge.style.background = '#9e6a03';
    badge.style.color = '#ffffff';
    badge.style.fontWeight = '700';
    badge.style.textShadow = '0 1px 2px rgba(0,0,0,0.7)';
  }
  if (codeTitle) codeTitle.innerText = zh ? `🗂️ 待審標籤發佈預覽：${name}` : (ja ? `🗂️ 候補タグプレビュー: ${name}` : `🗂️ Candidate Tag Preview: ${name}`);

  const escName = escapeHtml(name);
  // (5) Draft-preview banner: the WHOLE page is a preview — nothing on
  // disk. Staged rows live in DB only until Promote.
  let fullMd = `<div style="background:#0d1a2e;border:1px solid #1f6feb;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#a5d6ff;">${zh ? '👁 本頁為發佈預覽 — 目前尚未寫入任何標籤；點擊「✓ 正式發佈」後才會寫入檔案' : (ja ? '👁 プレビュー表示中 — 現時点ではファイル未変更です。「✓ 承認して適用」でファイルへ書き込まれます' : '👁 Draft preview — no tags written to any file yet; they land on disk only after Promote')}</div>\n\n`;
  fullMd += `${zh ? '分類' : (ja ? 'カテゴリ' : 'Category')}: ${srcLabel} ｜ ${zh ? '狀態：待審候選（正式發佈後寫入檔案）' : (ja ? 'ステータス：候補（承認後にファイルへ書き込み）' : 'Status: candidate (applied on promote)')}\n\n`;
  // No <hr> here: the banner above already separates, and a bare rule
  // collides with the button row below (white line on buttons).
  fullMd += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 10px;">`
    + `<button class="mini-btn" style="background:#238636;border-color:#2ea043;color:#fff;padding:4px 14px;font-weight:600;" onclick="promoteCandidate('${escName}')">✓ ${zh ? '正式發佈' : (ja ? '承認して適用' : 'Promote')}</button>`
    + `<button class="mini-btn" style="background:transparent;border:1px solid #1f6feb;color:#58a6ff;padding:4px 14px;" onclick="openCardRefresh('${escName}')">↻ ${zh ? '更新' : 'Refresh'}</button>`
    + `<button class="mini-btn" style="background:#21262d;border:1px solid #30363d;color:#f85149;padding:4px 14px;" onclick="dismissCandidate('${escName}')">✕ ${zh ? '移除' : 'Remove'}</button>`
    + `</div>\n\n`;
  fullMd += `### 🔗 ${zh ? '引用預覽（正式發佈後寫入檔案）' : (ja ? 'タグ適用箇所のプレビュー' : 'Staged spots (applied on promote)')}\n`;
  if (p.loading) {
    fullMd += zh ? '\n*(讀取中…)*\n' : '\n*(Loading…)*\n';
  } else if (p.error) {
    fullMd += `\n*❌ ${escapeHtml(p.error)}*\n`;
  } else if (!groups.length) {
    fullMd += zh ? '\n*(暫存已空（可能已轉正，或被過期清掃掉了）。)*\n' : '\n*(Draft is empty (promoted or swept).)*\n';
  } else {
    const baseName = (x) => String(x || '').split(/[\\/]/).pop() || x || '';
    const cleanMention = (s) => String(s || '').replace(/^["'「『‘“\s]+|["'」』’”\s]+$/g, '');
    // (2) Dashed DRAFT sample: exactly what one applied tag line will
    // look like under each spot's heading after Promote. Rendered as
    // CODE (not a link — tags/<name>.md may not exist yet; a dead link
    // in a preview is a fresh confusion).
    fullMd += `<div style="position:relative;border:1px dashed #8b949e;border-radius:8px;padding:10px 12px;margin:10px 0 4px;background:rgba(139,148,158,.06);">`
      + `<span style="position:absolute;top:-9px;right:10px;background:#0d1117;border:1px solid #8b949e;border-radius:8px;font-size:10px;color:#8b949e;padding:0 8px;">${zh ? '預覽 PREVIEW' : 'PREVIEW'}</span>`
      + `<div style="font-size:13px;color:#8b949e;margin-bottom:4px;">${zh ? '正式發佈後，各段落標題下方將加入此標籤引用行：' : (ja ? '承認後、各セクションの見出し直下にこのタグ参照行が挿入されます：' : 'After Promote, this line lands under each spot heading:')}</div>`
      + `<div style="font-size:12px;color:#c9d1d9;"><code>&gt; 🏷️ ${zh ? '標籤' : 'tag'}： [${escName}](.docgraphical/tags/${escName}.md)</code></div>`
      + `</div>\n`;
    fullMd += zh ? '\n| 引用檔案路徑 | 提及段落摘要 | 操作 |\n| :--- | :--- | :--- |\n'
                 : '\n| File | Snippet | Action |\n| :--- | :--- | :--- |\n';
    groups.forEach((g, gi) => {
      const h = g.head || {};
      const crumb = (h.heading && h.line)
        ? refCrumbHtml(`heading::${g.file}::L${h.line}::${h.heading}`, h.level)
        : refCrumbHtml(g.file || '');
      let snip;
      if (!isVine && p.evd && p.evd.files) {
        const mf = baseName(g.file);
        const hit = p.evd.files.find(f => baseName(f.rel) === mf) || null;
        const sn = hit && hit.snippet ? String(hit.snippet).slice(0, 140).replace(/\|/g, '/') : '';
        snip = sn ? `“${escapeHtml(sn)}”` : (zh ? '(章節內文)' : '(Section body)');
      } else if (isVine) {
        const men = cleanMention(g.mention);
        snip = men ? escapeHtml(men) : (zh ? '(章節內文)' : '(Section body)');
      } else {
        snip = zh ? '(章節內文)' : '(Section body)';
      }
      fullMd += `| ${crumb} | ${snip} | <button class="mini-btn" style="color:#f85149; border-color:#da3633; padding:3px 12px; font-weight:600; white-space:nowrap; min-width:54px; display:inline-block;" onclick="detachCandidateRow(${gi}, event)">${zh ? '解除' : (ja ? '解除' : 'Unlink')}</button> |\n`;
    });
    fullMd += `\n${zh ? '＊正式發佈後將自動加入內文連結與段落 🏷️ 標籤行' : '* each spot applies inline link + section tag line on promote'}\n`;
  }
  viewCtx = { project: '', file: '', repo: p.repo || getActiveRepoPath(), heading: '', candidate: name };
  renderMarkdown(fullMd);
}
// Candidate page: drop ONE staged spot (same meaning as 解除 on the tag page).
function detachCandidateRow(gi, ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  const zh = currentLanguage === 'zh';
  const groups = window.__candGroups || [];
  const g = groups[gi];
  const name = window.__candName || '';
  if (!g || !name) {
    showToast(zh ? '❌ 底稿已過期，重開候選卡' : '❌ draft expired, reopen the card');
    return;
  }
  const repo = (typeof getActiveRepoPath === 'function') ? getActiveRepoPath() : '';
  fetch('/api/concepts/candidates/detach', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo, name, drop: [{ file: g.file, mention: g.mention }] })
  }).then(r => r.json()).then(d => {
    if (d && d.ok) {
      showToast(zh ? '已解除 1 處' : 'Detached 1 spot');
      if (typeof fetchConceptsData === 'function') fetchConceptsData();
      openCandidatePage(name, (window.__candSource || 'vine'), null);
    } else {
      showToast('❌ ' + ((d && d.error) || 'detach failed'));
    }
  }).catch(err => showToast('❌ ' + err));
}
// (detachCandidateUnchecked removed with the Keep column; per-row 解除
// plus page-level 移除 cover detach flows.)
// Prospect block tree-checks: mirror of the Vine toggles (master per
// term block, keep/drop unit per evidence-file row).
function scanFileToggle(master) {
  const blk = master && master.closest ? master.closest('[data-scan-block]') : null;
  if (!blk) return;
  blk.querySelectorAll('[data-scan-file]').forEach(b => { b.checked = master.checked; });
  master.indeterminate = false;
  if (typeof scanPaintConfirm === 'function') scanPaintConfirm();
}
function scanSubToggle(sub) {
  const blk = sub && sub.closest ? sub.closest('[data-scan-block]') : null;
  if (!blk) return;
  const master = blk.querySelector('[data-scan-master]');
  if (!master) return;
  const boxes = [...blk.querySelectorAll('[data-scan-file]')];
  const n = boxes.filter(b => b.checked).length;
  master.checked = n > 0;
  master.indeterminate = n > 0 && n < boxes.length;
  if (typeof scanPaintConfirm === 'function') scanPaintConfirm();
}
// Vine dialog tree-checks: md checkbox is the master switch for its
// node; each content row keeps its own box (the true keep/drop unit).
function vineFileToggle(master) {
  const blk = master && master.closest ? master.closest('[data-vine-block]') : null;
  if (!blk) return;
  blk.querySelectorAll('[data-vine-keep]').forEach(b => { b.checked = master.checked; });
  master.indeterminate = false;
}
function vineSubToggle(sub) {
  const blk = sub && sub.closest ? sub.closest('[data-vine-block]') : null;
  if (!blk) return;
  const master = blk.querySelector('[data-vine-file]');
  if (!master) return;
  const boxes = [...blk.querySelectorAll('[data-vine-keep]')];
  const n = boxes.filter(b => b.checked).length;
  master.checked = n > 0;
  master.indeterminate = n > 0 && n < boxes.length;
}
// (closeDraftAndJump retired with the draft overlay;
// section jumps go through refCrumbHtml now.)
// (detachDraftUnchecked retired with the draft overlay; candidate-page
// detachment lives in detachCandidateRow / detachCandidateUnchecked.)
// Per-card refresh chooser: Prospect recounts this term (free), Vine opens
// Discover in crawl mode with the tag name prefilled as seed.
function openCardRefresh(term) {
  const zh = currentLanguage === 'zh';
  if (document.getElementById('refresh-opt-overlay')) return;
  term = (term || '').trim();
  if (!term) return;
  const o = document.createElement('div');
  o.id = 'refresh-opt-overlay';
  o.style.cssText = 'position:fixed;inset:0;z-index:1000005;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
  o.innerHTML = `
  <div style="width:420px;max-width:92vw;background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:16px;color:#e6edf3;display:flex;flex-direction:column;gap:10px;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="font-weight:600;font-size:15px;">${zh ? `更新「${escapeHtml(term)}」？` : `Refresh "${escapeHtml(term)}"?`}</span>
      <button onclick="document.getElementById('refresh-opt-overlay').remove()" style="background:transparent;border:none;color:#8b949e;cursor:pointer;font-size:15px;">✕</button>
    </div>
    <button onclick="cardRefreshGo('prospect', '${escapeHtml(term)}')" title="${zh ? '重新統計詞頻並補齊缺少之引用位置（不呼叫 LLM）' : 'Recount DF/TF + top up missing staged spots, no LLM cost'}" style="text-align:left;background:transparent;border:1px solid #9e6a03;color:#e3b341;border-radius:8px;padding:9px 12px;cursor:pointer;font-size:14px;">⛏ ${zh ? '探礦重算＋補落點' : 'Prospect recount + top-up'}</button>
    <button onclick="cardRefreshGo('vine', '${escapeHtml(term)}')" title="${zh ? '以此為起點重新進行深度關聯探索，新引用直接併入本候選（需呼叫 LLM）' : 'Re-crawl seeded by this; new spots merge into THIS candidate (LLM cost, no new candidate)'}" style="text-align:left;background:transparent;border:1px solid #2ea043;color:#3fb950;border-radius:8px;padding:9px 12px;cursor:pointer;font-size:14px;">🌿 ${zh ? '順藤深挖' : 'Vine dig'}</button>
    <button onclick="document.getElementById('refresh-opt-overlay').remove()" title="${zh ? '什麼都不做' : 'Do nothing'}" style="text-align:left;background:transparent;border:1px solid #30363d;color:#8b949e;border-radius:8px;padding:9px 12px;cursor:pointer;font-size:14px;">${zh ? '取消' : 'Cancel'}</button>
  </div>`;
  document.body.appendChild(o);
  o.addEventListener('click', (ev) => { if (ev.target === o) o.remove(); });
}
// Interactive Review Dialog for Prospect recount and Vine dig results
function openRefreshResultReviewDialog(how, term, items, extraInfo = {}) {
  const zh = currentLanguage === 'zh';
  const existing = document.getElementById('refresh-review-modal');
  if (existing) existing.remove();

  const o = document.createElement('div');
  o.id = 'refresh-review-modal';
  o.className = 'modal-overlay';
  o.style.cssText = 'position:fixed;inset:0;z-index:1000006;background:rgba(0,0,0,0.78);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';

  const typeName = how === 'prospect' ? (zh ? '⛏ 探礦重算' : 'Prospect') : (zh ? '🌿 順藤深挖' : 'Vine');
  const titleText = zh ? `${typeName}關聯結果審核：「${escapeHtml(term)}」` : `${typeName} Dig Review: "${escapeHtml(term)}"`;

  // Compute existing links count for this concept if available in memory
  let existingCount = 0;
  try {
    const cid = `concept::${term}`;
    const gLinks = (rawData && rawData.links) ? rawData.links : [];
    const matched = new Set();
    gLinks.forEach(l => {
      const sId = typeof l.source === 'object' ? l.source.id : l.source;
      const tId = typeof l.target === 'object' ? l.target.id : l.target;
      if (tId === cid || tId.endsWith(`::${cid}`)) matched.add(sId);
      if (sId === cid || sId.endsWith(`::${cid}`)) matched.add(tId);
    });
    existingCount = matched.size;
  } catch(e) {}

  // Filter out internal system and tag files defensively
  const filtered = (items || []).filter(it => {
    const f = (it.file || it.rel || it.filePath || '').replace(/\\/g, '/');
    if (!f) return false;
    const fl = f.toLowerCase();
    if (fl.includes('.docgraphical') || fl.includes('.docgraph') || fl.includes('doc_catalog.md') || fl.includes('log.md')) {
      return false;
    }
    return true;
  });

  // Deduplicate items strictly by file + heading (one section node per candidate!)
  // If multiple mentions hit the same heading, collect them into snippets list
  const sectionMap = new Map();
  filtered.forEach((it, idx) => {
    const f = it.file || it.rel || it.filePath || '';
    const h = (it.heading || '').trim();
    const line = it.line || 1;
    const snip = (it.snippet || it.term || it.mention || '').trim();
    
    // Group key: each heading under a file is ONE distinct link target
    const targetKey = h ? `${f}::${h}` : `${f}::L${line}`;
    
    if (sectionMap.has(targetKey)) {
      const existing = sectionMap.get(targetKey);
      if (snip && !existing.snippets.includes(snip)) {
        existing.snippets.push(snip);
      }
    } else {
      const refId = (h && line) ? `heading::${f}::L${line}::${h}` : (f ? `file::${f}` : '');
      sectionMap.set(targetKey, {
        id: `rf-item-${idx}`,
        file: f,
        heading: h,
        line: line,
        level: it.level || 0,
        refId: refId,
        snippets: snip ? [snip] : [],
        checked: true
      });
    }
  });

  const normalized = Array.from(sectionMap.values()).map(item => ({
    ...item,
    snippet: item.snippets.join(' ｜ ')
  }));

  const subHeaderNote = zh
    ? (existingCount > 0
        ? `本次發掘 <b>${normalized.length}</b> 處新引用落點（目前文檔已存在 <b>${existingCount}</b> 處關聯）。請勾選欲套用的新落點：`
        : `本次共發掘 <b>${normalized.length}</b> 處引用落點。請勾選欲建立關聯的項目：`)
    : `Discovered <b>${normalized.length}</b> references${existingCount > 0 ? ` (${existingCount} existing links)` : ''}. Choose items to link:`;

  o.innerHTML = `
    <div style="background:#161b22;border:1px solid #30363d;border-radius:12px;width:720px;max-width:95vw;max-height:86vh;box-shadow:0 24px 60px rgba(0,0,0,0.85);display:flex;flex-direction:column;overflow:hidden;">
      <!-- Header -->
      <div style="padding:14px 20px;border-bottom:1px solid #30363d;display:flex;justify-content:space-between;align-items:center;background:#0d1117;">
        <div>
          <span style="font-weight:700;font-size:16px;color:#58a6ff;line-height:1.4;">${titleText}</span>
          <div style="font-size:12.5px;color:#8b949e;margin-top:2px;">
            ${subHeaderNote}
          </div>
        </div>
        <button onclick="document.getElementById('refresh-review-modal').remove()" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:20px;line-height:1;padding:4px 8px;">✕</button>
      </div>

      <!-- Toolbar -->
      <div style="padding:10px 20px;background:#0d1117;border-bottom:1px solid #21262d;display:flex;justify-content:space-between;align-items:center;">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#c9d1d9;cursor:pointer;user-select:none;">
          <input type="checkbox" id="rf-select-all" checked onchange="document.querySelectorAll('.rf-item-check').forEach(cb => cb.checked = this.checked); updateRefreshReviewCount();">
          <span>${zh ? '全選 / 全不選' : 'Select All / None'}</span>
        </label>
        <span id="rf-selected-summary" style="font-size:13px;color:#58a6ff;font-weight:600;">${zh ? `已選擇 ${normalized.length} / ${normalized.length} 項` : `Selected ${normalized.length} / ${normalized.length}`}</span>
      </div>

      <!-- Item List Container with Standard Node Plate Styling -->
      <div style="flex:1;overflow-y:auto;padding:12px 20px;display:flex;flex-direction:column;gap:10px;background:#161b22;" id="rf-items-container">
        ${normalized.length === 0 ? `<div style="text-align:center;padding:40px;color:#8b949e;font-size:14px;">${zh ? '本次未發現任何新引用' : 'No new references found.'}</div>` : ''}
        ${normalized.map(it => `
          <div style="display:flex;align-items:flex-start;gap:12px;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px 14px;transition:all 0.15s ease;">
            <input type="checkbox" class="rf-item-check" data-refid="${escapeHtml(it.refId)}" data-file="${escapeHtml(it.file)}" data-heading="${escapeHtml(it.heading)}" checked style="margin-top:5px;cursor:pointer;" onchange="updateRefreshReviewCount()">
            <div style="flex:1;min-width:0;">
              <!-- Canonical Node Plate -->
              <div>
                ${refCrumbHtml(it.refId || it.file, it.level)}
              </div>
              ${it.snippet ? `<div style="font-size:12.5px;color:#c9d1d9;margin-top:6px;background:#161b22;padding:6px 10px;border-radius:4px;border-left:3px solid #58a6ff;font-family:monospace;word-break:break-all;">${escapeHtml(it.snippet)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Footer Buttons -->
      <div style="padding:14px 20px;border-top:1px solid #30363d;display:flex;justify-content:flex-end;gap:10px;background:#0d1117;">
        <button onclick="document.getElementById('refresh-review-modal').remove()" class="mini-btn" style="padding:8px 18px;font-size:14px;border-radius:6px;">${zh ? '取消' : 'Cancel'}</button>
        <button onclick="confirmRefreshReviewSelection('${how}', '${escapeHtml(term)}')" class="btn-primary" style="padding:8px 22px;font-size:14px;font-weight:600;border-radius:6px;" id="btn-rf-confirm">
          ${zh ? '確認套用所選關聯' : 'Apply Selected Links'}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(o);
  o.addEventListener('click', (ev) => { if (ev.target === o) o.remove(); });
}

window.updateRefreshReviewCount = function() {
  const zh = currentLanguage === 'zh';
  const all = document.querySelectorAll('.rf-item-check');
  const checked = document.querySelectorAll('.rf-item-check:checked');
  const summary = document.getElementById('rf-selected-summary');
  if (summary) {
    summary.innerText = zh ? `已選擇 ${checked.length} / ${all.length} 項` : `Selected ${checked.length} / ${all.length}`;
  }
};

window.confirmRefreshReviewSelection = function(how, term) {
  const zh = currentLanguage === 'zh';
  const checked = [...document.querySelectorAll('.rf-item-check:checked')].map(cb => ({
    refId: cb.dataset.refid,
    filePath: cb.dataset.file,
    heading: cb.dataset.heading
  }));
  const unselected = [...document.querySelectorAll('.rf-item-check:not(:checked)')].map(cb => ({
    refId: cb.dataset.refid,
    filePath: cb.dataset.file,
    heading: cb.dataset.heading
  }));

  const modal = document.getElementById('refresh-review-modal');
  const btn = document.getElementById('btn-rf-confirm');
  if (btn) { btn.disabled = true; btn.innerText = zh ? '套用中...' : 'Applying...'; }

  const repo = (typeof getActiveRepoPath === 'function') ? getActiveRepoPath() : '';

  (async () => {
    // 1. Process unselected unlinks sequentially
    for (const item of unselected) {
      const targetPath = item.refId || item.filePath;
      try {
        await fetch('/api/concepts/unlink', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo, name: term, filePath: targetPath, rewriteDisk: true })
        });
      } catch (e) {}
    }

    // 2. Process checked attaches sequentially to prevent disk write collisions on the same file!
    for (const item of checked) {
      try {
        await fetch('/api/concepts/attach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo, name: term, filePath: item.filePath, heading: item.heading })
        });
      } catch (e) {}
    }

    if (modal) modal.remove();
    showToast(zh ? `✅ 已成功依所選項目更新「${term}」的關聯連線！` : `✅ Updated links for "${term}"!`);
    if (typeof fetchConceptsData === 'function') fetchConceptsData();
    if (typeof loadMasterGraphAndFilter === 'function') loadMasterGraphAndFilter();
    setTimeout(() => {
      if (typeof buildProjectTree === 'function') buildProjectTree();
      if (typeof spotlightConceptNode === 'function') spotlightConceptNode(term);
      if (selectedConceptName === term && typeof onConceptCardClick === 'function') {
        onConceptCardClick(term);
      }
    }, 180);
  })();
};

// Executes one per-card refresh path with comprehensive interactive review dialog
function cardRefreshGo(how, term) {
  const o = document.getElementById('refresh-opt-overlay');
  const zh = currentLanguage === 'zh';
  const repo = (typeof getActiveRepoPath === 'function') ? getActiveRepoPath() : '';

  // Transform option modal into in-place waiting status instead of closing immediately!
  if (o) {
    const isVine = how === 'vine';
    o.innerHTML = `
      <div style="width:440px;max-width:92vw;background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:24px 20px;color:#e6edf3;display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px;box-shadow:0 16px 48px rgba(0,0,0,0.85);">
        <div style="width:36px;height:36px;border:3px solid #30363d;border-top-color:${isVine ? '#3fb950' : '#e3b341'};border-radius:50%;animation:spin 0.8s linear infinite;"></div>
        <div>
          <div style="font-weight:700;font-size:15px;color:${isVine ? '#3fb950' : '#e3b341'};">
            ${isVine ? (zh ? `🌿 順藤深挖中：「${escapeHtml(term)}」` : `🌿 Digging "${escapeHtml(term)}"...`)
                     : (zh ? `⛏ 探礦重算中：「${escapeHtml(term)}」` : `⛏ Recounting "${escapeHtml(term)}"...`)}
          </div>
          <div style="font-size:12.5px;color:#8b949e;margin-top:5px;line-height:1.5;">
            ${isVine ? (zh ? '正在遍歷正文節點並呼叫 LLM 進行深度關聯探勘...<br>完成時將自動接續彈出審核清單，請稍候。' : 'Traversing document nodes with LLM calls...<br>Review dialog will pop up upon completion.')
                     : (zh ? '正在重新統計詞頻並校驗落點...<br>完成時將自動接續彈出審核清單。' : 'Recounting frequencies and verifying references...')}
          </div>
        </div>
      </div>
    `;
  }

  if (how === 'prospect') {
    showToast(zh ? `⛏ 正在重新探勘「${term}」落點...` : `⛏ Recounting "${term}"...`);
    fetch('/api/concepts/scan/recount-one', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, term })
    })
      .then(r => r.json())
      .then(d => {
        if (o) o.remove();
        if (d && d.ok) {
          const files = d.files || [];
          const cntTxt = zh ? `「${term}」：出現 ${d.df || 0} 檔·${d.tf || 0} 次`
                            : `"${term}": ${d.df || 0} docs·${d.tf || 0} hits`;
          showToast(cntTxt);
          if (files.length > 0) {
            openRefreshResultReviewDialog('prospect', term, files, d);
          } else {
            showToast(zh ? `「${term}」：未發現額外關聯落點` : `"${term}": No additional spots`);
          }
          if (typeof fetchConceptsData === 'function') fetchConceptsData();
        } else {
          showToast('❌ ' + ((d && d.error) || 'recount failed'));
        }
      })
      .catch(err => {
        if (o) o.remove();
        showToast('❌ ' + err);
      });
    return;
  }

  // Vine: PURE refresh - re-crawl seeded by this title
  showToast(zh ? `🌿 深度探索「${term}」關聯中（需呼叫 LLM，完成時彈出審核清單）`
               : `🌿 Digging "${term}" (LLM calls, review dialog pops up on done)`);
  fetch('/api/crawl/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo, name: term })
  })
    .then(r => r.json())
    .then(d => {
      if (o) o.remove();
      if (d && d.ok) {
        const items = d.new_items || d.all_items || [];
        showToast(zh ? `「${term}」深度探索完成！已挖出 ${items.length} 處落點`
                     : `"${term}" dig completed! Found ${items.length} references`);
        if (items.length > 0) {
          openRefreshResultReviewDialog('vine', term, items, d);
        } else {
          showToast(zh ? `「${term}」：無新增引用（呼叫 LLM ${d.spent || 0} 次）`
                       : `"${term}": nothing new (${d.spent || 0} calls)`);
        }
        if (typeof fetchConceptsData === 'function') fetchConceptsData();
        if (typeof loadMasterGraphAndFilter === 'function') loadMasterGraphAndFilter();
      } else {
        showToast('❌ ' + ((d && d.error) || 'refresh failed'));
      }
    })
    .catch(err => {
      if (o) o.remove();
      showToast('❌ ' + err);
    });
}
function dismissCandidateGo(how, name) {
  const o = document.getElementById('dismiss-opt-overlay');
  if (o) o.remove();
  const zh = currentLanguage === 'zh';
  const repo = (typeof getActiveRepoPath === 'function') ? getActiveRepoPath() : '';
  if (how === 'plain') {
    fetch('/api/concepts/scan/candidates/remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, name })
    }).then(() => {
      if (typeof fetchConceptsData === 'function') fetchConceptsData();
    });
    return;
  }
  // Blacklist path: existing unlink flow (records rejected_terms server-side).
  fetch('/api/concepts/unlink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo, name, filePath: '*', rewriteDisk: false })
  }).then(() => {
    fetchConceptsData();
  });
}

function updateConceptsI18n() {
  const lang = currentLanguage;
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setAttr = (id, attr, txt) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, txt); };

  // Activity Bar Tooltips
  setAttr('act-tab-explorer', 'title', lang === 'zh' ? '文件瀏覽器 (Explorer)' : (lang === 'ja' ? 'ファイルエクスプローラー (Explorer)' : 'File Explorer (Explorer)'));
  setAttr('act-tab-concepts', 'title', lang === 'zh' ? '概念標籤管理 (Concepts Registry)' : (lang === 'ja' ? 'コンセプト管理 (Concepts Registry)' : 'Concepts Registry (Concepts)'));
  setAttr('act-tab-settings', 'title', lang === 'zh' ? '系統設定 (Settings)' : (lang === 'ja' ? 'システム設定 (Settings)' : 'System Settings (Settings)'));

  // Drawer Titles & Buttons
  set('lbl-drawer-explorer-title', lang === 'zh' ? '文件瀏覽器' : (lang === 'ja' ? 'エクスプローラー' : 'EXPLORER'));
  set('lbl-drawer-concepts-title', lang === 'zh' ? '概念標籤管理' : (lang === 'ja' ? 'コンセプト管理' : 'CONCEPTS REGISTRY'));
  set('btn-add-concept', lang === 'zh' ? '+ 新增' : (lang === 'ja' ? '+ 追加' : '+ New'));
  setAttr('btn-add-concept', 'title', lang === 'zh' ? '手動建立新正式概念' : (lang === 'ja' ? '新しい公式コンセプトを登録' : 'Define New Official Concept'));

  // Search input placeholder
  const cptSearch = document.getElementById('concept-search');
  if (cptSearch) cptSearch.placeholder = lang === 'zh' ? '搜尋概念或別名...' : (lang === 'ja' ? 'コンセプトまたは別名を検索...' : 'Search concepts or aliases...');

  // Sub Tab Buttons
  const btnOfficial = document.getElementById('btn-cpt-official');
  const btnCandidates = document.getElementById('btn-cpt-candidates');
  const btnBlacklist = document.getElementById('btn-cpt-blacklist');
  const countOff = document.getElementById('count-cpt-official')?.innerText || '0';
  const countCand = document.getElementById('count-cpt-candidates')?.innerText || '0';
  const countBlack = document.getElementById('count-cpt-blacklist')?.innerText || '0';

  const txtOff = lang === 'zh' ? '正式概念' : (lang === 'ja' ? '公式コンセプト' : 'Official');
  const txtCand = lang === 'zh' ? '待審候選' : (lang === 'ja' ? '候補一覧' : 'Candidates');
  const txtBlack = lang === 'zh' ? '黑名單' : (lang === 'ja' ? 'ブラックリスト' : 'Blacklist');

  if (btnOfficial) btnOfficial.innerHTML = `${txtOff} (<span id="count-cpt-official">${countOff}</span>)`;
  if (btnCandidates) btnCandidates.innerHTML = `${txtCand} (<span id="count-cpt-candidates">${countCand}</span>)`;
  if (btnBlacklist) btnBlacklist.innerHTML = `${txtBlack} (<span id="count-cpt-blacklist">${countBlack}</span>)`;

  // Discover button + clear-filter (both hardcoded in template HTML)
  set('btn-scan-concept', lang === 'zh' ? '🔍 發掘' : (lang === 'ja' ? '🔍 発掘' : '🔍 Discover'));
  setAttr('btn-scan-concept', 'title', lang === 'zh' ? '全庫探勘與 LLM 評審，發掘新候選概念' : (lang === 'ja' ? 'ライブラリ全体から候補概念を抽出・登録' : 'Mine corpus + LLM review; new candidates staged'));
  setAttr('btn-clear-cpt-filter', 'title', lang === 'zh' ? '清除篩選' : (lang === 'ja' ? 'フィルタをクリア' : 'Clear filter'));

  // Re-render list with updated language
  renderConceptsDrawerList(cptSearch ? cptSearch.value : '');
}

// ==========================================================================
// Unified Settings Modal Controller (Repositories, Language, LLM)
// ==========================================================================

let currentSettingsTab = 'repo'; // 'repo' | 'lang' | 'llm'

function openSettingsModal(tab = 'repo') {
  const m = document.getElementById('settings-modal');
  if (!m) return;
  m.classList.add('show');
  updateSettingsModalI18n();
  switchSettingsTab(tab);
}

function closeSettingsModal() {
  const m = document.getElementById('settings-modal');
  if (m) m.classList.remove('show');
}

// Backward compatibility redirects
function openPathModal(bRefresh = true) {
  openSettingsModal('repo');
  if (bRefresh) loadProjects();
}

function closePathModal() {
  closeSettingsModal();
}

function toggleProviderDialog(force) {
  if (force === false) {
    closeSettingsModal();
  } else {
    openSettingsModal('llm');
  }
}

function switchSettingsTab(tabName) {
  currentSettingsTab = tabName;
  const navRepo = document.getElementById('stg-nav-repo');
  const navLang = document.getElementById('stg-nav-lang');
  const navLlm = document.getElementById('stg-nav-llm');

  const pageRepo = document.getElementById('stg-page-repo');
  const pageLang = document.getElementById('stg-page-lang');
  const pageLlm = document.getElementById('stg-page-llm');

  if (navRepo) navRepo.classList.toggle('active', tabName === 'repo');
  if (navLang) navLang.classList.toggle('active', tabName === 'lang');
  if (navLlm) navLlm.classList.toggle('active', tabName === 'llm');

  if (pageRepo) pageRepo.style.display = tabName === 'repo' ? 'flex' : 'none';
  if (pageLang) pageLang.style.display = tabName === 'lang' ? 'flex' : 'none';
  if (pageLlm) pageLlm.style.display = tabName === 'llm' ? 'flex' : 'none';

  if (tabName === 'repo') {
    loadProjects();
  } else if (tabName === 'lang') {
    updateLanguageCardsUI();
  } else if (tabName === 'llm') {
    renderProvDialogLabels();
    renderProvPresets();
    refreshProviderList();
    loadProvActiveModel();
  }
}

function selectAppLanguage(lang) {
  currentLanguage = lang;
  updateLanguageCardsUI();
  applyAppLanguage();
}

function updateLanguageCardsUI() {
  ['en', 'zh', 'ja'].forEach(l => {
    const card = document.getElementById(`card-lang-${l}`);
    if (card) card.classList.toggle('active', currentLanguage === l);
  });
}

function toggleLanguage() {
  // Tri-state cycle: EN -> ZH -> JA -> EN
  if (currentLanguage === 'en') {
    currentLanguage = 'zh';
  } else if (currentLanguage === 'zh') {
    currentLanguage = 'ja';
  } else {
    currentLanguage = 'en';
  }
  applyAppLanguage();
}

function applyAppLanguage() {
  try { localStorage.setItem('docgraph_language', currentLanguage); } catch(e) {}
  const b = document.getElementById('btn-lang');
  if (b) {
    if (currentLanguage === 'en') b.textContent = 'Language: EN';
    else if (currentLanguage === 'zh') b.textContent = '語言：繁體中文';
    else if (currentLanguage === 'ja') b.textContent = '言語：日本語';
  }

  updateGlobalUIElementsI18n();
  updateSwapButtonI18n();
  updateControlsHelpI18n();
  updateActivityBarI18n();
  updateExplorerI18n();
  updateConceptsI18n();
  updatePromptsI18n();
  updateViewerTagToolbarI18n();
  updateViewerNavI18n();
  updateSettingsModalI18n();
  updateChatWidgetI18n();
  if (typeof buildLegends === 'function') {
    buildLegends();
  }

  const msg = currentLanguage === 'zh' ? '語系切換：繁體中文'
            : (currentLanguage === 'ja' ? '言語を切り替えました：日本語' : 'Language switched to English');
  showToast(msg);
}

function updateGlobalUIElementsI18n() {
  const lang = currentLanguage;
  const zh = lang === 'zh';
  const ja = lang === 'ja';
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setAttr = (id, attr, txt) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, txt); };

  // Top toolbar buttons
  set('btn-rotate', zh ? '🔄 自動旋轉' : (ja ? '🔄 自動回転' : '🔄 Auto Rotate'));
  setAttr('btn-rotate', 'title', zh ? '切換 3D 圖自動環繞旋轉' : (ja ? '3D自動回転のオン/オフ' : 'Toggle 3D Auto-Rotation'));
  set('btn-reset-cam', zh ? '🎯 重設 3D' : (ja ? '🎯 3Dリセット' : '🎯 Reset 3D'));
  setAttr('btn-reset-cam', 'title', zh ? '重設 3D 圖至預設中心視角' : (ja ? '3D視点を初期化' : 'Reset 3D View'));
  setAttr('btn-llm-settings', 'title', zh ? 'LLM 模型與服務商設定' : (ja ? 'LLMプロバイダー設定' : 'LLM Provider Settings'));

  // 3D & AST Panel Headers
  const graphTitle = document.querySelector('.graph-pane-header span');
  if (graphTitle) graphTitle.textContent = zh ? '3D 知識拓撲圖' : (ja ? '3Dナレッジグラフ' : '3D Knowledge Graph');

  set('tab-btn-nodes', zh ? 'AST 語法層級' : (ja ? 'ASTレイヤー' : 'AST Layers'));
  set('tab-btn-edges', zh ? '關聯網路' : (ja ? 'リレーション' : 'Relationships'));
  set('btn-legend-all', zh ? '重設' : (ja ? 'リセット' : 'Reset'));
  setAttr('btn-legend-all', 'title', zh ? '重設為預設過濾（文件 + H1）' : (ja ? '初期状態（文書 + H1）にリセット' : 'Reset to default (Documents + H1)'));

  // Connected links pane
  const linksHeaderTitle = document.querySelector('.links-pane-header span');
  if (linksHeaderTitle) {
    const relCount = document.getElementById('d-rel-count')?.textContent || '0';
    linksHeaderTitle.innerHTML = `<span>🔗</span> ${zh ? '關聯節點與連結' : (ja ? '関連ノード・リンク' : 'Connected Links')} (<span id="d-rel-count" style="color:#00ffaa;">${relCount}</span>)`;
  }
  const linksHeaderNav = document.querySelector('.links-pane-header span:last-child');
  if (linksHeaderNav) linksHeaderNav.textContent = zh ? '交互導航' : (ja ? '対話ナビ' : 'Interactive Nav');

  // Markdown Reader Action Bar
  set('d-code-title', zh ? '🗡️ 切片章節 Markdown' : (ja ? '🗡️ 抽出セクション Markdown' : '🗡️ Sliced Section Markdown'));
  const btnCopySec = document.querySelector('.doc-action-bar button[onclick="copyCurrentSection()"]');
  if (btnCopySec) {
    btnCopySec.textContent = zh ? '📋 複製 Markdown' : (ja ? '📋 Markdownをコピー' : '📋 Copy Markdown');
    btnCopySec.title = zh ? '複製當前章節 Markdown 純文字' : (ja ? '現在の見出しMarkdownをコピー' : 'Copy Markdown text');
  }
  const btnCopyMcp = document.querySelector('.doc-action-bar button[onclick="copyMcpPayload()"]');
  if (btnCopyMcp) {
    btnCopyMcp.textContent = zh ? '🤖 複製給 Agent' : (ja ? '🤖 AI用にコピー' : '🤖 Copy for Agent');
    btnCopyMcp.title = zh ? '複製適合 AI Agent 理解的結構化文字' : (ja ? 'AIエージェント向け構造化テキストをコピー' : 'Copy structured payload for AI Agent');
  }

  // Tagger Modal
  set('tagger-modal-title', zh ? '🏷️ 貼標籤 (Attach Concept Tag)' : (ja ? '🏷️ タグ付け (Attach Concept Tag)' : '🏷️ Attach Concept Tag'));
  set('tagger-hint', zh ? '為當前文件或指定章節貼上正式概念標籤，建立精確知識圖譜關聯。'
                        : (ja ? '現在のファイルまたは見出しに公式概念タグを付与し、ナレッジグラフに関連付けます。'
                        : 'Attach official concept tag to current document or section to link knowledge graph.'));
  set('lbl-tagger-target', zh ? '目標對象 (Target)' : (ja ? '対象 (Target)' : 'Target'));
  set('lbl-tagger-concept', zh ? '選擇要貼上的概念標籤 (Select Concept)' : (ja ? '付与する概念タグを選択 (Select Concept)' : 'Select Concept'));
  set('btn-tagger-cancel', zh ? '取消' : (ja ? 'キャンセル' : 'Cancel'));
  set('btn-tagger-submit', zh ? '確定貼上' : (ja ? 'タグを付与' : 'Attach Tag'));

  // Cyber prompt & confirm modals
  set('btn-cyber-prompt-cancel', zh ? '取消' : (ja ? 'キャンセル' : 'Cancel'));
  set('btn-cyber-prompt-ok', zh ? '確定' : (ja ? '確定' : 'OK'));
  set('btn-cyber-confirm-cancel', zh ? '取消' : (ja ? 'キャンセル' : 'Cancel'));
  set('btn-cyber-confirm-ok', zh ? '確定' : (ja ? '確定' : 'Confirm'));
}

function updateSettingsModalI18n() {
  const lang = currentLanguage;
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

  // Settings Top & Nav
  set('lbl-settings-main-title', lang === 'zh' ? '系統偏好與設定' : (lang === 'ja' ? 'システム設定と基本設定' : 'Preferences & Settings'));
  set('stg-lbl-repo', lang === 'zh' ? '專案儲存庫管理' : (lang === 'ja' ? 'リポジトリ管理' : 'Repositories'));
  set('stg-lbl-lang', lang === 'zh' ? '語系設定' : (lang === 'ja' ? '言語設定' : 'Language'));
  set('stg-lbl-llm', lang === 'zh' ? 'LLM 供應商' : (lang === 'ja' ? 'LLM プロバイダー' : 'LLM Providers'));

  // Repo Page
  set('lbl-modal-title', lang === 'zh' ? '專案儲存庫管理' : (lang === 'ja' ? 'リポジトリ管理' : 'Repository Management'));
  set('lbl-modal-sub', lang === 'zh' ? '掃描本機專案目錄，構建索引 (init)、增量同步 (sync)、全量重建 (index) 或反初始化 (uninit)。'
                     : (lang === 'ja' ? 'ローカルプロジェクトをスキャンし、インデックス構築(init)、増分同期(sync)、完全再構築(index)を行います。'
                     : 'Scan local project directories, build index (init), incremental sync (sync), full rebuild (index), or uninitialize (uninit).'));
  set('lbl-add-dir', lang === 'zh' ? '掃描專案目錄：' : (lang === 'ja' ? 'プロジェクトディレクトリをスキャン：' : 'Scan Project Directory:'));
  set('lbl-repo-list', lang === 'zh' ? '已發現的專案儲存庫：' : (lang === 'ja' ? '検出されたリポジトリ：' : 'Discovered Repositories:'));
  set('btn-sync-all', lang === 'zh' ? '⚡ 全部同步' : (lang === 'ja' ? '⚡ すべて同期' : '⚡ Sync all'));
  set('btn-sync-all-tree', lang === 'zh' ? '⚡ 全部同步' : (lang === 'ja' ? '⚡ すべて同期' : '⚡ Sync all'));

  // Table Headers
  set('th-proj', lang === 'zh' ? '專案' : (lang === 'ja' ? 'プロジェクト' : 'Project'));
  set('th-path', lang === 'zh' ? '目錄路徑' : (lang === 'ja' ? 'パス' : 'Directory Path'));
  set('th-metrics', lang === 'zh' ? '指標' : (lang === 'ja' ? 'メトリクス' : 'Metrics'));
  set('th-status', lang === 'zh' ? '狀態' : (lang === 'ja' ? 'ステータス' : 'Status'));
  set('th-actions', lang === 'zh' ? '操作' : (lang === 'ja' ? '操作' : 'Actions'));

  // Language Page
  set('lbl-lang-page-title', lang === 'zh' ? '顯示語言設定' : (lang === 'ja' ? '表示言語の設定' : 'Display Language'));
  set('lbl-lang-page-desc', lang === 'zh' ? '選擇您偏好的介面顯示語言，系統將即時動態刷新全部介面。'
                          : (lang === 'ja' ? '希望するUI表示言語を選択してください。即座に適用されます。'
                          : 'Select your preferred user interface language. System will update dynamically.'));

  // LLM Page
  renderProvDialogLabels();
  updateLanguageCardsUI();
}


function updateActivityBarI18n() {
  const lang = currentLanguage;
  const setAttr = (id, attr, txt) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, txt); };

  const tipExplorer = lang === 'zh' ? '文件瀏覽器 (Explorer)'
                    : (lang === 'ja' ? 'ファイルエクスプローラー (Explorer)' : 'File Explorer (Explorer)');
  const tipConcepts = lang === 'zh' ? '概念標籤管理 (Concepts Registry)'
                    : (lang === 'ja' ? 'コンセプト管理 (Concepts Registry)' : 'Concepts Registry (Concepts)');
  const tipLint = lang === 'zh' ? '文庫體檢與治理 (Linting & Governance)'
                    : (lang === 'ja' ? 'ナレッジ検証とガバナンス (Linting & Governance)' : 'Knowledge Linting & Governance (Linting)');
  const tipPrompts = lang === 'zh' ? '提示詞管理 (Prompts Manager)'
                    : (lang === 'ja' ? 'プロンプト管理 (Prompts Manager)' : 'Prompts Manager (Prompts)');
  const tipSettings = lang === 'zh' ? '系統設定 (Settings)'
                    : (lang === 'ja' ? 'システム設定 (Settings)' : 'System Settings (Settings)');

  setAttr('act-tab-explorer', 'title', tipExplorer);
  setAttr('act-tab-concepts', 'title', tipConcepts);
  setAttr('act-tab-lint', 'title', tipLint);
  setAttr('act-tab-prompts', 'title', tipPrompts);
  setAttr('act-tab-settings', 'title', tipSettings);
}

function openFileInEditor(filePath, targetLine = 1) {
  if (typeof dispatchUnifiedSelection === 'function') {
    dispatchUnifiedSelection({ file: filePath, line: targetLine });
  } else {
    const fileId = `file::${filePath}`;
    const gNodes = (Graph && Graph.graphData) ? (Graph.graphData().nodes || []) : (rawData.nodes || []);
    const found = gNodes.find(n => n.id === fileId || (n.file && n.file.endsWith(filePath)));
    if (found) {
      selectActiveNode(found);
    } else {
      const repo = getActiveRepoPath();
      const absPath = repo ? `${repo}/${filePath}` : filePath;
      selectActiveNode({ id: fileId, name: filePath, file: filePath, abs_path: absPath, kind: 'file', line: targetLine });
    }
  }
}
// Browser-like page history (doc viewer header ‹ ›): every viewed page
// (document/section, tag page, candidate draft) is recorded; 上一頁 walks
// back, 下一頁 walks forward. New page after going back truncates the
// forward branch. Restores go through the SAME entry points (selection
// decree: explorer + 3D + viewer stay synced).
let navHist = [], navIdx = -1, navLock = false;
function navKey(s) {
  if (!s) return '';
  return (s.view || 'node') + '|' + (s.id || s.name || '');
}
function navRecord(snap) {
  if (navLock || !snap) return;
  try {
    const k = navKey(snap);
    if (!k) return;
    if (navIdx >= 0 && navHist[navIdx] && navKey(navHist[navIdx]) === k) return;
    navHist = navHist.slice(0, navIdx + 1);
    navHist.push(snap);
    if (navHist.length > 100) navHist.shift();
    navIdx = navHist.length - 1;
    navPaint();
  } catch (e) {}
}
function navRestore(snap) {
  if (!snap) return;
  if (snap.view === 'tag' && typeof onConceptCardClick === 'function') {
    onConceptCardClick(snap.name, null);
  } else if (snap.view === 'candidate' && typeof openCandidatePage === 'function') {
    openCandidatePage(snap.name, snap.source || 'prospect', null);
  } else if (snap.node) {
    if (typeof dispatchUnifiedSelection === 'function') {
      dispatchUnifiedSelection(snap.node);
    } else if (typeof selectActiveNode === 'function') {
      selectActiveNode(snap.node);
    }
  } else if (snap.id) {
    if (typeof dispatchUnifiedSelection === 'function') {
      dispatchUnifiedSelection(snap.id);
    }
  }
}
function navGo(dir) {
  const lang = (typeof currentLanguage !== 'undefined') ? currentLanguage : 'en';
  const zh = lang === 'zh', ja = lang === 'ja';
  try {
    const t = navIdx + dir;
    if (t < 0 || t >= navHist.length) {
      if (typeof showToast === 'function') showToast(t < 0
        ? (zh ? '已經是最早一頁' : (ja ? 'これ以上前に戻れません' : 'Already at the oldest page'))
        : (zh ? '已經是最新一頁' : (ja ? 'これ以上先に進めません' : 'Already at the newest page')));
      return;
    }
    navIdx = t;
    navLock = true;
    try { navRestore(navHist[t]); } finally { navLock = false; }
    navPaint();
  } catch (e) {}
}
function navPaint() {
  try {
    const pv = document.getElementById('btn-prev-node');
    const nx = document.getElementById('btn-next-node');
    const canBack = navIdx > 0, canFwd = navIdx >= 0 && navHist.length > 0 && navIdx < navHist.length - 1;
    if (pv) { pv.disabled = !canBack; pv.style.opacity = canBack ? '' : '0.4'; }
    if (nx) { nx.disabled = !canFwd; nx.style.opacity = canFwd ? '' : '0.4'; }
  } catch (e) {}
}
// Viewer back/forward button labels + tooltips (called from applyAppLanguage).
function updateViewerNavI18n() {
  try {
    const lang = (typeof currentLanguage !== 'undefined') ? currentLanguage : 'en';
    const zh = lang === 'zh', ja = lang === 'ja';
    const pv = document.getElementById('btn-prev-node');
    const nx = document.getElementById('btn-next-node');
    if (pv) {
      pv.textContent = zh ? '‹ 上一頁' : (ja ? '‹ 前へ' : '‹ Prev');
      pv.title = zh ? '回到上一個檢視（文件／段落／標籤／底稿）'
                    : (ja ? '前の表示に戻る（ドキュメント／見出し／タグ／候補）'
                          : 'Back to the previous view (document / section / tag / draft)');
    }
    if (nx) {
      nx.textContent = zh ? '下一頁 ›' : (ja ? '次へ ›' : 'Next ›');
      nx.title = zh ? '前進到下一個檢視'
                    : (ja ? '次の表示へ進む' : 'Forward to the next view');
    }
  } catch (e) {}
}
// Heading crumb (green › segment): open the SECTION, not the file top.
// Breadcrumb carries file + line + title; the viewer has no line-scroll,
// so we select a synthetic heading node and let /api/doc/section slice it
// (same semantics as clicking a heading in 3D). Falls back to file open.
function openHeadingInEditor(filePath, targetLine = 1, encTitle = '') {
  let title = '';
  try { title = decodeURIComponent(encTitle || ''); } catch (e) { title = encTitle || ''; }
  title = (title || '').trim();
  // Strip md link syntax BEFORE querying: the server substring-matches
  // against plain file headings, so `[T](url)` would never hit.
  if (typeof stripMdLinks === 'function') title = stripMdLinks(title).trim();
  if (!title) { openFileInEditor(filePath, targetLine); return; }

  if (typeof dispatchUnifiedSelection === 'function') {
    dispatchUnifiedSelection({ file: filePath, heading: title, line: targetLine || 1 });
  } else {
    selectActiveNode({
      id: `heading::${filePath}::L${targetLine || 1}::${title}`,
      name: title, file: filePath, abs_path: filePath,
      kind: 'heading', line: targetLine || 1
    });
  }
}

window.browseFolderPath = function() { if (typeof openBrowsePicker === 'function') openBrowsePicker(); };

function updateViewerTagToolbarI18n() {
  const lang = currentLanguage;
  const btnAttach = document.getElementById('btn-attach-tag-viewer');
  if (btnAttach) {
    btnAttach.textContent = lang === 'zh' ? '🏷️ + 貼標籤' : (lang === 'ja' ? '🏷️ + タグ付け' : '🏷️ + Attach Tag');
    btnAttach.title = lang === 'zh' ? '為此檔案或章節貼上概念標籤' : (lang === 'ja' ? 'このファイルまたは見出しにタグを付ける' : 'Attach concept tag to this document or section');
  }

  const lblTags = document.getElementById('lbl-doc-tags-title');
  if (lblTags) {
    lblTags.textContent = lang === 'zh' ? '概念標籤 (Tags):' : (lang === 'ja' ? 'タグ (Tags):' : 'Tags:');
  }
}



// ─── Concept Action Modals (+ New, Edit, Merge) ─────────────────────
let currentConceptActionState = null;

window.openAddConceptModal = function() {
  openConceptActionModal('add');
};

window.openEditConceptModal = function(name, category, aliases, event) {
  if (event) event.stopPropagation();
  openConceptActionModal('edit', { name, category, aliases });
};

window.openMergeConceptModal = function(sourceName, event) {
  if (event) event.stopPropagation();
  openConceptActionModal('merge', { sourceName });
};

window.openConceptActionModal = function(mode, data = {}) {
  currentConceptActionState = { mode, data };
  const modal = document.getElementById('concept-action-modal');
  if (!modal) return;

  const zh = currentLanguage === 'zh';
  const ja = currentLanguage === 'ja';

  const titleEl = document.getElementById('cpt-modal-title');
  const descEl = document.getElementById('cpt-modal-desc');
  const submitBtn = document.getElementById('btn-cpt-modal-submit');
  const cancelBtn = document.getElementById('btn-cpt-modal-cancel');

  const fieldCat = document.getElementById('cpt-field-category');
  const fieldName = document.getElementById('cpt-field-name');
  const fieldAliases = document.getElementById('cpt-field-aliases');
  const fieldTarget = document.getElementById('cpt-field-target');

  const txtCat = document.getElementById('txt-cpt-category');
  const selCat = document.getElementById('sel-cpt-category');
  const txtName = document.getElementById('txt-cpt-name');
  const txtAliases = document.getElementById('txt-cpt-aliases');
  const selTarget = document.getElementById('sel-cpt-target');

  const lblCat = document.getElementById('lbl-cpt-modal-cat');
  const lblName = document.getElementById('lbl-cpt-modal-name');
  const lblAliases = document.getElementById('lbl-cpt-modal-aliases');
  const tipAliases = document.getElementById('lbl-cpt-modal-aliases-tip');
  const lblTarget = document.getElementById('lbl-cpt-modal-target');
  const warnTarget = document.getElementById('lbl-cpt-modal-target-warn');

  // Full i18n synchronization for all static labels & placeholders
  if (lblCat) lblCat.textContent = zh ? '概念分類 (Category)' : (ja ? 'カテゴリ (Category)' : 'Category');
  if (txtCat) txtCat.placeholder = zh ? '例如：架構, 硬體, 商業, 專案...' : (ja ? '例：アーキテクチャ, ハードウェア, ビジネス...' : 'e.g. Architecture, Hardware, Business...');

  if (lblName) lblName.textContent = zh ? '概念標準名稱 (Concept Name)' : (ja ? '標準コンセプト名 (Concept Name)' : 'Concept Name');
  if (txtName) txtName.placeholder = zh ? '例如：微服務, 散熱模組, 電源管理...' : (ja ? '例：マイクロサービス, 熱設計, 電源管理...' : 'e.g. Microservices, Thermal Design, Power Management...');

  if (lblAliases) lblAliases.textContent = zh ? '別名與同義詞 (Aliases / 以逗號分隔)' : (ja ? '別名・同義語 (Aliases / カンマ区切り)' : 'Aliases & Synonyms (Comma separated)');
  if (txtAliases) txtAliases.placeholder = zh ? '例如：微服務架構, SOA, 分散式系統...' : (ja ? '例：SOA, 分散システム, マイクロサービス...' : 'e.g. SOA, Distributed Systems, Microservice Arch...');
  if (tipAliases) tipAliases.textContent = zh ? '多個別名請以逗號分隔，系統將自動比對知識圖譜。' : (ja ? '複数の別名はカンマで区切ってください。自動的に照合されます。' : 'Separate multiple aliases with commas. Graph will link matches automatically.');

  if (lblTarget) lblTarget.textContent = zh ? '合併匯入之目標概念 (Target Concept)' : (ja ? '統合先の対象コンセプト (Target Concept)' : 'Target Concept (Destination)');
  if (warnTarget) warnTarget.textContent = zh ? '⚠ 合併後來源概念將被刪除，其引用文件將全部重定向至目標概念。' : (ja ? '⚠ 統合後、元のコンセプトは削除され、全参照が対象コンセプトにリダイレクトされます。' : '⚠ After merging, source concept will be deleted and all references redirected to target.');

  if (cancelBtn) cancelBtn.textContent = zh ? '取消' : (ja ? 'キャンセル' : 'Cancel');

  // Populate existing categories dropdown
  if (selCat) {
    selCat.innerHTML = `<option value="">${zh ? '選擇現有分類…' : (ja ? '既存カテゴリを選択…' : 'Select category…')}</option>`;
    const tree = (conceptsTreeData && conceptsTreeData.tree) ? conceptsTreeData.tree : {};
    Object.keys(tree).forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = `📁 ${getCategoryDisplayName(cat)}`;
      selCat.appendChild(opt);
    });
  }

  if (mode === 'add') {
    if (titleEl) titleEl.textContent = zh ? '✨ 定義正式概念' : (ja ? '✨ 公式コンセプトの定義' : '✨ Define Official Concept');
    if (descEl) descEl.textContent = zh ? '定義知識庫核心概念詞彙，並可設定其分類與多重別名。' : (ja ? '知識ベースの公式コア概念を定義し、カテゴリと別名を設定します。' : 'Define an official knowledge concept with category and aliases.');
    if (submitBtn) submitBtn.textContent = zh ? '建立概念' : (ja ? '作成' : 'Create Concept');

    if (fieldCat) fieldCat.style.display = 'block';
    if (fieldName) fieldName.style.display = 'block';
    if (fieldAliases) fieldAliases.style.display = 'block';
    if (fieldTarget) fieldTarget.style.display = 'none';

    if (txtCat) txtCat.value = '';
    if (txtName) { txtName.value = ''; txtName.disabled = false; }
    if (txtAliases) txtAliases.value = '';

  } else if (mode === 'promote') {
    // Approve a candidate into the official registry. The candidate's
    // name is the default (editable); same-name save flips its status.
    if (titleEl) titleEl.textContent = zh ? `✓ 審批入典「${data.name}」` : (ja ? `✓ コンセプト「${data.name}」の承認` : `✓ Promote '${data.name}'`);
    if (descEl) descEl.textContent = zh ? '將候選詞確立為正式核心概念，可調整分類與別名；確認後寫入官方註冊表。' : (ja ? '候補を公式コア概念として確定します。カテゴリと別名を調整できます。' : 'Promote this candidate into the official registry; adjust category and aliases.');
    if (submitBtn) submitBtn.textContent = zh ? '審批為正式' : (ja ? '承認して正式化' : 'Promote to Official');

    if (fieldCat) fieldCat.style.display = 'block';
    if (fieldName) fieldName.style.display = 'block';
    if (fieldAliases) fieldAliases.style.display = 'block';
    if (fieldTarget) fieldTarget.style.display = 'none';

    if (txtCat) txtCat.value = data.category || '';
    if (txtName) { txtName.value = data.name || ''; txtName.disabled = false; }
    if (txtAliases) txtAliases.value = '';

  } else if (mode === 'edit') {
    if (titleEl) titleEl.textContent = zh ? `✏️ 編輯概念「${data.name}」` : (ja ? `✏️ コンセプト「${data.name}」の編集` : `✏️ Edit Concept '${data.name}'`);
    if (descEl) descEl.textContent = zh ? '修改概念標籤所屬分類與搜尋同義詞別名。' : (ja ? 'カテゴリおよび検索用別名・シノニムを変更します。' : 'Modify concept category and search aliases.');
    if (submitBtn) submitBtn.textContent = zh ? '儲存變更' : (ja ? '保存' : 'Save Changes');

    if (fieldCat) fieldCat.style.display = 'block';
    if (fieldName) fieldName.style.display = 'block';
    if (fieldAliases) fieldAliases.style.display = 'block';
    if (fieldTarget) fieldTarget.style.display = 'none';

    if (txtCat) txtCat.value = data.category || '';
    if (txtName) { txtName.value = data.name || ''; txtName.disabled = true; }
    const aliasStr = Array.isArray(data.aliases) ? data.aliases.join(', ') : (data.aliases || '');
    if (txtAliases) txtAliases.value = aliasStr;

  } else if (mode === 'merge') {
    if (titleEl) titleEl.textContent = zh ? `🔗 合併概念「${data.sourceName}」` : (ja ? `🔗 コンセプト「${data.sourceName}」の統合` : `🔗 Merge Concept '${data.sourceName}'`);
    if (descEl) descEl.textContent = zh ? `將「${data.sourceName}」的所有引用文件重定向整合至另一個目標概念，並將其自動轉為別名。` : (ja ? `「${data.sourceName}」の全参照を対象コンセプトに統合し、別名として登録します。` : `Merge all references of '${data.sourceName}' into target concept and save as alias.`);
    if (submitBtn) submitBtn.textContent = zh ? '確認合併' : (ja ? '統合を実行' : 'Confirm Merge');

    if (fieldCat) fieldCat.style.display = 'none';
    if (fieldName) fieldName.style.display = 'none';
    if (fieldAliases) fieldAliases.style.display = 'none';
    if (fieldTarget) fieldTarget.style.display = 'block';

    // Populate target concepts (excluding source)
    if (selTarget) {
      selTarget.innerHTML = `<option value="">${zh ? '-- 選擇目標概念 --' : (ja ? '-- 統合先を選択 --' : '-- Select Target Concept --')}</option>`;
      const tree = (conceptsTreeData && conceptsTreeData.tree) ? conceptsTreeData.tree : {};
      Object.keys(tree).forEach(cat => {
        const grp = document.createElement('optgroup');
        grp.label = `📁 ${cat}`;
        (tree[cat] || []).forEach(item => {
          if (item.name !== data.sourceName) {
            const opt = document.createElement('option');
            opt.value = item.name;
            opt.textContent = `🏷️ ${item.name}`;
            grp.appendChild(opt);
          }
        });
        if (grp.children.length) selTarget.appendChild(grp);
      });
    }
  }

  modal.style.display = 'flex';
  modal.classList.add('show');
};

window.closeConceptActionModal = function() {
  const modal = document.getElementById('concept-action-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('show');
  }
  currentConceptActionState = null;
};

window.submitConceptActionModal = function() {
  if (!currentConceptActionState) return;
  const { mode, data } = currentConceptActionState;
  const zh = currentLanguage === 'zh';
  const ja = currentLanguage === 'ja';
  const repo = getActiveRepoPath();

  if (mode === 'add' || mode === 'edit' || mode === 'promote') {
    const name = (document.getElementById('txt-cpt-name').value || '').trim();
    let rawCategory = (document.getElementById('txt-cpt-category').value || '').trim();
    const category = (!rawCategory || rawCategory === '未分類' || rawCategory === 'Uncategorized') ? 'Uncategorized' : rawCategory;
    const aliases = (document.getElementById('txt-cpt-aliases').value || '').trim();

    if (!name) {
      alert(zh ? '請輸入概念標準名稱！' : 'Please enter a concept name!');
      return;
    }

    fetch('/api/concepts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, name, category, aliases, status: 'official' })
    })
      .then(r => r.json())
      .then(res => {
        if (res.ok) {
          showToast(zh ? `✅ 概念標籤「${name}」儲存成功！` : `✅ Concept '${name}' saved!`);
          closeConceptActionModal();
          fetchConceptsData();
          loadMasterGraphAndFilter();
          setTimeout(() => { if (typeof buildProjectTree === 'function') buildProjectTree(); }, 150);
          if (typeof onConceptCardClick === 'function') onConceptCardClick(name);
        } else {
          alert(res.error || 'Failed to save concept');
        }
      })
      .catch(e => alert('Request error: ' + e));

  } else if (mode === 'merge') {
    const selTarget = document.getElementById('sel-cpt-target');
    const target = selTarget ? selTarget.value : '';
    const source = data.sourceName;

    if (!target) {
      alert(zh ? '請選擇要合併的目標概念！' : 'Please select a target concept!');
      return;
    }

    fetch('/api/concepts/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, source, target, addAsAlias: true })
    })
      .then(r => r.json())
      .then(res => {
        if (res.ok) {
          showToast(zh ? `✅ 已將「${source}」合併至「${target}」！` : `✅ Merged '${source}' into '${target}'!`);
          closeConceptActionModal();
          fetchConceptsData();
          loadMasterGraphAndFilter();
          setTimeout(() => { if (typeof buildProjectTree === 'function') buildProjectTree(); }, 150);
          if (typeof onConceptCardClick === 'function') onConceptCardClick(target);
        } else {
          alert(res.error || 'Failed to merge concepts');
        }
      })
      .catch(e => alert('Merge error: ' + e));
  }
};




window.deleteConcept = function(conceptName, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const zh = currentLanguage === 'zh';
  const ja = currentLanguage === 'ja';
  const repo = getActiveRepoPath();

  const title = zh ? '⚠ 永久刪除概念標籤' : (ja ? '⚠ コンセプトタグの完全削除' : '⚠ Delete Concept Tag Permanently');
  const msg = zh 
    ? `確定要永久刪除概念標籤「${conceptName}」嗎？\n\n⚠ 此操作將：\n1. 從 SQLite 資料庫註冊表中徹底清除該概念。\n2. 自動搜尋並清除所有引用此標籤之 Markdown 文件的關聯標記！\n3. 刪除對應的標籤說明文件。`
    : (ja 
      ? `コンセプトタグ「${conceptName}」を完全に削除しますか？\n\n⚠ この操作により：\n1. SQLite データベースから完全に削除されます。\n2. 参照しているすべての Markdown ファイルから該当タグが削除されます。\n3. 対応するタグ定義ファイルも削除されます。`
      : `Are you sure you want to permanently delete concept tag '${conceptName}'?\n\n⚠ This action will:\n1. Completely remove it from the SQLite registry.\n2. Automatically wipe this tag mark from all referencing Markdown documents!\n3. Remove the corresponding tag document.`);

  const confirmText = zh ? '永久刪除' : (ja ? '完全に削除' : 'Delete Permanently');
  const cancelText = zh ? '取消' : (ja ? 'キャンセル' : 'Cancel');
  const tip = zh ? '💡 提示：此標籤在所有 Markdown 文檔內的 [[Tag]] 參照標記將被一併移除。' : (ja ? '💡 ヒント：すべての Markdown ドキュメント内の [[Tag]] 参照も削除されます。' : '💡 Note: References in all Markdown files will be cleaned automatically.');

  showCyberConfirm(title, msg, () => {
    fetch('/api/concepts/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, name: conceptName, cleanDisk: true })
    })
      .then(async res => {
        const text = await res.text();
        try {
          return { status: res.status, ok: res.ok, data: JSON.parse(text) };
        } catch (err) {
          throw new Error(`Server returned ${res.status}: ${text.slice(0, 150)}`);
        }
      })
      .then(({ status, ok, data }) => {
        if (ok && data && data.ok) {
          showToast(zh ? `🗑️ 已徹底刪除概念標籤「${conceptName}」！` : (ja ? `🗑️ 概念タグ「${conceptName}」を削除しました！` : `🗑️ Deleted concept '${conceptName}'!`));
          fetchConceptsData();
          loadMasterGraphAndFilter();
          setTimeout(() => {
            if (typeof buildProjectTree === 'function') buildProjectTree();
          }, 150);
          // If viewing this tag page, reset viewer
          if (selectedConceptName === conceptName) {
            selectedConceptName = null;
            const container = document.getElementById('d-code-markdown');
            if (container) {
              container.innerHTML = `<div class="doc-placeholder-state"><div style="font-size:28px; margin-bottom:8px;">📄</div><div style="font-size:14px; color:#8b949e;">${zh ? '標籤已被刪除' : 'Tag was deleted'}</div></div>`;
            }
          }
        } else {
          alert(data?.error || `Failed to delete concept (HTTP ${status})`);
        }
      })
      .catch(e => alert('Delete error: ' + e.message));
  }, { confirmText, cancelText, tip });
};



// ─── Prompts Manager Module ──────────────────────────────────────────
let activePromptsData = {};
let defaultPromptsData = {};
let promptFilterText = '';
let currentPromptCategory = 'all'; // 'all' | 'concept' | 'crawl' | 'ingest'

function getPromptCategory(key) {
  if (key.startsWith('concept_')) return 'concept';
  if (key.startsWith('crawl_')) return 'crawl';
  if (key.startsWith('ingest_')) return 'ingest';
  return 'other';
}

function switchPromptCategory(cat) {
  currentPromptCategory = cat;
  const tabs = ['all', 'concept', 'crawl', 'ingest'];
  tabs.forEach(t => {
    const btn = document.getElementById(`btn-pmt-cat-${t}`);
    if (btn) {
      if (t === cat) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  renderPromptsList();
}

function updatePromptsI18n() {
  const lang = currentLanguage;
  const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setAttr = (id, attr, txt) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, txt); };

  const title = lang === 'zh' ? '提示詞管理' : (lang === 'ja' ? 'プロンプト管理' : 'PROMPTS MANAGER');
  const refresh = lang === 'zh' ? '↻ 重新整理' : (lang === 'ja' ? '↻ 更新' : '↻ Refresh');
  const ph = lang === 'zh' ? '搜尋提示詞...' : (lang === 'ja' ? 'プロンプトを検索...' : 'Search prompts...');

  setTxt('lbl-drawer-prompts-title', title);
  setTxt('btn-refresh-prompts', refresh);
  setAttr('prompt-search', 'placeholder', ph);

  // Category tab button labels
  const tabAll = document.getElementById('btn-pmt-cat-all');
  const tabConcept = document.getElementById('btn-pmt-cat-concept');
  const tabCrawl = document.getElementById('btn-pmt-cat-crawl');
  const tabIngest = document.getElementById('btn-pmt-cat-ingest');

  const countAll = document.getElementById('count-pmt-all')?.textContent || '0';
  const countConcept = document.getElementById('count-pmt-concept')?.textContent || '0';
  const countCrawl = document.getElementById('count-pmt-crawl')?.textContent || '0';
  const countIngest = document.getElementById('count-pmt-ingest')?.textContent || '0';

  if (tabAll) tabAll.innerHTML = `${lang === 'zh' ? '全部' : (lang === 'ja' ? 'すべて' : 'All')} (<span id="count-pmt-all">${countAll}</span>)`;
  if (tabConcept) tabConcept.innerHTML = `${lang === 'zh' ? '概念發掘' : (lang === 'ja' ? '概念抽出' : 'Concepts')} (<span id="count-pmt-concept">${countConcept}</span>)`;
  if (tabCrawl) tabCrawl.innerHTML = `${lang === 'zh' ? '順藤摸瓜' : (lang === 'ja' ? '知識探索' : 'Vine Crawl')} (<span id="count-pmt-crawl">${countCrawl}</span>)`;
  if (tabIngest) tabIngest.innerHTML = `${lang === 'zh' ? '文件攝入' : (lang === 'ja' ? '文書取込' : 'Ingestion')} (<span id="count-pmt-ingest">${countIngest}</span>)`;

  if (currentActivityTab === 'prompts') {
    renderPromptsList();
  }
}

function filterPrompts(query) {
  promptFilterText = (query || '').trim().toLowerCase();
  renderPromptsList();
}

function clearPromptFilter() {
  const input = document.getElementById('prompt-search');
  if (input) input.value = '';
  promptFilterText = '';
  renderPromptsList();
}

function refreshPromptsList() {
  loadPromptsDrawerList(true);
}

function loadPromptsDrawerList(showFeedback = false) {
  const container = document.getElementById('prompts-list-container');
  if (!container) return;

  if (showFeedback || !Object.keys(activePromptsData).length) {
    container.innerHTML = `<div style="color:#8b949e; font-size:13px; padding:12px; text-align:center;">Loading prompts...</div>`;
  }

  fetch('/api/prompts')
    .then(res => res.json())
    .then(data => {
      if (data && data.ok) {
        activePromptsData = data.prompts || {};
        defaultPromptsData = data.defaults || {};
        renderPromptsList();
        if (showFeedback) {
          showToast(currentLanguage === 'zh' ? '提示詞清單已更新' : (currentLanguage === 'ja' ? 'プロンプト一覧を更新しました' : 'Prompts refreshed'));
        }
      } else {
        container.innerHTML = `<div style="color:#f85149; font-size:13px; padding:12px;">Failed: ${data?.error || 'Unknown error'}</div>`;
      }
    })
    .catch(err => {
      container.innerHTML = `<div style="color:#f85149; font-size:13px; padding:12px;">Network error: ${err.message}</div>`;
    });
}

function renderPromptsList() {
  const container = document.getElementById('prompts-list-container');
  if (!container) return;

  const lang = currentLanguage;
  const zh = lang === 'zh';
  const ja = lang === 'ja';

  const lblSystem = zh ? 'System 角色提示詞' : (ja ? 'システムプロンプト (System)' : 'System Role Prompt');
  const lblUser = zh ? 'User 模板提示詞' : (ja ? 'ユーザープロンプト雛形 (User Template)' : 'User Template Prompt');
  const btnSave = zh ? '儲存' : (ja ? '保存' : 'Save');
  const btnReset = zh ? '回到預設' : (ja ? '既定値に戻す' : 'Reset to Default');
  const noMatch = zh ? '無相符提示詞' : (ja ? '一致するプロンプトがありません' : 'No matching prompts');

  const keys = Object.keys(activePromptsData);
  if (!keys.length) {
    container.innerHTML = `<div style="color:#8b949e; font-size:13px; padding:12px; text-align:center;">No prompts available</div>`;
    return;
  }

  // Update counts for category tabs
  let cAll = keys.length, cConcept = 0, cCrawl = 0, cIngest = 0;
  keys.forEach(k => {
    const cat = getPromptCategory(k);
    if (cat === 'concept') cConcept++;
    else if (cat === 'crawl') cCrawl++;
    else if (cat === 'ingest') cIngest++;
  });
  const elCountAll = document.getElementById('count-pmt-all');
  const elCountConcept = document.getElementById('count-pmt-concept');
  const elCountCrawl = document.getElementById('count-pmt-crawl');
  const elCountIngest = document.getElementById('count-pmt-ingest');
  if (elCountAll) elCountAll.textContent = cAll;
  if (elCountConcept) elCountConcept.textContent = cConcept;
  if (elCountCrawl) elCountCrawl.textContent = cCrawl;
  if (elCountIngest) elCountIngest.textContent = cIngest;

  let html = '';
  let matchCount = 0;

  const PROMPT_TITLES_I18N = {
    zh: {
      concept_scan: '概念發掘審查',
      crawl_seed: '順藤摸瓜：起點帶路',
      crawl_file: '順藤摸瓜：逐檔摸瓜提取',
      crawl_finish: '順藤摸瓜：整輪終審',
      ingest_text: '文件攝入：純文字摘要',
      ingest_vision: '文件攝入：圖片/多模態摘要'
    },
    en: {
      concept_scan: 'Concept Scan Curation',
      crawl_seed: 'Vine Crawl: Seed Footholds',
      crawl_file: 'Vine Crawl: File Inspection',
      crawl_finish: 'Vine Crawl: Final Review',
      ingest_text: 'Ingestion: Text Document Summary',
      ingest_vision: 'Ingestion: Multimodal / Image Summary'
    },
    ja: {
      concept_scan: '概念キュレーション審査',
      crawl_seed: '知識探索：起点案内',
      crawl_file: '知識探索：ファイル別抽出',
      crawl_finish: '知識探索：最終審査',
      ingest_text: '文書取り込み：テキスト要約',
      ingest_vision: '文書取り込み：画像・マルチモーダル要約'
    }
  };

  keys.forEach(key => {
    const cat = getPromptCategory(key);
    // Category filtering
    if (currentPromptCategory !== 'all' && cat !== currentPromptCategory) {
      return;
    }

    const p = activePromptsData[key] || {};
    const localizedTitle = PROMPT_TITLES_I18N[lang]?.[key] || PROMPT_TITLES_I18N['zh']?.[key] || p.name || key;
    const name = localizedTitle;
    const sys = p.system || '';
    const tmpl = p.template || '';

    // Filter by promptFilterText (matches key, name, or content)
    if (promptFilterText) {
      const matchKey = key.toLowerCase().includes(promptFilterText);
      const matchName = name.toLowerCase().includes(promptFilterText);
      const matchSys = sys.toLowerCase().includes(promptFilterText);
      const matchTmpl = tmpl.toLowerCase().includes(promptFilterText);
      if (!matchKey && !matchName && !matchSys && !matchTmpl) return;
    }

    matchCount++;
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');

    html += `
      <div class="prompt-card" id="card-prompt-${safeKey}">
        <div class="prompt-card-header">
          <span class="prompt-card-title">${escapeHtml(name)}</span>
          <span class="prompt-card-key">${escapeHtml(key)}</span>
        </div>

        <div class="prompt-field-label">${lblSystem}</div>
        <textarea id="prompt-sys-${safeKey}" class="prompt-textarea" rows="3">${escapeHtml(sys)}</textarea>

        <div class="prompt-field-label">${lblUser}</div>
        <textarea id="prompt-tmpl-${safeKey}" class="prompt-textarea" rows="7">${escapeHtml(tmpl)}</textarea>

        <div class="prompt-card-actions">
          <button class="mini-btn" onclick="resetPromptToDefault('${key}', '${safeKey}')" title="${btnReset}">↺ ${btnReset}</button>
          <button class="mini-btn" style="background:#238636; color:#fff; border-color:#2ea043;" onclick="savePromptKey('${key}', '${safeKey}')" title="${btnSave}">💾 ${btnSave}</button>
        </div>
      </div>
    `;
  });

  if (matchCount === 0) {
    container.innerHTML = `<div style="color:#8b949e; font-size:13px; padding:16px; text-align:center;">${noMatch}</div>`;
  } else {
    container.innerHTML = html;
  }
}

function savePromptKey(key, safeKey) {
  const sysEl = document.getElementById(`prompt-sys-${safeKey}`);
  const tmplEl = document.getElementById(`prompt-tmpl-${safeKey}`);
  if (!sysEl || !tmplEl) return;

  const system = sysEl.value;
  const template = tmplEl.value;
  const name = activePromptsData[key]?.name || key;

  fetch('/api/prompts/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, system, template, name })
  })
    .then(res => res.json())
    .then(data => {
      if (data && data.ok) {
        if (!activePromptsData[key]) activePromptsData[key] = {};
        activePromptsData[key].system = system;
        activePromptsData[key].template = template;
        showToast(currentLanguage === 'zh' ? `✅ 提示詞 [${name}] 已成功儲存！` : (currentLanguage === 'ja' ? `✅ プロンプト [${name}] を保存しました！` : `✅ Prompt [${name}] saved!`));
      } else {
        showToast('❌ Save failed: ' + (data?.error || 'Unknown error'));
      }
    })
    .catch(err => showToast('❌ Save error: ' + err.message));
}

function resetPromptToDefault(key, safeKey) {
  const lang = currentLanguage;
  const zh = lang === 'zh';
  const ja = lang === 'ja';

  // Retrieve built-in default for current language if loaded
  const langKey = (defaultPromptsData && defaultPromptsData[lang]) ? lang : 'zh';
  const defItem = (defaultPromptsData && defaultPromptsData[langKey] && defaultPromptsData[langKey][key]) || null;
  const defSys = defItem ? defItem.system : '';
  const defTmpl = defItem ? defItem.template : '';
  const promptName = (activePromptsData[key]?.name) || key;

  const langNames = { zh: '繁體中文', en: 'English', ja: '日本語' };
  const langLabel = langNames[lang] || lang;

  const title = zh ? '↺ 還原預設提示詞確認' : (ja ? '↺ 既定プロンプトへの復元確認' : '↺ Reset Prompt to Default Confirmation');

  const previewHtml = `
    <div style="font-size:13.5px; line-height:1.6; margin-bottom:12px;">
      ${zh
        ? `確定要將提示詞 <strong>「${escapeHtml(promptName)}」</strong> 重設回 <strong>[${langLabel}]</strong> 官方預設範本嗎？`
        : (ja
          ? `プロンプト <strong>「${escapeHtml(promptName)}」</strong> を <strong>[${langLabel}]</strong> 公式既定テンプレートに戻しますか？`
          : `Reset prompt <strong>"${escapeHtml(promptName)}"</strong> to official default template for <strong>[${langLabel}]</strong>?`)}
    </div>
    ${defItem ? `
      <div style="background:#090d13; border:1px solid #30363d; border-radius:6px; padding:10px 12px; max-height:220px; overflow-y:auto; font-size:12px; font-family:monospace; color:#c9d1d9; text-align:left;">
        <div style="color:#58a6ff; font-weight:600; margin-bottom:4px;">[System Role]:</div>
        <div style="white-space:pre-wrap; margin-bottom:8px; color:#8b949e; background:#161b22; padding:6px; border-radius:4px;">${escapeHtml(defSys || '(無)')}</div>
        <div style="color:#3fb950; font-weight:600; margin-bottom:4px;">[User Template]:</div>
        <div style="white-space:pre-wrap; color:#e6edf3; background:#161b22; padding:6px; border-radius:4px;">${escapeHtml(defTmpl || '')}</div>
      </div>
    ` : ''}
  `;

  const tip = zh
    ? `💡 點擊「確定還原」後，將直接替換編輯器內文並儲存至伺服器設定。`
    : (ja
      ? `💡 「復元を実行」をクリックすると、エディタ内容を置換し保存します。`
      : `💡 Clicking "Reset Now" will replace current edits and save to settings.`);

  showCyberConfirm(title, '', () => {
    fetch('/api/prompts/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, lang })
    })
      .then(res => res.json())
      .then(data => {
        if (data && data.ok && data.data) {
          const sysEl = document.getElementById(`prompt-sys-${safeKey}`);
          const tmplEl = document.getElementById(`prompt-tmpl-${safeKey}`);
          if (sysEl) sysEl.value = data.data.system || '';
          if (tmplEl) tmplEl.value = data.data.template || '';

          if (!activePromptsData[key]) activePromptsData[key] = {};
          activePromptsData[key].system = data.data.system || '';
          activePromptsData[key].template = data.data.template || '';
          activePromptsData[key].name = data.data.name || activePromptsData[key].name;

          showToast(zh ? `↺ 已成功還原「${promptName}」為 [${langLabel}] 預設提示詞！` : (ja ? `↺ 「${promptName}」を [${langLabel}] 既定値に戻しました！` : `↺ Reset "${promptName}" to [${langLabel}] default!`));
        } else {
          showToast('❌ Reset failed: ' + (data?.error || 'Unknown error'));
        }
      })
      .catch(err => showToast('❌ Reset error: ' + err.message));
  }, {
    html: previewHtml,
    tip: tip,
    titleColor: '#58a6ff',
    confirmText: zh ? '確定還原' : (ja ? '復元を実行' : 'Reset Now'),
    cancelText: zh ? '取消' : (ja ? 'キャンセル' : 'Cancel'),
    btnBg: '#1f6feb',
    btnBorder: '#388bfd'
  });
}



// ─── Knowledge Base Linting & Governance Engine (Instant 0-Token) ────
let lastLintData = null;
let lastLintRepo = null;
let lastLintTimestamp = 0;
let isLintScanning = false;

function updateLintI18n() {
  const lang = currentLanguage;
  const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const title = lang === 'zh' ? '文庫體檢與治理' : (lang === 'ja' ? 'ナレッジ検証とガバナンス' : 'LINTING & GOVERNANCE');
  const btnScan = lang === 'zh' ? '↻ 重新體檢' : (lang === 'ja' ? '↻ スキャン' : '↻ Scan');
  setTxt('lbl-drawer-lint-title', title);
  setTxt('btn-refresh-lint', btnScan);
  if (lastLintData) renderLintResults(lastLintData);
}

function refreshLintResults(force = false) {
  const repo = getActiveRepoPath();
  const now = Date.now();
  // 5-second cache if same repo unless force clicked
  if (!force && lastLintData && lastLintRepo === repo && (now - lastLintTimestamp < 5000)) {
    renderLintResults(lastLintData);
    return;
  }
  if (isLintScanning) return;
  isLintScanning = true;

  const btn = document.getElementById('btn-refresh-lint');
  if (btn) btn.textContent = 'Scanning...';

  const url = `/api/lint?repo=${encodeURIComponent(repo || '')}`;
  fetch(url)
    .then(r => r.json())
    .then(data => {
      isLintScanning = false;
      if (btn) btn.textContent = currentLanguage === 'zh' ? '↻ 重新體檢' : (currentLanguage === 'ja' ? '↻ スキャン' : '↻ Scan');
      if (data && data.ok) {
        lastLintData = data;
        lastLintRepo = repo;
        lastLintTimestamp = Date.now();
        renderLintResults(data);
      } else {
        const container = document.getElementById('lint-list-container');
        if (container) container.innerHTML = `<div style="padding:15px; color:#f85149; font-size:12px;">❌ 體檢失敗: ${escapeHtml(data?.error || 'Unknown error')}</div>`;
      }
    })
    .catch(err => {
      isLintScanning = false;
      if (btn) btn.textContent = currentLanguage === 'zh' ? '↻ 重新體檢' : (currentLanguage === 'ja' ? '↻ スキャン' : '↻ Scan');
      const container = document.getElementById('lint-list-container');
      if (container) container.innerHTML = `<div style="padding:15px; color:#f85149; font-size:12px;">❌ 網路連線錯誤: ${escapeHtml(err.message)}</div>`;
    });
}

function updateLintBadgeOnly() {
  const repo = getActiveRepoPath();
  const url = `/api/lint?repo=${encodeURIComponent(repo || '')}`;
  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (data && data.ok) {
        lastLintData = data;
        lastLintRepo = repo;
        lastLintTimestamp = Date.now();
        const deadCount = (data.dead_links || []).length;
        const orphanCount = (data.orphans || []).length;
        const noH1Count = (data.no_h1_files || []).length;
        const missingCatalogCount = (data.catalog_missing_files || []).length + (!data.catalog_exists ? 1 : 0);
        const totalIssues = deadCount + orphanCount + noH1Count + missingCatalogCount;
        const badgeIssues = document.getElementById('badge-lint-issues');
        if (badgeIssues) {
          if (totalIssues > 0) {
            badgeIssues.textContent = totalIssues > 99 ? '99+' : totalIssues;
            badgeIssues.style.display = 'inline-block';
            badgeIssues.style.background = deadCount > 0 ? '#da3633' : '#d29922';
            badgeIssues.style.color = '#ffffff';
          } else {
            badgeIssues.style.display = 'none';
          }
        }
      }
    })
    .catch(() => {});
}

function renderLintResults(data) {
  const zh = (currentLanguage === 'zh');
  const ja = (currentLanguage === 'ja');

  // Update Score & Status Badge
  const scoreVal = document.getElementById('lint-score-val');
  const statusBadge = document.getElementById('lint-status-badge');
  const timeCost = document.getElementById('lint-time-cost');
  const badgeIssues = document.getElementById('badge-lint-issues');

  const score = Number(data.score) || 0;
  if (scoreVal) {
    let scoreColor = '#3fb950'; // green
    if (score < 60) scoreColor = '#f85149'; // red
    else if (score < 85) scoreColor = '#d29922'; // orange
    scoreVal.style.color = scoreColor;
    scoreVal.innerHTML = `${score}<span class="lint-score-total"> / 100</span>`;
  }

  if (statusBadge) {
    if (score >= 90) {
      statusBadge.textContent = zh ? '極佳' : (ja ? '良好' : 'HEALTHY');
      statusBadge.style.background = '#238636';
    } else if (score >= 70) {
      statusBadge.textContent = zh ? '待整理' : (ja ? '要注意' : 'WARNING');
      statusBadge.style.background = '#9e6a03';
    } else {
      statusBadge.textContent = zh ? '需維護' : (ja ? '要改善' : 'CRITICAL');
      statusBadge.style.background = '#da3633';
    }
  }

  if (timeCost) {
    timeCost.textContent = `${data.duration_ms || 2} ms · ${data.total_files || 0} docs`;
  }

  // Calculate total issues
  const deadCount = (data.dead_links || []).length;
  const orphanCount = (data.orphans || []).length;
  const noH1Count = (data.no_h1_files || []).length;
  const missingCatalogCount = (data.catalog_missing_files || []).length + (!data.catalog_exists ? 1 : 0);
  const totalIssues = deadCount + orphanCount + noH1Count + missingCatalogCount;

  if (badgeIssues) {
    if (totalIssues > 0) {
      badgeIssues.textContent = totalIssues > 99 ? '99+' : totalIssues;
      badgeIssues.style.display = 'block';
      badgeIssues.style.background = deadCount > 0 ? '#da3633' : '#d29922';
    } else {
      badgeIssues.style.display = 'none';
    }
  }

  const container = document.getElementById('lint-list-container');
  if (!container) return;

  let html = '';

  // Card 1: Dead Links (Most Critical)
  const deadTitle = zh ? '失效死鏈' : (ja ? '切れたリンク' : 'Broken Links');
  html += `
  <div class="lint-section-card">
    <div class="lint-section-header" style="background:rgba(218, 54, 51, 0.12);">
      <span class="lint-section-title" style="color:#f85149;">
        🔗 ${deadTitle}
      </span>
      <span class="lint-count-badge" style="background:${deadCount > 0 ? '#da3633' : '#238636'};">${deadCount}</span>
    </div>
    <div style="max-height:220px; overflow-y:auto;">
  `;
  if (deadCount === 0) {
    html += `<div class="lint-section-body" style="color:#8b949e;">${zh ? '全庫無任何失效死鏈' : (ja ? 'リンク切れはありません' : 'Zero broken links')}</div>`;
  } else {
    data.dead_links.forEach(dl => {
      const fileName = dl.file ? dl.file.split(/[\\/]/).pop() : 'doc.md';
      html += `
        <div class="lint-item-row" onclick="openFileInEditor('${escapeHtml(dl.file)}', ${dl.line || 1})" title="${zh ? '點擊跳轉至出錯文檔' : 'Click to inspect'}">
          <div style="min-width:0; flex:1;">
            <div class="lint-item-title">📄 ${escapeHtml(fileName)} <span style="color:#f85149; font-weight:600;">:L${dl.line || 1}</span></div>
            <div class="lint-item-sub">➔ ${escapeHtml(dl.target)}</div>
          </div>
          <span class="lint-item-btn">Jump ›</span>
        </div>
      `;
    });
  }
  html += `</div></div>`;

  // Card 2: Orphan Files
  const orphanTitle = zh ? '孤島文檔 (無引用無關聯)' : (ja ? '孤立ドキュメント' : 'Orphan Documents');
  html += `
  <div class="lint-section-card">
    <div class="lint-section-header" style="background:rgba(210, 153, 34, 0.12);">
      <span class="lint-section-title" style="color:#d29922;">
        🏝️ ${orphanTitle}
      </span>
      <span class="lint-count-badge" style="background:${orphanCount > 0 ? '#9e6a03' : '#238636'};">${orphanCount}</span>
    </div>
    <div style="max-height:220px; overflow-y:auto;">
  `;
  if (orphanCount === 0) {
    html += `<div class="lint-section-body" style="color:#8b949e;">${zh ? '所有文檔均有拓撲引用網絡' : (ja ? 'すべての文書がリンクされています' : 'All documents are connected')}</div>`;
  } else {
    data.orphans.forEach(filePath => {
      const fileName = filePath.split(/[\\/]/).pop();
      html += `
        <div class="lint-item-row" onclick="openFileInEditor('${escapeHtml(filePath)}', 1)" title="${zh ? '開啟文檔' : 'Open document'}">
          <div class="lint-item-title" style="min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis;">📄 ${escapeHtml(fileName)}</div>
          <span class="lint-item-btn">${zh ? '開啟' : 'Open'} ›</span>
        </div>
      `;
    });
  }
  html += `</div></div>`;

  // Card 3: Syntax & Heading H1 Integrity
  const h1Title = zh ? '標題語法完整性 (缺少 H1 首標題)' : (ja ? 'H1 見出し欠落' : 'Heading H1 Integrity');
  html += `
  <div class="lint-section-card">
    <div class="lint-section-header" style="background:rgba(88, 166, 255, 0.12);">
      <span class="lint-section-title" style="color:#58a6ff;">
        📝 ${h1Title}
      </span>
      <span class="lint-count-badge" style="background:${noH1Count > 0 ? '#1f6feb' : '#238636'};">${noH1Count}</span>
    </div>
    <div style="max-height:220px; overflow-y:auto;">
  `;
  if (noH1Count === 0) {
    html += `<div class="lint-section-body" style="color:#8b949e;">${zh ? '所有文檔均有規範 H1 標題' : (ja ? 'すべての文書に見出しがあります' : 'All docs have valid H1')}</div>`;
  } else {
    data.no_h1_files.forEach(filePath => {
      const fileName = filePath.split(/[\\/]/).pop();
      html += `
        <div class="lint-item-row" onclick="openFileInEditor('${escapeHtml(filePath)}', 1)" title="${zh ? '點擊跳轉修復' : 'Click to fix'}">
          <div class="lint-item-title" style="min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis;">📄 ${escapeHtml(fileName)} <span style="color:#f85149; font-size:11.5px; font-weight:normal;">(No H1)</span></div>
          <span class="lint-item-btn">Fix ›</span>
        </div>
      `;
    });
  }
  html += `</div></div>`;

  // Card 4: Catalog Drift (DOC_CATALOG.md)
  const catTitle = zh ? '總綱目錄一致性 (DOC_CATALOG.md)' : (ja ? 'カタログ整合性' : 'Catalog Integrity');
  html += `
  <div class="lint-section-card">
    <div class="lint-section-header" style="background:rgba(187, 128, 247, 0.12);">
      <span class="lint-section-title" style="color:#bc8cff;">
        📋 ${catTitle}
      </span>
      <span class="lint-count-badge" style="background:${data.catalog_exists ? '#238636' : '#9e6a03'};">${data.catalog_exists ? 'OK' : 'MISSING'}</span>
    </div>
    <div class="lint-section-body">
  `;
  if (!data.catalog_exists) {
    html += `<div style="color:#d29922; font-weight:500;">⚠️ ${zh ? '尚未生成 DOC_CATALOG.md 總目錄' : 'DOC_CATALOG.md is missing'}</div>`;
  } else if ((data.catalog_missing_files || []).length === 0) {
    html += `<div style="color:#8b949e;">${zh ? '總目錄涵蓋全庫所有檔案，零脫節' : 'Catalog fully in sync with all files'}</div>`;
  } else {
    html += `<div style="color:#d29922; margin-bottom:6px; font-weight:500;">⚠️ ${data.catalog_missing_files.length} ${zh ? '篇檔案未列入總目錄：' : 'files missing from catalog:'}</div>`;
    data.catalog_missing_files.slice(0, 5).forEach(f => {
      html += `<div style="color:#8b949e; font-size:12px; padding:3px 0;">• ${escapeHtml(f.split(/[\\/]/).pop())}</div>`;
    });
    if (data.catalog_missing_files.length > 5) {
      html += `<div style="color:#6e7681; font-size:12px; margin-top:2px;">... +${data.catalog_missing_files.length - 5} more</div>`;
    }
  }
  html += `</div></div>`;

  container.innerHTML = html;
}


// ─── AI Knowledge Chat Engine (MCP-Orchestrated) ─────────────────────
let chatMessagesHistory = [];
let isChatStreaming = false;
let chatActiveDoc = null;
let isFloatingChatOpen = false;

function getActiveDocPath() {
  if (viewCtx && viewCtx.file) return viewCtx.file.replace(/\\/g, '/');
  if (activeNode) return (activeNode.file || activeNode.abs_path || activeNode.name || '').replace(/\\/g, '/');
  return '';
}

function initFloatingChatInteractions() {
  const card = document.getElementById('floating-chat-card');
  if (!card || card.dataset.interactiveInit === 'true') return;
  card.dataset.interactiveInit = 'true';

  const header = card.querySelector('.floating-chat-header');
  const resizeHandle = document.getElementById('chat-resize-handle');

  // Helper to ensure card is in top/left positioning
  function ensureTopLeftPositioning() {
    const rect = card.getBoundingClientRect();
    card.style.bottom = 'auto';
    card.style.right = 'auto';
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    card.style.width = `${rect.width}px`;
    card.style.height = `${rect.height}px`;
    return rect;
  }

  // 1. Drag & Move by Header
  if (header) {
    header.style.cursor = 'move';
    header.style.userSelect = 'none';

    let isDragging = false;
    let startX = 0, startY = 0;
    let initLeft = 0, initTop = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = ensureTopLeftPositioning();
      initLeft = rect.left;
      initTop = rect.top;

      const onMouseMove = (ev) => {
        if (!isDragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let newLeft = Math.max(10, Math.min(window.innerWidth - card.offsetWidth - 10, initLeft + dx));
        let newTop = Math.max(10, Math.min(window.innerHeight - card.offsetHeight - 10, initTop + dy));
        card.style.left = `${newLeft}px`;
        card.style.top = `${newTop}px`;
      };

      const onMouseUp = () => {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // 2. Corner Resize (Top-Left Grip)
  if (resizeHandle) {
    let isResizing = false;
    let startX = 0, startY = 0;
    let initWidth = 0, initHeight = 0;
    let initLeft = 0, initTop = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = ensureTopLeftPositioning();
      initLeft = rect.left;
      initTop = rect.top;
      initWidth = rect.width;
      initHeight = rect.height;

      const onMouseMove = (ev) => {
        if (!isResizing) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let newWidth = Math.max(380, Math.min(window.innerWidth - 40, initWidth - dx));
        let newHeight = Math.max(320, Math.min(window.innerHeight - 40, initHeight - dy));

        let newLeft = initLeft + (initWidth - newWidth);
        let newTop = initTop + (initHeight - newHeight);

        if (newLeft > 10) {
          card.style.left = `${newLeft}px`;
          card.style.width = `${newWidth}px`;
        }
        if (newTop > 10) {
          card.style.top = `${newTop}px`;
          card.style.height = `${newHeight}px`;
        }
      };

      const onMouseUp = () => {
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
}


function updateChatWidgetI18n() {
  const lang = (typeof currentLanguage !== 'undefined') ? currentLanguage : 'zh';
  const zh = lang === 'zh';
  const ja = lang === 'ja';
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setAttr = (id, attr, txt) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, txt); };

  // Trigger floating button
  setAttr('floating-chat-trigger', 'title', zh ? 'AI 知識檢索問答 (MCP Chat)' : (ja ? 'AIナレッジ検索・対話 (MCP Chat)' : 'AI Knowledge Copilot (MCP Chat)'));

  // Header & Buttons
  set('lbl-floating-chat-title', zh ? 'MCP 知識問答助理' : (ja ? 'MCP ナレッジコパイロット' : 'MCP Knowledge Copilot'));
  set('btn-clear-chat-widget', zh ? '🗑️ 清空' : (ja ? '🗑️ クリア' : '🗑️ Clear'));
  setAttr('btn-clear-chat-widget', 'title', zh ? '清空對話歷史' : (ja ? '会話履歴をクリア' : 'Clear chat history'));

  // Context bar
  const ctxLabel = document.querySelector('#chat-active-doc-bar > span:first-child');
  if (ctxLabel) ctxLabel.textContent = zh ? '📌 上下文：' : (ja ? '📌 コンテキスト：' : '📌 Context:');
  set('btn-chat-set-context', zh ? '抓取當前' : (ja ? '現在を取得' : 'Capture Doc'));
  setAttr('btn-chat-set-context', 'title', zh ? '綁定目前正在閱讀的文件' : (ja ? '現在閲覧中の文書をバインド' : 'Bind current viewing document'));
  updateChatContextDoc();

  // Welcome box
  set('lbl-chat-welcome-title', zh ? 'DocGraphical MCP 智慧檢索' : (ja ? 'DocGraphical MCP 知能検索' : 'DocGraphical MCP Intelligent Search'));
  set('lbl-chat-welcome-desc', zh ? '向知識庫提問，中階由 MCP 工具精準檢索 TOC、章節與關聯圖，節省 97% Context Tokens 並附帶精準引用錨點。'
                               : (ja ? 'ナレッジベースに質問します。MCPツールによりTOCや見出しを精密抽出してトークンを削減します。'
                               : 'Ask questions to your knowledge base. MCP tools surgically slice TOC, sections, and topology.'));

  // Input area
  setAttr('chat-input-box', 'placeholder', zh ? '輸入問題... (Enter 送出，Shift+Enter 換行)' : (ja ? '質問を入力... (Enter 送信、Shift+Enter 改行)' : 'Type a query... (Enter to send, Shift+Enter for newline)'));
  set('btn-chat-send', zh ? '送出' : (ja ? '送信' : 'Send'));
  setAttr('btn-chat-send', 'title', zh ? '送出提問' : (ja ? '質問を送信' : 'Send query'));

  const statusEl = document.getElementById('chat-status-indicator');
  if (statusEl && !isChatStreaming) {
    statusEl.textContent = zh ? '就緒' : (ja ? '待機中' : 'Ready');
  }
  const helperHint = document.querySelector('#chat-input-panel span:last-child');
  if (helperHint) {
    helperHint.textContent = zh ? 'Shift+Enter 換行' : (ja ? 'Shift+Enter で改行' : 'Shift+Enter for newline');
  }
}

function toggleFloatingChat(forceState) {
  const card = document.getElementById('floating-chat-card');
  if (!card) return;
  if (typeof forceState === 'boolean') {
    isFloatingChatOpen = forceState;
  } else {
    isFloatingChatOpen = !isFloatingChatOpen;
  }

  if (isFloatingChatOpen) {
    initFloatingChatInteractions();
    card.classList.remove('hidden');
    updateChatContextDoc();
    const input = document.getElementById('chat-input-box');
    if (input) setTimeout(() => input.focus(), 100);
  } else {
    card.classList.add('hidden');
  }
}

function updateChatContextDoc() {
  const badgeEl = document.getElementById('chat-active-doc-name');
  if (!badgeEl) return;
  const zh = currentLanguage === 'zh';
  const ja = currentLanguage === 'ja';
  const curDoc = getActiveDocPath();
  if (chatActiveDoc) {
    badgeEl.textContent = chatActiveDoc;
    badgeEl.style.color = '#58a6ff';
  } else if (curDoc) {
    badgeEl.textContent = curDoc;
    badgeEl.style.color = '#7ee787';
  } else {
    badgeEl.textContent = zh ? '全庫搜尋 (Global)' : (ja ? '全体検索 (Global)' : 'Global Repository');
    badgeEl.style.color = '#8b949e';
  }
}

function setChatContextActiveDoc() {
  const zh = currentLanguage === 'zh';
  const ja = currentLanguage === 'ja';
  const curDoc = getActiveDocPath();
  if (curDoc) {
    chatActiveDoc = curDoc;
    updateChatContextDoc();
    showToast(zh ? `已綁定對話上下文：${curDoc}` : (ja ? `コンテキストを設定しました：${curDoc}` : `Set chat context: ${curDoc}`));
  } else {
    chatActiveDoc = null;
    updateChatContextDoc();
    showToast(zh ? '目前未開啟文件，使用全庫搜尋' : (ja ? 'ドキュメント未選択のため全体検索を使用' : 'No document opened, using global search'));
  }
}

function clearChatHistory() {
  chatMessagesHistory = [];
  const container = document.getElementById('chat-messages-container');
  if (container) {
    const zh = currentLanguage === 'zh';
    const ja = currentLanguage === 'ja';
    container.innerHTML = `
      <div class="chat-welcome-box" style="padding:14px; background:#161b22; border:1px solid #30363d; border-radius:8px; font-size:12px; color:#8b949e; line-height:1.6;">
        <div style="font-weight:600; color:#e6edf3; margin-bottom:6px; display:flex; align-items:center; gap:6px;">
          <span style="color:#58a6ff; font-size:14px;">⚡</span>
          <span>${zh ? 'DocGraphical MCP 智慧檢索' : (ja ? 'DocGraphical MCP 知能検索' : 'DocGraphical MCP Intelligent Search')}</span>
        </div>
        <div>
          ${zh ? '向知識庫提問，中階由 MCP 工具精準檢索 TOC、章節與關聯圖，節省 97% Context Tokens 並附帶精準引用錨點。' : (ja ? 'ナレッジベースに質問します。MCPツールによりTOCや見出しを精密抽出してトークンを削減します。' : 'Ask questions to your knowledge base. MCP tools surgically slice TOC, sections, and topology.')}
        </div>
      </div>
    `;
  }
  const statusEl = document.getElementById('chat-status-indicator');
  if (statusEl) statusEl.textContent = 'Ready';
}

function handleChatInputKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
}


function buildCitationPillHtml(cleanFile, cleanHeading, rawHeadingLevel = 0) {
  const shortFile = cleanFile.split(/[\\/]/).pop() || cleanFile;
  const isMd = /\.md$/i.test(cleanFile);
  const fileColor = isMd ? (KIND_COLORS.file || '#f0883e') : '#58a6ff';
  const fileBg = isMd ? 'rgba(240, 136, 62, 0.15)' : 'rgba(31, 111, 235, 0.15)';
  const fileBorder = isMd ? 'rgba(240, 136, 62, 0.4)' : 'rgba(56, 139, 253, 0.4)';

  let headingColor = KIND_COLORS.heading_2 || '#3fb950';
  let headingBg = 'rgba(63, 185, 80, 0.15)';
  let headingBorder = 'rgba(63, 185, 80, 0.4)';

  if (cleanHeading) {
    const allN = (masterGraphData.nodes && masterGraphData.nodes.length) 
      ? masterGraphData.nodes 
      : ((rawData && rawData.nodes && rawData.nodes.length) ? rawData.nodes : []);
    const targetBase = cleanFile.toLowerCase();
    const hText = cleanHeading.toLowerCase();

    // 1. Search in loaded/master graph nodes
    const foundH = allN.find(n => {
      if (!n.kind || !n.kind.startsWith('heading')) return false;
      const nf = (n.file || n.abs_path || '').replace(/\\/g, '/').toLowerCase();
      const fMatch = !targetBase || nf.endsWith(targetBase);
      const name = (n.name || '').trim().toLowerCase();
      return fMatch && (name === hText || name.includes(hText) || hText.includes(name));
    });

    if (foundH) {
      headingColor = KIND_COLORS[foundH.kind] || '#3fb950';
    } else if (rawHeadingLevel === 1) {
      headingColor = KIND_COLORS.heading_1 || '#58a6ff';
    } else if (rawHeadingLevel === 2) {
      headingColor = KIND_COLORS.heading_2 || '#3fb950';
    } else if (rawHeadingLevel === 3) {
      headingColor = KIND_COLORS.heading_3 || '#bc8cff';
    } else if (rawHeadingLevel === 4) {
      headingColor = KIND_COLORS.heading_4 || '#ff7bba';
    } else if (rawHeadingLevel === 5) {
      headingColor = KIND_COLORS.heading_5 || '#00d2d3';
    } else if (rawHeadingLevel === 6) {
      headingColor = KIND_COLORS.heading_6 || '#ffd700';
    } else if (/^[一二三四五六七八九十]+[、.]/.test(cleanHeading) || /^[A-Z][、.]/.test(cleanHeading)) {
      // Common top-level heading pattern
      headingColor = KIND_COLORS.heading_1 || '#58a6ff';
    } else if (/^\d+\.\d+/.test(cleanHeading)) {
      // Subsection pattern e.g. 2.1
      headingColor = KIND_COLORS.heading_3 || '#bc8cff';
    } else if (/^\d+[、.]/.test(cleanHeading)) {
      // Major section pattern e.g. 2. 比對與反應規則矩陣 -> H2 Emerald Green
      headingColor = KIND_COLORS.heading_2 || '#3fb950';
    }

    headingBg = `${headingColor}22`;
    headingBorder = `${headingColor}55`;
  }

  const fJs = cleanFile.replace(/'/g, "\\'");
  const hJs = cleanHeading.replace(/'/g, "\\'");
  const fullPathTip = cleanHeading ? `${cleanFile} > ${cleanHeading}` : cleanFile;

  return `<span class="chat-citation-pill" style="display:inline-flex; align-items:center; margin:2px 3px; background:#161b22; border:1px solid ${cleanHeading ? headingBorder : fileBorder}; border-radius:6px; overflow:hidden; font-size:13px; font-weight:600;">`
    + `<span onclick="handleChatCitationClick('${fJs}', '', true)" title="跳轉至來源檔案: ${cleanFile}" style="padding:2px 7px; color:${fileColor}; cursor:pointer; background:${fileBg}; border-right:${cleanHeading ? `1px solid ${fileBorder}` : 'none'}; display:inline-flex; align-items:center; gap:4px;">📄 ${escapeHtml(shortFile)}</span>`
    + (cleanHeading ? `<span onclick="handleChatCitationClick('${fJs}', '${hJs}', false)" title="跳轉定位至章節: ${fullPathTip}" style="padding:2px 7px; color:${headingColor}; cursor:pointer; background:${headingBg}; display:inline-flex; align-items:center; gap:2px;">› ${escapeHtml(cleanHeading)}</span>` : '')
    + `</span>`;
}

function resolveHeadingColor(headingText, fallbackFile = '') {
  const cleanH = (headingText || '').trim().replace(/^#+\s*/, '').trim();
  const allN = (masterGraphData.nodes && masterGraphData.nodes.length) 
    ? masterGraphData.nodes 
    : ((rawData && rawData.nodes && rawData.nodes.length) ? rawData.nodes : []);
  const hLower = cleanH.toLowerCase();
  const fLower = (fallbackFile || '').toLowerCase();

  const foundH = allN.find(n => {
    if (!n.kind || !n.kind.startsWith('heading')) return false;
    const nf = (n.file || n.abs_path || '').replace(/\\/g, '/').toLowerCase();
    const fMatch = !fLower || nf.endsWith(fLower);
    const name = (n.name || '').trim().toLowerCase();
    return fMatch && (name === hLower || name.includes(hLower) || hLower.includes(name));
  });

  if (foundH) return KIND_COLORS[foundH.kind] || '#3fb950';

  const hashMatch = (headingText || '').match(/^(#{1,6})\s*/);
  if (hashMatch) {
    const lvl = hashMatch[1].length;
    return KIND_COLORS[`heading_${lvl}`] || '#3fb950';
  }
  if (/^[一二三四五六七八九十]+[、.]/.test(cleanH) || /^[A-Z][、.]/.test(cleanH)) {
    return KIND_COLORS.heading_1 || '#58a6ff';
  }
  if (/^\d+\.\d+/.test(cleanH)) {
    return KIND_COLORS.heading_3 || '#bc8cff';
  }
  if (/^\d+[、.]/.test(cleanH)) {
    return KIND_COLORS.heading_2 || '#3fb950';
  }
  return KIND_COLORS.heading_2 || '#3fb950';
}

function formatChatMarkdown(text) {
  if (!text) return '';
  let safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Render clickable citations: [[file#heading]] or [[file]] or [file:heading]
  safe = safe.replace(/\[\[(.*?)(?:#(.*?))?\]\]/g, (match, file, heading) => {
    const cleanFile = (file || '').trim();
    const rawHeading = heading || '';
    let headingLvl = 0;
    const hashMatch = rawHeading.match(/^(#{1,6})\s*/);
    if (hashMatch) headingLvl = hashMatch[1].length;
    let cleanHeading = rawHeading.replace(/^#+\s*/, '').trim();
    return buildCitationPillHtml(cleanFile, cleanHeading, headingLvl);
  });

  // Also support [filename.md:heading] or [filename.md#heading] pattern
  safe = safe.replace(/\[([^\s\]]+\.(?:md|txt|docx|pdf))[:#]([^\]]+)\]/g, (match, file, heading) => {
    const cleanFile = (file || '').trim();
    const rawHeading = heading || '';
    let headingLvl = 0;
    const hashMatch = rawHeading.match(/^(#{1,6})\s*/);
    if (hashMatch) headingLvl = hashMatch[1].length;
    let cleanHeading = rawHeading.replace(/^#+\s*/, '').trim();
    return buildCitationPillHtml(cleanFile, cleanHeading, headingLvl);
  });

  // Convert arrow navigation chains of backticks: `file.md` → `heading` or `file.md` -> `heading`
  safe = safe.replace(/`([^`]+\.(?:md|txt|docx|pdf))`\s*(?:→|-&gt;|&rarr;|->)\s*`([^`]+)`/g, (match, file, heading) => {
    return buildCitationPillHtml(file.trim(), heading.trim());
  });

  // Simple Markdown inline formatting (bold, backticks)
  safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Dynamic backtick code highlighting respecting Node Kind colors
  safe = safe.replace(/`([^`]+)`/g, (match, content) => {
    const trimmed = content.trim();
    let codeColor = '#f0883e'; // default warm cyber orange
    let bgOpacity = '15';
    let isFile = /\.(?:md|txt|docx|pdf|py|js|ts|json|html|css)$/i.test(trimmed);

    if (isFile) {
      codeColor = KIND_COLORS.file || '#f0883e';
    } else {
      // Check if matches heading syntax or known heading node
      codeColor = resolveHeadingColor(trimmed);
    }
    return `<code style="background:#21262d; border:1px solid ${codeColor}44; padding:2px 5px; border-radius:4px; font-size:13px; font-weight:600; color:${codeColor};">${content}</code>`;
  });

  safe = safe.replace(/\n/g, '<br/>');
  return safe;
}

function handleChatCitationClick(file, heading, bTargetFileOnly = false) {
  if (!file) return;
  const cleanF = String(file || '').trim().replace(/^[pP]\d+::/, '').replace(/^file::/, '');
  let cleanH = String(heading || '').trim().replace(/^#+\s*/, '').trim();
  if (bTargetFileOnly) cleanH = '';

  const zh = (typeof currentLanguage !== 'undefined' && currentLanguage === 'zh');
  const ja = (typeof currentLanguage !== 'undefined' && currentLanguage === 'ja');

  // Route 100% through the authoritative dispatchUnifiedSelection pipeline:
  // this triggers: 1. Explorer tree sync, 2. temporary 3D reveal with root-to-leaf seeding,
  // 3. highlightScope('node'), 4. focusOnNode with camera alignment, 5. Central markdown section slicing.
  dispatchUnifiedSelection({ file: cleanF, heading: cleanH });
}

function appendChatMessageBubble(role, content) {
  const container = document.getElementById('chat-messages-container');
  if (!container) return null;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble chat-bubble-${role}`;
  bubble.style.display = 'flex';
  bubble.style.flexDirection = 'column';
  bubble.style.gap = '4px';
  bubble.style.maxWidth = '92%';
  bubble.style.alignSelf = role === 'user' ? 'flex-end' : 'flex-start';
  bubble.style.background = role === 'user' ? '#1f6feb' : '#161b22';
  bubble.style.color = '#e6edf3';
  bubble.style.padding = '8px 12px';
  bubble.style.borderRadius = '8px';
  bubble.style.fontSize = '12px';
  bubble.style.lineHeight = '1.5';
  bubble.style.border = role === 'user' ? '1px solid #388bfd' : '1px solid #30363d';
  bubble.style.wordBreak = 'break-word';

  if (role === 'assistant') {
    bubble.innerHTML = `<div class="chat-content" style="color:#e6edf3;">${formatChatMarkdown(content)}</div>`;
  } else {
    if (typeof content === 'string' && (content.includes('<img') || content.includes('<div') || content.includes('<br'))) {
      bubble.innerHTML = content;
    } else {
      bubble.textContent = content;
    }
  }

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

// Compact Breadcrumb Trace Container for MCP Tool Invocations
function appendMcpToolCallCard(name, args) {
  const container = document.getElementById('chat-messages-container');
  if (!container) return null;

  // Try to find the latest active breadcrumb container, or create one
  let traceContainer = container.querySelector('.chat-mcp-trace-container:last-child');
  if (!traceContainer || traceContainer.dataset.completed === 'true') {
    traceContainer = document.createElement('div');
    traceContainer.className = 'chat-mcp-trace-container';
    traceContainer.style.alignSelf = 'flex-start';
    traceContainer.style.maxWidth = '95%';
    traceContainer.style.background = '#0d111788';
    traceContainer.style.border = '1px solid #30363d';
    traceContainer.style.borderRadius = '6px';
    traceContainer.style.padding = '5px 10px';
    traceContainer.style.margin = '4px 0';
    traceContainer.style.fontSize = '11px';
    traceContainer.style.color = '#8b949e';
    traceContainer.style.display = 'flex';
    traceContainer.style.flexDirection = 'column';
    traceContainer.style.gap = '3px';

    const lang = (typeof currentLanguage !== 'undefined') ? currentLanguage : 'zh';
    const zh = lang === 'zh';
    const ja = lang === 'ja';

    const titleRow = document.createElement('div');
    titleRow.style.display = 'flex';
    titleRow.style.alignItems = 'center';
    titleRow.style.gap = '5px';
    titleRow.style.color = '#58a6ff';
    titleRow.style.fontWeight = '600';
    titleRow.style.fontSize = '11px';
    const traceTitle = zh ? '檢索抓取路徑 (Trace)' : (ja ? '検索・取得トレース (Trace)' : 'Retrieval Execution Trace');
    titleRow.innerHTML = `<span>⚡</span><span>${traceTitle}</span>`;

    const breadcrumbs = document.createElement('div');
    breadcrumbs.className = 'trace-breadcrumbs';
    breadcrumbs.style.display = 'flex';
    breadcrumbs.style.flexWrap = 'wrap';
    breadcrumbs.style.alignItems = 'center';
    breadcrumbs.style.gap = '4px';

    traceContainer.appendChild(titleRow);
    traceContainer.appendChild(breadcrumbs);
    container.appendChild(traceContainer);
  }

  const breadcrumbs = traceContainer.querySelector('.trace-breadcrumbs');

  // Format concise step
  const lang = (typeof currentLanguage !== 'undefined') ? currentLanguage : 'zh';
  const zh = lang === 'zh';
  const ja = lang === 'ja';

  const fileRaw = args.filePath || args.repoPath || '';
  const fileShort = fileRaw.split(/[\\/]/).pop() || fileRaw;
  const heading = args.heading || '';
  const query = args.query || '';

  let stepLabel = '';
  let fullTip = `${name} | ${JSON.stringify(args)}`;

  if (name.includes('toc')) {
    stepLabel = `📑 ${fileShort} › TOC`;
  } else if (name.includes('section')) {
    const secLabel = zh ? '章節' : (ja ? 'セクション' : 'Section');
    stepLabel = `📄 ${fileShort} › ${heading || secLabel}`;
  } else if (name.includes('search')) {
    const searchPrefix = zh ? '搜尋' : (ja ? '検索' : 'Search');
    stepLabel = `🔍 ${searchPrefix} "${query}"`;
  } else if (name.includes('graph')) {
    stepLabel = zh ? '🌐 3D 拓撲關聯' : (ja ? '🌐 3D トポロジー' : '🌐 3D Topology');
  } else {
    stepLabel = `⚙️ ${name}`;
  }

  const stepItem = document.createElement('span');
  stepItem.className = 'trace-step-item';
  stepItem.title = fullTip;
  stepItem.style.display = 'inline-flex';
  stepItem.style.alignItems = 'center';
  stepItem.style.gap = '3px';
  stepItem.style.padding = '2px 7px';
  stepItem.style.background = '#161b22';
  stepItem.style.border = '1px solid #388bfd55';
  stepItem.style.borderRadius = '4px';
  stepItem.style.color = '#c9d1d9';
  stepItem.style.fontSize = '11px';
  stepItem.style.cursor = 'default';

  if (breadcrumbs.children.length > 0) {
    const sep = document.createElement('span');
    sep.style.color = '#58a6ff';
    sep.style.margin = '0 1px';
    sep.textContent = '➔';
    breadcrumbs.appendChild(sep);
  }

  stepItem.innerHTML = `<span>${stepLabel}</span><span class="step-status" style="color:#e3b341; font-size:10px; margin-left:3px;">⏳</span>`;
  breadcrumbs.appendChild(stepItem);

  container.scrollTop = container.scrollHeight;

  // Return stepItem so result update can mark it checked
  const cardProxy = {
    querySelector: (sel) => {
      if (sel === '.tool-result-box') {
        return {
          set textContent(val) {
            const statusIcon = stepItem.querySelector('.step-status');
            if (statusIcon) {
              statusIcon.textContent = '✓';
              statusIcon.style.color = '#3fb950';
            }
          },
          style: {}
        };
      }
      return null;
    }
  };
  return cardProxy;
}

async function sendChatMessage() {
  if (isChatStreaming) return;
  const inputEl = document.getElementById('chat-input-box');
  const sendBtn = document.getElementById('btn-chat-send');
  const statusEl = document.getElementById('chat-status-indicator');
  const container = document.getElementById('chat-messages-container');
  if (!inputEl) return;

  let text = (inputEl.value || '').trim();
  if (!text && !chatStagedAttachments.length) return;

  const zh = currentLanguage === 'zh';
  const ja = currentLanguage === 'ja';

  // Merge staged attachments into prompt text
  let bubbleDisplay = text;
  let fullPayloadText = text;
  if (chatStagedAttachments.length) {
    const attList = chatStagedAttachments.map(a => {
      if (a.type.startsWith('image/')) {
        return `\n\n![image](${a.dataUrl})`;
      } else {
        return `\n\n【附加檔案: ${a.name}】:\n\`\`\`\n${(a.content || '').slice(0, 4000)}\n\`\`\``;
      }
    }).join('\n');
    fullPayloadText = (text ? text + '\n' : '') + attList;
    bubbleDisplay = (text ? text + '<br/>' : '') + chatStagedAttachments.map(a => {
      if (a.type.startsWith('image/')) {
        return `<div style="margin-top:4px;"><img src="${a.dataUrl}" onclick="openChatImagePreview('${a.dataUrl}', '${escapeHtml(a.name)}')" style="max-width:200px; max-height:160px; border-radius:6px; border:1px solid #388bfd55; cursor:zoom-in; transition:transform 0.15s ease;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'" title="點擊放大預覽圖片" /></div>`;
      } else {
        return `<div style="margin-top:4px; font-size:13px; background:#0d1117; padding:2px 6px; border-radius:4px; display:inline-block; border:1px solid #30363d;">📄 ${escapeHtml(a.name)}</div>`;
      }
    }).join('');
    // Clear staged attachments
    chatStagedAttachments = [];
    renderChatAttachmentsBar();
  }

  // Append user message
  appendChatMessageBubble('user', bubbleDisplay);
  chatMessagesHistory.push({ role: 'user', content: fullPayloadText });
  inputEl.value = '';

  isChatStreaming = true;
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = '...';
  }
  if (statusEl) statusEl.textContent = zh ? 'MCP 檢索中...' : (ja ? 'MCP 検索中...' : 'Executing MCP tools...');

  // Prepare Assistant stream container
  let assistantBubble = null;
  let assistantContentEl = null;
  let fullAssistantText = '';

  try {
    const payload = {
      messages: chatMessagesHistory,
      active_doc: chatActiveDoc || getActiveDocPath() || null
    };

    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let currentToolCard = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (!dataStr) continue;

        try {
          const ev = JSON.parse(dataStr);
          if (ev.type === 'tool_call') {
            currentToolCard = appendMcpToolCallCard(ev.name, ev.arguments);
            if (statusEl) statusEl.textContent = `[MCP] ${ev.name}...`;
          } else if (ev.type === 'tool_result') {
            if (currentToolCard) {
              const resBox = currentToolCard.querySelector('.tool-result-box');
              if (resBox) {
                resBox.style.display = 'block';
                resBox.textContent = `✓ ${ev.result_summary || 'Done'}`;
              }
            }
          } else if (ev.type === 'delta') {
            if (!assistantBubble) {
              assistantBubble = appendChatMessageBubble('assistant', '');
              assistantContentEl = assistantBubble.querySelector('.chat-content');
            }
            fullAssistantText += ev.content;
            if (assistantContentEl) {
              assistantContentEl.innerHTML = formatChatMarkdown(fullAssistantText);
            }
            if (container) container.scrollTop = container.scrollHeight;
          } else if (ev.type === 'error') {
            showToast('❌ ' + (ev.error || 'Chat error'));
            if (!assistantBubble) {
              const errPrefix = zh ? '⚠️ 錯誤: ' : (ja ? '⚠️ エラー: ' : '⚠️ Error: ');
              assistantBubble = appendChatMessageBubble('assistant', `${errPrefix}${ev.error}`);
            }
          }
        } catch (e) {
          console.error('SSE JSON parse error:', e, dataStr);
        }
      }
    }

    if (fullAssistantText) {
      chatMessagesHistory.push({ role: 'assistant', content: fullAssistantText });
    }
  } catch (err) {
    console.error('Chat error:', err);
    showToast('❌ Chat network error: ' + err.message);
    const connErr = zh ? `⚠️ 無法完成連線: ${err.message}` : (ja ? `⚠️ 接続できませんでした: ${err.message}` : `⚠️ Connection failed: ${err.message}`);
    appendChatMessageBubble('assistant', connErr);
  } finally {
    isChatStreaming = false;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = zh ? '送出' : (ja ? '送信' : 'Send');
    }
    if (statusEl) statusEl.textContent = 'Ready';
  }
}

// ─── Chat Attachments & Image Paste Support ─────────────────────────
let chatStagedAttachments = [];

function renderChatAttachmentsBar() {
  const bar = document.getElementById('chat-attachment-bar');
  if (!bar) return;
  if (!chatStagedAttachments.length) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }
  bar.style.display = 'flex';
  bar.innerHTML = chatStagedAttachments.map((att, idx) => {
    const isImg = att.type.startsWith('image/');
    return `
      <div style="position:relative; display:inline-flex; align-items:center; gap:8px; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:4px 10px; font-size:12px; max-width:260px; box-shadow:0 2px 6px rgba(0,0,0,0.3);">
        ${isImg
          ? `<img src="${att.dataUrl}" onclick="openChatImagePreview('${att.dataUrl}', '${escapeHtml(att.name)}')" style="width:36px; height:36px; object-fit:cover; border-radius:6px; cursor:zoom-in; border:1px solid #388bfd88; transition:transform 0.15s ease;" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'" title="點擊放大預覽圖片" />`
          : `<span style="font-size:18px;">📄</span>`
        }
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#e6edf3; font-weight:500;" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
        <button onclick="removeChatAttachment(${idx})" style="background:none; border:none; color:#f85149; cursor:pointer; font-size:14px; padding:2px 4px; line-height:1; font-weight:700;" title="移除此附件">✕</button>
      </div>
    `;
  }).join('');
}

function openChatImagePreview(src, caption) {
  const modal = document.getElementById('chat-image-preview-modal');
  const imgTarget = document.getElementById('chat-preview-img-target');
  const capTarget = document.getElementById('chat-preview-img-caption');
  if (!modal || !imgTarget) return;
  imgTarget.src = src;
  if (capTarget) capTarget.textContent = caption || '';
  modal.style.display = 'flex';
}

function closeChatImagePreview() {
  const modal = document.getElementById('chat-image-preview-modal');
  if (modal) modal.style.display = 'none';
}

function removeChatAttachment(idx) {
  chatStagedAttachments.splice(idx, 1);
  renderChatAttachmentsBar();
}

function handleChatFileUpload(event) {
  const files = event.target.files;
  if (!files || !files.length) return;
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    if (file.type.startsWith('image/')) {
      reader.onload = (e) => {
        chatStagedAttachments.push({
          name: file.name,
          type: file.type,
          dataUrl: e.target.result,
          content: `[圖片附件: ${file.name}]`
        });
        renderChatAttachmentsBar();
      };
      reader.readAsDataURL(file);
    } else {
      reader.onload = (e) => {
        chatStagedAttachments.push({
          name: file.name,
          type: file.type || 'text/plain',
          content: e.target.result
        });
        renderChatAttachmentsBar();
      };
      reader.readAsText(file);
    }
  });
  event.target.value = '';
}

function handleChatInputPaste(event) {
  const items = (event.clipboardData || event.originalEvent.clipboardData).items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const blob = items[i].getAsFile();
      const reader = new FileReader();
      reader.onload = (e) => {
        const timeName = `pasted_img_${Date.now().toString().slice(-4)}.png`;
        chatStagedAttachments.push({
          name: timeName,
          type: blob.type,
          dataUrl: e.target.result,
          content: `[剪貼簿圖片: ${timeName}]`
        });
        renderChatAttachmentsBar();
        showToast(currentLanguage === 'zh' ? '📸 已貼上圖片附件' : '📸 Image attached from clipboard');
      };
      reader.readAsDataURL(blob);
    }
  }
}

// ─── Strategy Explainer Modal (Architecture & Retrieval Philosophy) ──
function openChatStrategyModal() {
  const modal = document.getElementById('chat-strategy-modal');
  const body = document.getElementById('chat-strategy-body');
  const title = document.getElementById('chat-strategy-title');
  const closeBtn = document.getElementById('btn-chat-strategy-close');
  if (!modal || !body) return;

  const zh = currentLanguage === 'zh';
  const ja = currentLanguage === 'ja';

  if (title) {
    title.textContent = zh
      ? '💡 DocGraphical 知識檢索與快取架構說明'
      : (ja ? '💡 DocGraphical ナレッジ検索およびキャッシュ構造' : '💡 DocGraphical Retrieval & Cache Architecture');
  }
  if (closeBtn) {
    closeBtn.textContent = zh ? '了解 (Got it)' : (ja ? '了解' : 'Got it');
  }

  let contentHtml = '';
  if (zh) {
    contentHtml = `
      <div style="background:#0d1117; border:1px solid #388bfd44; border-radius:8px; padding:12px; margin-bottom:4px;">
        <div style="font-weight:600; color:#58a6ff; font-size:14px; margin-bottom:6px;">🏛️ Karpathy 流長上下文與 DocGraph 混合架構</div>
        <div style="color:#8b949e; font-size:12px; line-height:1.5;">
          本助理揚棄傳統向量切塊（RAG）斷章取義的缺陷，結合 <strong>Andrej Karpathy 的 KV-Cache 前綴快取</strong> 與 <strong>DocGraph AST 精準切片點菜</strong>，兼具全域視野與極致輕量化。
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px;">
        <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px;">
          <div style="font-weight:600; color:#e6edf3; font-size:13px; margin-bottom:4px;">1. 📌 全庫目錄常駐快取 (Prefix KV Cache)</div>
          <div style="color:#8b949e; font-size:12px;">
            全庫骨架 <code>DOC_CATALOG.md</code>（所有檔案相對路徑、H1~H4 目錄、核心概念）固定釘在 System Prompt 頂端。首輪 100% 命中雲端 GPU 快取，模型未出發即掌握全庫地圖，節省 90% 盲目全局搜尋。
          </div>
        </div>

        <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px;">
          <div style="font-weight:600; color:#e6edf3; font-size:13px; margin-bottom:4px;">2. 🎯 精準切片點菜 (Precision Slicing)</div>
          <div style="color:#8b949e; font-size:12px;">
            拒絕將幾十萬字全文無腦硬塞！模型看目錄鎖定目標後，以手術刀式的 <code>docgraphical_section</code> 僅讀取所需章節，省下 97% Context Tokens，杜絕注意力稀釋（Lost in the Middle）。
          </div>
        </div>

        <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px;">
          <div style="font-weight:600; color:#e6edf3; font-size:13px; margin-bottom:4px;">3. 🧠 跨輪次多輪探索與深挖心法</div>
          <div style="color:#8b949e; font-size:12px; line-height:1.6;">
            • <strong>充分性秒回</strong>：若上一輪讀過的章節已足以回答問題，直接由工作記憶輸出，0 次工具調用、0 秒延遲。<br/>
            • <strong>順藤摸瓜（摸到邊）</strong>：若已讀章節僅屬綱要或摸到邊緣，模型自覺資訊不足，以該文件為錨點深挖子章節或相鄰規格。<br/>
            • <strong>自動剪枝（死胡同）</strong>：若上一輪搜尋確認查無內容，記住死胡同，自主變換同義詞、概念標籤摸索出去。
          </div>
        </div>

        <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px;">
          <div style="font-weight:600; color:#e6edf3; font-size:13px; margin-bottom:4px;">4. 🔗 精準跳轉錨點與多模態支援</div>
          <div style="color:#8b949e; font-size:12px;">
            回答結尾皆附帶 <code>[[檔案#章節]]</code> 標籤，點擊直接連動左側樹、中心閱讀器與 3D 地圖居中。輸入框支援直接 <strong>Ctrl + V 貼圖</strong> 與 <strong>📎 附加檔案</strong>（Markdown、程式碼、文件）。
          </div>
        </div>
      </div>
    `;
  } else if (ja) {
    contentHtml = `
      <div style="background:#0d1117; border:1px solid #388bfd44; border-radius:8px; padding:12px; margin-bottom:4px;">
        <div style="font-weight:600; color:#58a6ff; font-size:14px; margin-bottom:6px;">🏛️ Karpathy流 Prefix キャッシュ ＆ DocGraph ハイブリッド構造</div>
        <div style="color:#8b949e; font-size:12px; line-height:1.5;">
          従来のベクトルRAGの文脈欠落を解消し、<strong>Andrej Karpathy 提唱の KV-Cache 前置キャッシュ</strong>と <strong>DocGraph AST 精密スライス</strong>を融合した高効率アーキテクチャです。
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:10px; font-size:12px; color:#8b949e;">
        <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px;">
          <div style="font-weight:600; color:#e6edf3; margin-bottom:4px;">1. 📌 DOC_CATALOG.md による静的キャッシュ</div>
          リポジトリ全域の目次と概念タグがSystem Promptに固定され、100%のKV-Cacheヒット率を達成。
        </div>
        <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px;">
          <div style="font-weight:600; color:#e6edf3; margin-bottom:4px;">2. 🎯 精密セクション抽出 (Precision Slicing)</div>
          全文を一括投入せず、<code>docgraphical_section</code> で特定の見出しのみを抽出し、97%のトークンを削減。
        </div>
        <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px;">
          <div style="font-weight:600; color:#e6edf3; margin-bottom:4px;">3. 🧠 複数ターン自律ナビゲーション</div>
          既読箇所の即答、深掘り追跡、および無効経路の枝刈りを自動実行。クリップボード画像貼付（Ctrl+V）や添付ファイル（📎）にも完全対応。
        </div>
      </div>
    `;
  } else {
    contentHtml = `
      <div style="background:#0d1117; border:1px solid #388bfd44; border-radius:8px; padding:12px; margin-bottom:4px;">
        <div style="font-weight:600; color:#58a6ff; font-size:14px; margin-bottom:6px;">🏛️ Karpathy-Style Prefix Caching & DocGraph Hybrid Engine</div>
        <div style="color:#8b949e; font-size:12px; line-height:1.5;">
          Transcending traditional chunking RAG by uniting <strong>Andrej Karpathy's KV-Cache philosophy</strong> with <strong>DocGraph AST surgical slicing</strong>.
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:10px; font-size:12px; color:#8b949e;">
        <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px;">
          <div style="font-weight:600; color:#e6edf3; margin-bottom:4px;">1. 📌 Global DOC_CATALOG.md Prefix Caching</div>
          The repository index is statically embedded in the System Prompt for near-instant 100% KV-Cache hits.
        </div>
        <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px;">
          <div style="font-weight:600; color:#e6edf3; margin-bottom:4px;">2. 🎯 Precision Slicing & Zero Token Waste</div>
          Surgical extraction via <code>docgraphical_section</code> prevents context bloat and eliminates 'Lost in the Middle'.
        </div>
        <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px;">
          <div style="font-weight:600; color:#e6edf3; margin-bottom:4px;">3. 🧠 Autonomous Multi-turn Working Memory</div>
          Direct answers from working memory when sufficient, deep-dive expansion when only scratching the surface, and intelligent pruning of dead-end queries. Supports Ctrl+V clipboard image pasting and 📎 file attachments.
        </div>
      </div>
    `;
  }

  body.innerHTML = contentHtml;
  modal.style.display = 'flex';
}

function closeChatStrategyModal() {
  const modal = document.getElementById('chat-strategy-modal');
  if (modal) modal.style.display = 'none';
}

