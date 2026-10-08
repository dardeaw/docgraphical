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
let activeNode = null;
let selectedTreeNodeEl = null;
let isTreeOpen = true;
let isRotating = false;
let currentLanguage = (function() { try { return localStorage.getItem('docgraph_language') || 'en'; } catch(e) { return 'en'; } })();

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

function createCustomNodeObject(n) {
  if (!n) return null;
  if (n.kind === 'concept') {
    if (typeof SpriteText !== 'undefined') {
      try {
        // 純標籤牌直接作為 3D 本體實體！完全移除 3D 方塊與 Halo，居中對齊連線
        const sprite = new SpriteText(`🏷️ ${n.name}`);
        sprite.color = '#ffffff';
        sprite.textHeight = 2.4;
        sprite.backgroundColor = 'rgba(10, 14, 22, 0.92)';
        sprite.borderColor = '#94a3b8';
        sprite.borderWidth = 0.9;
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
          <div class="tooltip-title" style="color:#f0883e;">🏷️ ${escapeHtml(n.name)}</div>
          <div class="tooltip-sub">Concept Tag</div>
        </div>`;
      }
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
  if (liveNode.kind !== 'file' && liveNode.kind !== 'concept') {
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
  if (activeSpotlightConcept) {
    activeSpotlightConcept = null;
    applyLODAndFilter();
  }
  if (selectedTreeNodeEl) {
    selectedTreeNodeEl.classList.remove('selected');
    selectedTreeNodeEl = null;
  }

  // Restore user LOD settings if temporarily unhidden
  if (userLODHiddenSnapshot) {
    hiddenKinds.clear();
    userLODHiddenSnapshot.forEach(k => hiddenKinds.add(k));
    userLODHiddenSnapshot = null;
    applyLODAndFilter();
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
  fetchConceptsData();
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
      <button class="mini-btn" style="margin-left:auto; width:22px; height:20px; padding:0; font-size:11px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;" title="${vProjZh ? '在此專案新增文件…（開啟 LLM 摘要入庫對話框）' : 'New document here… (open LLM summary ingest dialog)'}" onclick="event.stopPropagation();treeNewDocument('${vProjEsc}')">＋</button>
      <span class="node-kind-tag" style="margin-left:6px;">${proj.files || Object.keys(projData.files).length} md</span>
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

  const tip = zh ? '💡 警告：資料夾內之全部檔案都將被實體刪除！' : (ja ? '💡 警告：フォルダ内のすべてのファイルが物理削除されます！' : '💡 Warning: All nested files inside will be permanently erased!');
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
      <button class="mini-btn" style="margin-left:auto; width:22px; height:20px; padding:0; font-size:11px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;" title="${vDirZh ? `在此資料夾新增文件…（${escapeHtml(vDirAbs)}）` : (vDirJa ? `このフォルダに新規ドキュメント…（${escapeHtml(vDirAbs)}）` : `New document here… (${escapeHtml(vDirAbs)})`)}" onclick="event.stopPropagation();treeNewDocument('${vDirEsc}')">＋</button>
      <button class="mini-btn" style="margin-left:4px; width:22px; height:20px; padding:0; font-size:11px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; border-color:#5a2d2d; color:#f85149;" title="${vDirZh ? `刪除資料夾「${escapeHtml(dName)}」（包含全部子文件與索引，需確認）` : (vDirJa ? `フォルダ「${escapeHtml(dName)}」を削除（全サブファイルとインデックス含む、要確認）` : `Delete folder "${escapeHtml(dName)}" (all files + index, asks first)`)}" onclick="event.stopPropagation();treeDeleteDir('${vDirEsc}', '${vDNameEsc}')">−</button>
      ${vDirCount > 0 ? `<span class="node-kind-tag" style="margin-left:6px;">${vDirCount} md</span>` : ''}
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
      ${vIsMd ? `<button class="mini-btn" style="width:22px; height:20px; padding:0; font-size:11px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; border-color:#5a2d2d; color:#f85149;" title="${bUzh ? `刪除「${escapeHtml(fName)}」（md＋來源檔＋索引，需確認）` : `Delete "${escapeHtml(fName)}" (md + sources + index, asks first)`}" onclick="event.stopPropagation();treeDeleteFile('${vFileEsc}', '${vNameEsc}')">−</button>` : ''}
      ${bUnindexed
        ? `<span class="node-kind-tag" style="flex-shrink:0;margin-left:6px;background:#3a2e12;color:#d29922;border:1px solid #9e6a03;">${bUzh ? '⏳ 待索引' : '⏳ unindexed'}</span>`
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
          <span class="node-kind-tag" style="flex-shrink:0;margin-left:6px;background:rgba(56, 139, 253, 0.1);color:#58a6ff;border:1px solid rgba(56, 139, 253, 0.3);font-size:9px;font-weight:600;padding:0 5px;">${escapeHtml(sExt) || 'SRC'}</span>
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
  if (dName) dName.innerText = node.name || 'Unnamed';
  if (dSub) dSub.innerText = `${node.file || ''} · Line ${node.line || 1}`;

  const badge = document.getElementById('d-kind-badge');
  if (badge) {
    badge.innerText = (node.kind || 'NODE').toUpperCase();
    badge.style.background = KIND_COLORS[node.kind] || '#1f6feb';
    badge.style.color = '#ffffff';
    badge.style.fontWeight = '700';
    badge.style.textShadow = '0 1px 2px rgba(0,0,0,0.7)';
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
}


// ─── Document Tags Visual Engine (Dedicated Top Bar & Inline Badges) ─
function updateDocTagsBar(mdText, filePath) {
  const bar = document.getElementById('doc-tags-pill-bar');
  const list = document.getElementById('doc-tags-pill-list');
  if (!bar || !list) return;

  // Extract all unique concepts in this document [[...]]
  const concepts = new Set();
  const pat = /\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g;
  let match;
  while ((match = pat.exec(mdText || '')) !== null) {
    const cName = (match[1] || '').trim();
    if (cName && cName.length <= 60 && !cName.toLowerCase().endsWith('.md')) {
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
    pill.style.cssText = 'display:inline-flex; align-items:center; gap:4px; background:#1f6feb22; border:1px solid #388bfd66; border-radius:12px; padding:2px 8px; font-size:11px; color:#58a6ff; font-weight:600; cursor:pointer; transition:all 0.15s ease;';
    pill.onmouseover = () => { pill.style.background = '#1f6feb44'; pill.style.borderColor = '#58a6ff'; };
    pill.onmouseout = () => { pill.style.background = '#1f6feb22'; pill.style.borderColor = '#388bfd66'; };

    const txt = document.createElement('span');
    txt.innerText = `🏷️ ${cName}`;
    txt.onclick = () => {
      onConceptCardClick(cName);
    };

    const del = document.createElement('span');
    del.innerText = '✕';
    del.style.cssText = 'color:#f85149; margin-left:4px; font-size:11px; padding:0 2px; cursor:pointer;';
    del.title = '脫鉤解除此標籤 (Unlink)';
    del.onclick = (e) => {
      unlinkConcept(cName, filePath, e);
    };

    pill.appendChild(txt);
    pill.appendChild(del);
    list.appendChild(pill);
  });
}

function renderMarkdown(mdText) {
  const container = document.getElementById('d-code-markdown');
  if (!container) return;

  const curFile = (viewCtx && viewCtx.file) ? viewCtx.file : (activeNode ? (activeNode.file || activeNode.abs_path || '') : '');
  updateDocTagsBar(mdText, curFile);

  // Convert [[Concept]] into clickable interactive inline tags
  let processedMd = mdText || '';
  processedMd = processedMd.replace(/\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g, (m, cName, alias) => {
    const displayName = alias ? alias.trim() : cName.trim();
    if (cName.toLowerCase().endsWith('.md')) return m; // keep standard doc links
    return `<span class="inline-concept-badge" style="display:inline-flex; align-items:center; background:#1f6feb22; border:1px solid #388bfd55; color:#58a6ff; font-weight:600; padding:1px 6px; border-radius:4px; cursor:pointer; font-size:11px;" onclick="onConceptCardClick('${escapeHtml(cName.trim())}', event)">🏷️ ${escapeHtml(displayName)}</span>`;
  });
  // Ingest-md header sources: `> - `rel`` lines — remembered for linkify + menu.
  viewCtx.sources = [];
  ((mdText || '').match(/^> - `(.+)`$/gm) || []).forEach(l => {
    const r = l.replace(/^> - `|`$/g, '');
    if (r && viewCtx.sources.indexOf(r) < 0) viewCtx.sources.push(r);
  });
  if (window.marked) {
    container.innerHTML = marked.parse(processedMd || '');
    container.querySelectorAll('pre code').forEach((block) => {
      if (window.hljs) hljs.highlightElement(block);
    });
    linkifySources(container);
    bindMarkdownInternalLinks(container);
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
    { kind: 'concept', label: 'Concept' },
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
  updateActivityBarI18n();

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
      setBusy(btn, false);
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
  // Per-file batch state: each picked file carries its own staged path,
  // status and summary. md filename always equals the source stem.
  ingState = { dir: absDir, repo: repoPath, proj: projName, picked: [], sel: -1, zh };
  const o = document.createElement('div');
  o.id = 'ing-overlay';
  o.style.cssText = 'position:fixed;inset:0;z-index:1000002;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
  o.innerHTML = `
  <div style="width:90vw;max-width:1700px;height:88vh;overflow:hidden;display:flex;flex-direction:column;background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:16px;color:#e6edf3;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <span style="font-weight:600;font-size:19px;">${zh ? '📥 新增文件 — LLM 摘要入庫' : '📥 New document — LLM summary ingest'} <span style="font-size:14px;color:#8b949e;font-weight:400;">v3.9.26</span></span>
      <button onclick="closeIngestDialog()" style="background:transparent;border:none;color:#8b949e;cursor:pointer;font-size:16px;">✕</button>
    </div>
    <div style="font-size:15px;color:#8b949e;margin-bottom:10px;word-break:break-all;">${zh ? '目標目錄：' : 'Target: '}${escapeHtml(absDir)}${projName ? ` &nbsp;·&nbsp; ${escapeHtml(projName)}` : ''}</div>
    <div style="display:flex;gap:12px;flex:1;min-height:0;">
      <div style="flex:0 1 330px;min-width:250px;display:flex;flex-direction:column;gap:8px;">
        <div style="font-size:16px;font-weight:600;color:#c9d1d9;">${zh ? '① 選擇檔案（文件／試算／郵件／圖片，可拖拉）' : '① Pick files (docs/sheets/mail/images, drag & drop)'}</div>
        <div id="ing-drop" style="border:1.5px dashed #30363d;border-radius:8px;padding:20px 12px;text-align:center;color:#8b949e;font-size:16px;cursor:pointer;transition:border-color .15s,background .15s;">
          ${zh ? '🖱️ 把檔案拖到這裡放開，或點此選擇檔案' : '🖱️ Drag files here, or click to browse'}
          <input type="file" id="ing-file-input" multiple accept=".pptx,.ppt,.docx,.doc,.pdf,.txt,.md,.markdown,.csv,.html,.htm,.eml,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif" style="display:none;" />
        </div>
        <div id="ing-file-list" style="display:flex;flex-direction:column;gap:4px;flex:1;min-height:100px;overflow-y:auto;"></div>
        <button id="ing-btn-sum" onclick="ingSummarizeAll(this)" style="background:#1f6feb;border:1px solid #388bfd;color:#fff;border-radius:6px;padding:8px 12px;cursor:pointer;font-weight:600;font-size:16px;white-space:nowrap;">${zh ? '✨ 整批生成摘要' : '✨ Summarize all'}</button>
      </div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;">
        <div style="font-size:16px;font-weight:600;color:#c9d1d9;">${zh ? '② LLM 摘要預覽' : '② LLM summary preview'}</div>
        <div id="ing-sel-name" style="font-size:14px;color:#58a6ff;word-break:break-all;min-height:18px;"></div>
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
      const ok = files.filter(f => /\.(pptx?|docx?|pdf|txt|md|markdown|csv|html?|eml|jpe?g|png|webp|bmp|tiff?)$/i.test(f.name || ''));
      if (ok.length < files.length) {
        ingMsg((ingState.zh ? '⚠ 已略過不支援的格式：' : '⚠ Skipped unsupported: ')
          + files.filter(f => !/\.(pptx?|docx?|pdf|txt|md|markdown|csv|html?|eml|jpe?g|png|webp|bmp|tiff?)$/i.test(f.name || '')).map(f => f.name).join('、'), true);
      }
      ingAddPicked(ok);
    });
  }
}
// Append files to the ingest pick list (shared by picker + drag&drop).
// Each entry carries its own staged path, status and summary:
// pending -> staged -> working -> done | error
function ingAddPicked(files) {
  if (!ingState || !files || !files.length) return;
  const seen = new Set(ingState.picked.map(f => `${f.name}::${f.size}`));
  files.forEach(f => {
    const k = `${f.name}::${f.size}`;
    if (!seen.has(k)) {
      seen.add(k);
      ingState.picked.push({ file: f, name: f.name, size: f.size,
        stagedPath: '', status: 'picked', summary: '', model: '', error: '' });
    }
  });
  if (ingState.sel < 0 && ingState.picked.length) ingState.sel = 0;
  ingRenderPicked();
}
function ingEntryIcon(st) {
  return st === 'done' ? '✅' : st === 'error' ? '❌' : st === 'working' ? '⏳' : '📎';
}
function ingRenderPicked() {
  const box = document.getElementById('ing-file-list');
  if (!box || !ingState) return;
  box.innerHTML = '';
  if (!ingState.picked.length) {
    box.innerHTML = `<div style="font-size:15px;color:#8b949e;">${ingState.zh ? '（尚未選擇檔案）' : '(no files yet)'}</div>`;
    ingState.sel = -1;
    paintIngSelName();
    paintIngSaveBtn();
    return;
  }
  ingState.picked.forEach((e, idx) => {
    const d = document.createElement('div');
    const sel = idx === ingState.sel;
    d.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:16px;color:#c9d1d9;border:1px solid ' + (sel ? '#1f6feb' : '#21262d') + ';border-radius:6px;padding:4px 8px;' + (e.status === 'done' ? 'cursor:pointer;' : '');
    if (sel) d.style.background = '#1f6feb22';
    const ic = document.createElement('span');
    ic.textContent = ingEntryIcon(e.status);
    ic.style.cssText = e.status === 'working' ? 'color:#58a6ff;' : '';
    if (e.status === 'working') ic.className = 'ing-spin';
    d.appendChild(ic);
    const tx = document.createElement('span');
    tx.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    tx.textContent = `${e.name} (${Math.round(e.size / 1024)} KB)`;
    tx.title = (e.status === 'error' && e.error) ? e.error : (e.stagedPath || e.name);
    d.appendChild(tx);
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = ingState.zh ? '移除' : 'Remove';
    x.style.cssText = 'background:transparent;border:none;color:#8b949e;cursor:pointer;font-size:16px;padding:0 2px;';
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
}
// Currently selected file name above the preview + Confirm count.
function paintIngSelName() {
  const el = document.getElementById('ing-sel-name');
  if (!el || !ingState) return;
  const e = ingState.picked[ingState.sel];
  el.textContent = e ? `▸ ${e.name}` : '';
}
function paintIngSaveBtn() {
  const btn = document.getElementById('ing-btn-save');
  if (!btn || !ingState) return;
  const n = ingState.picked.filter(e => e.status === 'done').length;
  btn.textContent = n
    ? (ingState.zh ? `✅ 確認產出 ${n} 個 md 並入庫` : `✅ Confirm: write ${n} md & index`)
    : (ingState.zh ? '✅ 確認產出 md 並入庫' : '✅ Confirm: write md & index');
}
// Click a row: stash current editor draft, show that file's summary.
function ingSelectFile(idx) {
  const st = ingState;
  if (!st || !st.picked[idx]) return;
  const ed = document.getElementById('ing-edit');
  if (ed && st.picked[st.sel] && st.picked[st.sel].status === 'done') {
    st.picked[st.sel].summary = ed.value;  // keep human edits per file
  }
  st.sel = idx;
  const e = st.picked[idx];
  if (ed) ed.value = e.summary || '';
  ingShowTab('prev');
  ingRenderPicked();
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
// Stage picked files (only ones not staged yet), then continue.
function ingStageAll(done) {
  const st = ingState;
  if (!st) return;
  const zh = st.zh;
  const fresh = st.picked.filter(e => !e.stagedPath);
  if (!fresh.length) { if (typeof done === 'function') done(); return; }
  if (st._stop) st._stop();
  st._stop = ingProgress(zh ? '上傳暫存中' : 'Staging upload');
  const fd = new FormData();
  fd.append('target_dir', st.dir);
  fd.append('stage', '1');  // files wait in staging; Confirm moves them in
  fresh.forEach(e => fd.append('files', e.file, e.name));
  fetch('/api/ingest/upload', { method: 'POST', body: fd })
  .then(r => r.json().then(d => ({ status: r.status, body: d })))
  .then(({ status, body }) => {
    if (st._stop) st._stop();
    if (status === 200 && body.success) {
      const byKey = {};
      (body.files || []).forEach(f => { byKey[`${f.name}::${f.size}`] = f.path; });
      fresh.forEach(e => {
        const p = byKey[`${e.name}::${e.file.size}`];
        if (p) { e.stagedPath = p; if (e.status === 'picked') e.status = 'staged'; }
      });
      ingRenderPicked();
      ingMsg(zh ? `已暫存 ${st.picked.filter(e => e.stagedPath).length} 個檔案（確認後與 md 一起寫入目標目錄）` : `Staged — written on confirm`);
      if (typeof done === 'function') done();
    } else {
      if (st._stop) st._stop();
      ingMsg('❌ ' + ((body && body.error) || status), true);
    }
  })
  .catch(err => { if (st._stop) st._stop(); ingMsg('❌ ' + err, true); });
}
// Summary Preview / Edit tabs. Truth lives per picked entry;
// ingSelectFile stashes the editor into the entry before switching.
function ingCurEntry() {
  const st = ingState;
  return (st && st.picked[st.sel]) || null;
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
  const on = 'background:#1f6feb44;border:1px solid #1f6feb;color:#58a6ff;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:16px;';
  const off = 'background:transparent;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:16px;';
  if (which === 'edit') {
    if (cur && !ed.value) ed.value = cur.summary || '';
    pv.style.display = 'none';
    ed.style.display = 'block';
    tp.style.cssText = off;
    te.style.cssText = on;
    ed.focus();
  } else {
    if (cur && ed.style.display === 'block') cur.summary = ed.value;  // keep human edits
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
    } catch (e) { pv.textContent = txt; }
  }
}
// Batch: stage everything, then summarize file-by-file. Each completion
// checkmarks its row and takes over the right preview immediately.
function ingSummarizeAll(btn) {
  const st = ingState;
  if (!st) return;
  const zh = st.zh;
  if (!st.picked.length) { ingMsg(zh ? '請先選擇檔案' : 'Pick files first', true); return; }
  setBusy(btn, true, '⏳…');
  ingStageAll(() => {
    const queue = st.picked.filter(e => e.stagedPath && e.status !== 'done');
    if (!queue.length) {
      setBusy(btn, false);
      ingMsg(zh ? '全部已完成（如需重跑請移除重加）' : 'All done already', true);
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
        ingMsg((zh ? `✅ 整批完成：${nd} 成功` : `✅ Batch done: ${nd} ok`) + (ne ? (zh ? `，${ne} 失敗` : `, ${ne} failed`) : ''));
        return;
      }
      const e = queue[i];
      if (st._stop) st._stop();  // kill the previous file's timer, or they pile up forever
      st._stop = ingProgress(zh ? `摘要生成中 ${i + 1}/${queue.length}：${e.name}` : `Summarizing ${i + 1}/${queue.length}: ${e.name}`);
      e.status = 'working'; e.error = '';
      ingRenderPicked();
      if (pv0) pv0.innerHTML = `<span class="ing-spin">◌</span> ${zh ? 'LLM 生成中…' : 'Generating…'}`;
      fetch('/api/ingest/summarize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [e.stagedPath] })
      })
      .then(r => r.json().then(d => ({ status: r.status, body: d })))
      .then(({ status, body }) => {
        if (status === 200 && body.success) {
          e.status = 'done'; e.summary = body.summary || ''; e.model = body.model || '';
          const notes = (body.notes || []).join('；');
          // Latest completion takes over the preview immediately.
          const k = st.picked.indexOf(e);
          if (k >= 0) { st.sel = k; }
          const ed0 = document.getElementById('ing-edit');
          if (ed0) ed0.value = e.summary;
          ingShowTab('prev');
          ingRenderPicked();
          ingMsg((zh ? `✅ ${e.name}（${body.model || ''}）` : `✅ ${e.name} (${body.model || ''})`) + (notes ? ` — ${notes}` : ''));
        } else {
          e.status = 'error'; e.error = (body && body.error) || String(status);
          ingRenderPicked();
          if (pv0) pv0.textContent = zh ? '（摘要會顯示在這裡）' : '(summary appears here)';
          ingMsg(`❌ ${e.name}：` + e.error, true);
        }
        i++;
        step();
      })
      .catch(err => {
        e.status = 'error'; e.error = String(err);
        ingRenderPicked();
        ingMsg(`❌ ${e.name}：` + err, true);
        i++;
        step();
      });
    };
    step();
  });
}
// Confirm: one md per done file, filename always equals the source stem.
function ingSave(btn) {
  const st = ingState;
  if (!st) return;
  const zh = st.zh;
  // Stash the visible draft into its entry first.
  const ed0 = document.getElementById('ing-edit');
  const cur = ingCurEntry();
  if (ed0 && cur && cur.status === 'done') cur.summary = ed0.value;
  const done = st.picked.filter(e => e.status === 'done' && (e.summary || '').trim());
  if (!done.length) { ingMsg(zh ? '還沒有完成的摘要（先按整批生成摘要）' : 'No finished summaries yet', true); return; }
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
      if (okCount === done.length) setTimeout(closeIngestDialog, 1200);
      return;
    }
    const e = done[i];
    if (st._stop) st._stop();  // same leak guard as summarize loop
    st._stop = ingProgress(zh ? `寫檔＋增量索引中 ${i + 1}/${done.length}：${e.name}` : `Writing + indexing ${i + 1}/${done.length}: ${e.name}`);
    const filename = e.name.replace(/\.[^.]+$/, '');  // md name == source stem, no editing
    fetch('/api/ingest/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_dir: st.dir, filename, summary_md: e.summary.trim(),
                             source_paths: [e.stagedPath], model: e.model })
    })
    .then(r => r.json().then(d => ({ status: r.status, body: d })))
    .then(({ status, body }) => {
      if (status === 200 && body.success) {
        okCount++;
        outs.push(e.name);
      } else {
        e.status = 'error'; e.error = (body && body.error) || String(status);
        ingRenderPicked();
        ingMsg(`❌ ${e.name}：` + e.error, true);
      }
      i++;
      step();
    })
    .catch(err => {
      e.status = 'error'; e.error = String(err);
      ingRenderPicked();
      ingMsg(`❌ ${e.name}：` + err, true);
      i++;
      step();
    });
  };
  step();
}
// ingUpload/summarize single-file legacy removed: staging + per-file
// summarize are inlined in ingStageAll / ingSummarizeAll above.

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
  if (summary) summary.innerText = `${selectedProjects.size} ${zh ? '個啟用' : (ja ? '個のアクティブ' : 'Active')}`;

  set('th-proj', zh ? '專案' : (ja ? 'プロジェクト' : 'Project'));
  set('th-path', zh ? '目錄路徑' : (ja ? 'パス' : 'Directory Path'));
  set('th-metrics', zh ? '指標' : (ja ? 'メトリクス' : 'Metrics'));
  set('th-status', zh ? '狀態' : (ja ? 'ステータス' : 'Status'));
  set('th-actions', zh ? '操作' : (ja ? '操作' : 'Actions'));

  set('lbl-modal-title', zh ? '倉庫管理' : (ja ? 'リポジトリ管理' : 'Repository Management'));
  set('lbl-add-dir', zh ? '掃描專案目錄：' : (ja ? 'プロジェクトをスキャン：' : 'Scan Project Directory:'));
  set('lbl-repo-list', zh ? '已發現的倉庫：' : (ja ? '検出されたリポジトリ：' : 'Discovered Repositories:'));
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
      onConceptCardClick(targetNode.name);
      return;
    }
    // 1. Sync Explorer Selection (open parent folders/files, select target heading/file, smooth scroll)
    syncExplorerSelection(targetNode);

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

function switchActivityTab(tabName) {
  const drawer = document.getElementById('left-sidebar-drawer');
  const resizer = document.getElementById('resizer-tree-doc');
  const tabExplorer = document.getElementById('act-tab-explorer');
  const tabConcepts = document.getElementById('act-tab-concepts');
  const panelExplorer = document.getElementById('tree-panel');
  const panelConcepts = document.getElementById('concepts-panel');

  if (!drawer) return;

  // Clicking currently active tab collapses/expands the drawer (VS Code behavior)
  if (currentActivityTab === tabName && !isDrawerCollapsed) {
    isDrawerCollapsed = true;
    drawer.classList.add('collapsed');
    if (resizer) resizer.style.display = 'none';
    if (tabExplorer) tabExplorer.classList.remove('active');
    if (tabConcepts) tabConcepts.classList.remove('active');
    return;
  }

  // Otherwise, ensure drawer is visible and switch panels
  isDrawerCollapsed = false;
  drawer.classList.remove('collapsed');
  if (resizer) resizer.style.display = '';

  currentActivityTab = tabName;

  if (tabName === 'explorer') {
    if (tabExplorer) tabExplorer.classList.add('active');
    if (tabConcepts) tabConcepts.classList.remove('active');
    if (panelExplorer) panelExplorer.style.display = 'flex';
    if (panelConcepts) panelConcepts.style.display = 'none';
  } else if (tabName === 'concepts') {
    if (tabExplorer) tabExplorer.classList.remove('active');
    if (tabConcepts) tabConcepts.classList.add('active');
    if (panelExplorer) panelExplorer.style.display = 'none';
    if (panelConcepts) panelConcepts.style.display = 'flex';
    renderConceptsDrawerList();
  }
}

// Backward compatibility for old calls
function toggleTreePanel() {
  switchActivityTab(currentActivityTab || 'explorer');
}


// ─── Real Concepts Registry Engine (Two-Tier Hierarchy & Linking) ─────
let conceptsTreeData = { tree: {}, candidates: [], counts: { official: 0, candidates: 0 } };
let selectedConceptName = null;
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
  if (btnOfficial) btnOfficial.classList.toggle('active', subTab === 'official');
  if (btnCandidates) btnCandidates.classList.toggle('active', subTab === 'candidates');
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
        renderConceptsDrawerList();
      }
    })
    .catch(err => console.error('fetchConceptsData error:', err));
}


function renderLinkedFilesHtml(conceptName, files, zh) {
  if (!files || files.length === 0) {
    return `<div style="font-size:11px; color:#8b949e; padding:4px 0;">${zh ? '尚無文檔引用此標籤' : 'No files reference this concept'}</div>`;
  }
  let h = `<div style="font-size:11px; color:#58a6ff; font-weight:600; margin-bottom:4px;">📄 ${zh ? '引用文件清單' : 'Referenced Documents'} (${files.length}):</div>`;
  h += '<div style="display:flex; flex-direction:column; gap:4px; max-height:160px; overflow-y:auto;">';
  files.forEach(f => {
    h += `
      <div style="background:#0d1117; border:1px solid #30363d; border-radius:4px; padding:4px 8px; font-size:11px; display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#c9d1d9; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px; display:flex; align-items:center;" title="${escapeHtml(f.filePath)}">${(f.filePath||'').startsWith('heading::') ? '<span style="color:#58a6ff; font-weight:700; margin-right:4px;">#</span>' : getDocIconSvg('#f0883e')} <span style="margin-left:3px;">${escapeHtml(f.filePath)}</span></span>
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
  const kw = (filterKw || '').trim().toLowerCase();

  const countOfficialEl = document.getElementById('count-cpt-official');
  const countCandidatesEl = document.getElementById('count-cpt-candidates');
  const badgeEl = document.getElementById('badge-concept-candidates');

  const offCount = (conceptsTreeData.counts && conceptsTreeData.counts.official) || 0;
  const candCount = (conceptsTreeData.counts && conceptsTreeData.counts.candidates) || 0;

  if (countOfficialEl) countOfficialEl.innerText = offCount;
  if (countCandidatesEl) countCandidatesEl.innerText = candCount;
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
    candidates.forEach(c => {
      h += `
        <div class="concept-card" style="border:1px dashed #e3b341; background:#161b22; border-radius:6px; padding:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:600; color:#f0883e; font-size:13px;">🏷️ ${escapeHtml(c.name)}</span>
            <span class="concept-status-pill candidate" style="background:#382800; color:#e3b341; border:1px solid #9e6a03; font-size:11px; padding:2px 6px; border-radius:10px;">${c.refs} ${zh ? '次引用' : 'Refs'}</span>
          </div>
          <div style="font-size:11px; color:#8b949e; margin-top:4px;">${zh ? '來源' : 'Source'}: ${escapeHtml(c.aliases || (zh ? 'AI 頻繁偵測' : 'Auto-detected'))}</div>
          <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:8px;">
            <button class="mini-btn" style="background:#238636; border-color:#2ea043; color:#fff;" onclick="promoteCandidate('${escapeHtml(c.name)}')">✓ ${zh ? '審批入典' : 'Promote'}</button>
            <button class="mini-btn" style="background:#21262d; border-color:#30363d; color:#f85149;" onclick="dismissCandidate('${escapeHtml(c.name)}')">✕ ${zh ? '駁回除名' : 'Dismiss'}</button>
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
    container.innerHTML = `<div style="color:#8b949e; font-size:12px; text-align:center; padding:30px 10px;">${zh ? '知識庫尚無正式概念，請點擊上方 + New 定立' : 'No concepts defined yet. Click + New to define one.'}</div>`;
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
      <div class="concept-category-block" style="background:#0d1117; border:1px solid #30363d; border-radius:6px; overflow:hidden;">
        <!-- Category Header (Accordion) -->
        <div onclick="toggleCategoryExpand('${escapeHtml(cat)}')" style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:#161b22; cursor:pointer; user-select:none; border-bottom:${isExpanded ? '1px solid #21262d' : 'none'};">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:10px; color:#8b949e; transition:transform 0.2s; transform:${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'};">▶</span>
            <span style="font-weight:600; font-size:13px; color:#58a6ff;">📁 ${escapeHtml(getCategoryDisplayName(cat))}</span>
          </div>
          <span style="font-size:11px; background:#21262d; color:#8b949e; padding:1px 6px; border-radius:8px;">${concepts.length}</span>
        </div>

        <!-- Concepts Items -->
        <div style="display:${isExpanded ? 'flex' : 'none'}; flex-direction:column; gap:6px; padding:8px;">
    `;

    concepts.forEach(c => {
      const isSelected = selectedConceptName === c.name;
      const linkedFiles = activeConceptLinkedFiles[c.name] || null;
      html += `
        <div class="concept-card" style="border:1px solid ${isSelected ? '#388bfd' : '#21262d'}; background:${isSelected ? '#131d2e' : '#161b22'}; border-radius:6px; padding:8px; cursor:pointer;" onclick="onConceptCardClick('${escapeHtml(c.name)}', event)">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:600; color:#e2e8f0; font-size:13px;">🏷️ ${escapeHtml(c.name)}</span>
            <span class="concept-status-pill official" style="background:#1f6feb22; color:#58a6ff; border:1px solid #388bfd44; font-size:11px; padding:2px 6px; border-radius:10px;">${c.refs} ${zh ? '引用' : 'Refs'}</span>
          </div>
          <div style="font-size:11px; color:#8b949e; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${zh ? '別名' : 'Aliases'}: ${escapeHtml(c.aliases || (zh ? '無' : 'None'))}
          </div>
          <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:6px;">
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
  const repo = getActiveRepoPath();

  const title = zh ? '⚠ 概念標籤脫鉤確認' : '⚠ Unlink Concept Confirmation';
  const msg = zh 
    ? `確定要解除「${filePath}」與標籤「${conceptName}」的關聯嗎？
（僅會脫鉤此文檔，不會影響其他引用檔案）`
    : `Unlink '${filePath}' from tag '${conceptName}'? (Other documents will remain untouched)`;

  const tip = zh ? '💡 此操作僅會解除此特定文件與概念標籤的關聯，不會影響其他文檔。' : (ja ? '💡 この操作は該当ファイルとタグの関連付けのみを解除し、他のドキュメントには影響しません。' : '💡 This action only unlinks this specific document from the tag.');
  const confirmText = zh ? '確定脫鉤' : (ja ? '関連付け解除' : 'Unlink');
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
          showToast(zh ? `✅ 已成功為「${filePath}」脫鉤「${conceptName}」！` : `✅ Unlinked '${conceptName}'!`);
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
  applyLODAndFilter();

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
    applyLODAndFilter();
  }

  // 3. Trigger 3D Graph Glow Update (Slim, elegant cyber edge)
  Graph.nodeColor(Graph.nodeColor())
    .linkColor(Graph.linkColor())
    .linkWidth(l => highlightLinks.has(l) ? 0.7 : 0.12)
    .linkDirectionalParticles(l => highlightLinks.has(l) ? 4 : 0);

  // 4. Smooth 3D Camera Flight to the cluster center with resilient retry
  const attemptFly = () => {
    const curNodes = (rawData && rawData.nodes) ? rawData.nodes : [];
    const curCNode = curNodes.find(n => n.id === cid || n.id.endsWith(`::${cid}`) || (n.kind === 'concept' && n.name === conceptName));
    const curTargets = [];
    if (curCNode) curTargets.push(curCNode);
    (rawData && rawData.links || []).forEach(l => {
      const sId = typeof l.source === 'object' ? l.source.id : l.source;
      const tId = typeof l.target === 'object' ? l.target.id : l.target;
      if (tId === cid || tId.endsWith(`::${cid}`) || (curCNode && tId === curCNode.id)) {
        const o = curNodes.find(n => n.id === sId);
        if (o) curTargets.push(o);
      } else if (sId === cid || sId.endsWith(`::${cid}`) || (curCNode && sId === curCNode.id)) {
        const o = curNodes.find(n => n.id === tId);
        if (o) curTargets.push(o);
      }
    });

    let sumX = 0, sumY = 0, sumZ = 0, validCount = 0;
    curTargets.forEach(n => {
      if (typeof n.x === 'number' && typeof n.y === 'number' && typeof n.z === 'number' && !isNaN(n.x)) {
        sumX += n.x; sumY += n.y; sumZ += n.z; validCount++;
      }
    });

    if (validCount > 0) {
      const cx = sumX / validCount;
      const cy = sumY / validCount;
      const cz = sumZ / validCount;
      const targetPos = { x: cx, y: cy, z: cz };
      const camPos = { x: cx, y: cy, z: cz + 85 };
      Graph.cameraPosition(camPos, targetPos, 850);
      return true;
    } else if (curCNode && typeof curCNode.x === 'number' && !isNaN(curCNode.x)) {
      focusOnNode(curCNode);
      return true;
    }
    return false;
  };

  if (!attemptFly()) {
    setTimeout(attemptFly, 300);
  }
}

function onConceptCardClick(name, event) {
  if (event && event.target && event.target.tagName.toLowerCase() === 'button') return;
  selectedConceptName = name;
  const zh = currentLanguage === 'zh';
  const repo = getActiveReposParam();

  // 1. Fetch Tag Markdown Page across all active repos!
  fetch(`/api/concepts/tag-page?name=${encodeURIComponent(name)}&repo=${encodeURIComponent(repo)}`)
    .then(res => res.json())
    .then(data => {
      if (data.ok) {
        // Cache linked files across all repos
        activeConceptLinkedFiles[name] = data.files || [];
        renderConceptsDrawerList();

        // 2. Open Tag Page directly in Markdown Viewer!
        renderConceptTagPageInViewer(data);
      }
    });

  // 3. 3D Spotlight Focus
  spotlightConceptNode(name);
}

function renderConceptTagPageInViewer(tagData) {
  const zh = currentLanguage === 'zh';
  const dName = document.getElementById('d-name');
  const dSub = document.getElementById('d-sub');
  const badge = document.getElementById('d-kind-badge');
  const codeTitle = document.getElementById('d-code-title');

  if (dName) dName.innerText = `🏷️ ${tagData.concept} (Tag Page)`;
  if (dSub) dSub.innerText = `${tagData.path} · ${tagData.files.length} Referenced Documents`;
  if (badge) {
    badge.innerText = 'TAG';
    badge.style.background = '#8957e5';
    badge.style.color = '#ffffff';
    badge.style.fontWeight = '700';
    badge.style.textShadow = '0 1px 2px rgba(0,0,0,0.7)';
  }
  if (codeTitle) codeTitle.innerText = '🏷️ Tag Definition & Reference Manager';

  // Build composite Markdown: Content + Dynamic Link Management Table
  let fullMd = tagData.content + '\n\n---\n\n### 🔗 關聯文檔引用管理 (Referenced Documents)\n';
  if (!tagData.files || tagData.files.length === 0) {
    fullMd += '\n*(目前尚無任何文檔引用此概念標籤。可在閱讀文檔時點選頂部「🏷️ + 貼標籤」或於 3D 圖右鍵貼上)*\n';
  } else {
    fullMd += '\n| 序號 | 引用檔案路徑 | 提及段落摘要 | 操作 |\n| :--- | :--- | :--- | :--- |\n';
    tagData.files.forEach((f, idx) => {
      fullMd += `| ${idx + 1} | \`${f.filePath}\` | ${f.snippet ? f.snippet.replace(/\|/g, '/') : '(章節內文)'} | <button class="mini-btn" style="color:#f85149; border-color:#da3633; padding:3px 12px; font-weight:600; white-space:nowrap; min-width:54px; display:inline-block;" onclick="unlinkConcept('${tagData.concept}', '${f.filePath}', event)">解除</button> |\n`;
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

  if (!curFile) {
    showToast(zh ? '⚠ 請先於左側 Explorer 選取任一篇 Markdown 文檔！' : '⚠ Please select a document first!');
    return;
  }

  // If user is currently looking at a Concept Tag Page
  if (curFile.includes('.docgraphical/tags/')) {
    showToast(zh ? 'ℹ 當前為標籤定義頁。請選取欲貼上標籤之實際文檔或章節！' : 'ℹ Currently on a Tag Page. Select a document first!');
    return;
  }

  openAttachTagToSpecificTarget(curFile, curHeading);
}

function openAttachTagToSpecificTarget(filePath, heading = '') {
  taggerMode = 'file_to_concept';
  taggerContext = { filePath, heading };
  const zh = currentLanguage === 'zh';

  const modal = document.getElementById('concept-tagger-modal');
  if (!modal) return;

  const title = document.getElementById('tagger-modal-title');
  const targetDisplay = document.getElementById('tagger-target-display');
  const sel = document.getElementById('sel-tagger-concept') || document.getElementById('tagger-select-item');
  const hint = document.getElementById('tagger-hint');

  const targetDesc = heading ? `段落「${heading}」` : `文檔「${filePath}」`;
  if (title) title.innerText = zh ? `🏷️ 為 ${targetDesc} 貼上標籤` : `🏷️ Attach Tag to ${targetDesc}`;
  if (targetDisplay) targetDisplay.innerText = heading ? `${filePath} > [${heading}]` : filePath;

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
    showTaggerModalError(zh ? '請先選擇一個概念標籤！' : 'Please select a concept tag first!');
    return;
  }

  const filePath = taggerContext.filePath;
  const heading = taggerContext.heading || '';
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
    body: JSON.stringify({ repo, name: chosenConcept, filePath, heading })
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

        // Immediately re-fetch and render this document so the new tag pops up right away!
        if (activeNode) {
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
  if (!confirm(zh ? `確定要將待審標籤「${name}」駁回除名嗎？` : `Dismiss candidate '${name}'?`)) return;
  // Save as dismissed or unlink
  const repo = getActiveRepoPath();
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
  setAttr('btn-add-concept', 'title', lang === 'zh' ? '手動定立新正式概念' : (lang === 'ja' ? '新しい公式コンセプトを登録' : 'Define New Official Concept'));

  // Search input placeholder
  const cptSearch = document.getElementById('concept-search');
  if (cptSearch) cptSearch.placeholder = lang === 'zh' ? '搜尋概念或別名...' : (lang === 'ja' ? 'コンセプトまたは別名を検索...' : 'Search concepts or aliases...');

  // Sub Tab Buttons
  const btnOfficial = document.getElementById('btn-cpt-official');
  const btnCandidates = document.getElementById('btn-cpt-candidates');
  const countOff = document.getElementById('count-cpt-official')?.innerText || '0';
  const countCand = document.getElementById('count-cpt-candidates')?.innerText || '0';

  const txtOff = lang === 'zh' ? '正式概念' : (lang === 'ja' ? '公式コンセプト' : 'Official');
  const txtCand = lang === 'zh' ? '待審候選' : (lang === 'ja' ? '審査待ち候補' : 'Candidates');

  if (btnOfficial) btnOfficial.innerHTML = `${txtOff} (<span id="count-cpt-official">${countOff}</span>)`;
  if (btnCandidates) btnCandidates.innerHTML = `${txtCand} (<span id="count-cpt-candidates">${countCand}</span>)`;

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

  updateSwapButtonI18n();
  updateControlsHelpI18n();
  updateActivityBarI18n();
  updateExplorerI18n();
  updateConceptsI18n();
  updateViewerTagToolbarI18n();
  updateSettingsModalI18n();

  const msg = currentLanguage === 'zh' ? '語系切換：繁體中文'
            : (currentLanguage === 'ja' ? '言語を切り替えました：日本語' : 'Language switched to English');
  showToast(msg);
}

function updateSettingsModalI18n() {
  const lang = currentLanguage;
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

  // Settings Top & Nav
  set('lbl-settings-main-title', lang === 'zh' ? '系統偏好與設定' : (lang === 'ja' ? 'システム設定と基本設定' : 'Preferences & Settings'));
  set('stg-lbl-repo', lang === 'zh' ? '倉庫管理' : (lang === 'ja' ? 'リポジトリ管理' : 'Repositories'));
  set('stg-lbl-lang', lang === 'zh' ? '語系設定' : (lang === 'ja' ? '言語設定' : 'Language'));
  set('stg-lbl-llm', lang === 'zh' ? 'LLM 供應商' : (lang === 'ja' ? 'LLM プロバイダー' : 'LLM Providers'));

  // Repo Page
  set('lbl-modal-title', lang === 'zh' ? '倉庫管理' : (lang === 'ja' ? 'リポジトリ管理' : 'Repository Management'));
  set('lbl-modal-sub', lang === 'zh' ? '掃描本機專案目錄，構建索引 (init)、增量同步 (sync)、全量重建 (index) 或反初始化 (uninit)。'
                     : (lang === 'ja' ? 'ローカルプロジェクトをスキャンし、インデックス構築(init)、増分同期(sync)、完全再構築(index)を行います。'
                     : 'Scan local project directories, build index (init), incremental sync (sync), full rebuild (index), or uninitialize (uninit).'));
  set('lbl-add-dir', lang === 'zh' ? '掃描專案目錄：' : (lang === 'ja' ? 'プロジェクトディレクトリをスキャン：' : 'Scan Project Directory:'));
  set('lbl-repo-list', lang === 'zh' ? '已發現的倉庫：' : (lang === 'ja' ? '検出されたリポジトリ：' : 'Discovered Repositories:'));
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
  const tipSettings = lang === 'zh' ? '系統設定 (Settings)'
                    : (lang === 'ja' ? 'システム設定 (Settings)' : 'System Settings (Settings)');

  setAttr('act-tab-explorer', 'title', tipExplorer);
  setAttr('act-tab-concepts', 'title', tipConcepts);
  setAttr('act-tab-settings', 'title', tipSettings);
}

function openFileInEditor(filePath, targetLine = 1) {
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
  if (txtName) txtName.placeholder = zh ? '例如：微服務, 越南廠, LOO, CVX...' : (ja ? '例：マイクロサービス, ベトナム工場, LOO, CVX...' : 'e.g. Microservices, VietnamPlant, LOO, CVX...');

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
    if (descEl) descEl.textContent = zh ? '定立知識庫官方核心概念詞彙，並可設定其分類與多重別名。' : (ja ? '知識ベースの公式コア概念を定義し、カテゴリと別名を設定します。' : 'Define an official knowledge concept with category and aliases.');
    if (submitBtn) submitBtn.textContent = zh ? '建立概念' : (ja ? '作成' : 'Create Concept');

    if (fieldCat) fieldCat.style.display = 'block';
    if (fieldName) fieldName.style.display = 'block';
    if (fieldAliases) fieldAliases.style.display = 'block';
    if (fieldTarget) fieldTarget.style.display = 'none';

    if (txtCat) txtCat.value = '';
    if (txtName) { txtName.value = ''; txtName.disabled = false; }
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
  const repo = getActiveRepoPath();

  if (mode === 'add' || mode === 'edit') {
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
          showToast(zh ? `🗑️ 已徹底刪除概念標籤「${conceptName}」！` : (ja ? `🗑️ コンセプト「${conceptName}」を削除しました！` : `🗑️ Deleted concept '${conceptName}'!`));
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

