// DocGraph Flagship 3D Knowledge Topology & Surgical Slicer Controller
let Graph = null;
let graphData = { nodes: [], links: [] };
let currentRepoPath = '';
let currentFilePath = '';
let currentFileContent = '';
let currentToc = [];
let currentActiveNode = null;
let isSliceMode = true;
let isDrawerOpen = true;
let isTreeOpen = true;
let isRotating = false;
let currentLanguage = 'en';

document.addEventListener('DOMContentLoaded', () => {
  init3DGraph();
  initResizers();
  initSearch();
  loadRepositories();
  checkElectronNative();
});

function init3DGraph() {
  const elem = document.getElementById('3d-graph');
  Graph = ForceGraph3D()(elem)
    .backgroundColor('#090d13')
    .nodeId('id')
    .nodeLabel(node => `[${node.kind}] ${node.name} (L${node.line})`)
    .nodeVal('val')
    .nodeColor('color')
    .nodeResolution(16)
    .linkOpacity(0.35)
    .linkWidth(1.2)
    .linkColor(link => link.color || 'rgba(88, 166, 255, 0.4)')
    .onNodeClick(node => {
      focusOnNode(node);
    })
    .onBackgroundClick(() => {
      // unhighlight if needed
    });

  // Window resize handler
  window.addEventListener('resize', () => {
    if (Graph) Graph.width(window.innerWidth).height(window.innerHeight);
  });
}

function focusOnNode(node) {
  currentActiveNode = node;
  
  // Aim camera at node
  const distance = 120;
  const distRatio = 1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
  Graph.cameraPosition(
    { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: (node.z || 0) * distRatio },
    node,
    2000
  );

  // Sync with file and section reader
  if (node.file) {
    currentFilePath = node.file;
    if (node.kind === 'file') {
      openMarkdownFile(node.file);
    } else {
      openMarkdownFile(node.file, node.name);
    }
  }

  // Open drawer if closed
  if (!isDrawerOpen) toggleDrawer();
}

function toggleRotate() {
  isRotating = !isRotating;
  const btn = document.getElementById('btn-rotate');
  btn.classList.toggle('active', isRotating);
  if (Graph) {
    Graph.controls().autoRotate = isRotating;
    Graph.controls().autoRotateSpeed = 0.8;
  }
}

function resetCamera() {
  if (Graph) Graph.cameraPosition({ x: 0, y: 0, z: 280 }, { x: 0, y: 0, z: 0 }, 1500);
}

function loadRepositories() {
  fetch('/api/projects')
    .then(res => res.json())
    .then(projects => {
      renderRepoTable(projects);
      if (projects.length > 0) {
        currentRepoPath = projects[0].path;
        loadRepoGraph(currentRepoPath);
        loadRepoFileTree(currentRepoPath);
      }
    });
}

function loadRepoGraph(repoPath) {
  currentRepoPath = repoPath;
  fetch(`/api/graph?path=${encodeURIComponent(repoPath)}`)
    .then(res => res.json())
    .then(data => {
      graphData = data;
      if (Graph) {
        Graph.graphData(data);
      }
      document.getElementById('stats-nodes').textContent = `${data.nodes.length} nodes`;
      document.getElementById('stats-edges').textContent = `${data.links.length} links`;
    });
}

function loadRepoFileTree(repoPath) {
  fetch(`/api/tree?path=${encodeURIComponent(repoPath)}`)
    .then(res => res.json())
    .then(tree => {
      const container = document.getElementById('tree-files-content');
      container.innerHTML = '';
      renderDirectoryNode(tree, container);
    });
}

function renderRepoTable(projects) {
  const tbody = document.getElementById('manager-table-body');
  tbody.innerHTML = '';
  projects.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600; color:#58a6ff;">${p.name}</td>
      <td style="font-family:monospace; font-size:11px; color:#8b949e; max-width:260px; overflow:hidden; text-overflow:ellipsis;" title="${p.path}">${p.path}</td>
      <td>${p.files}</td>
      <td>
        <span style="color:${p.has_db ? '#00ffaa' : '#e3b341'}; font-weight:600;">
          ${p.has_db ? 'Indexed (.db)' : 'Not Indexed'}
        </span>
      </td>
      <td>
        <button class="mini-btn" onclick="selectRepo('${p.path.replace(/\\/g, '\\\\')}')">Open</button>
        <button class="mini-btn" style="background:#1f6feb; color:#fff;" onclick="reindexRepo('${p.path.replace(/\\/g, '\\\\')}')">Index</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function selectRepo(path) {
  closePathModal();
  loadRepoGraph(path);
  loadRepoFileTree(path);
}

function reindexRepo(path) {
  showToast('⏳ Indexing documentation into .docgraph/docgraph.db...');
  fetch('/api/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      showToast(`✅ Indexed ${res.files} files, ${res.nodes} nodes, ${res.edges} edges!`);
      loadRepositories();
      loadRepoGraph(path);
    } else {
      alert('Index failed: ' + res.error);
    }
  });
}

function renderDirectoryNode(node, container, level = 0) {
  if (node.type === 'dir') {
    const dirEl = document.createElement('div');
    dirEl.className = 'tree-item';
    dirEl.style.paddingLeft = `${level * 14 + 8}px`;
    dirEl.innerHTML = `<span>📁 ${escapeHtml(node.name)}</span>`;
    container.appendChild(dirEl);

    if (node.children) {
      node.children.forEach(child => renderDirectoryNode(child, container, level + 1));
    }
  } else if (node.type === 'file') {
    const fileEl = document.createElement('div');
    fileEl.className = 'tree-item';
    fileEl.style.paddingLeft = `${level * 14 + 8}px`;
    fileEl.innerHTML = `
      <span>📄 ${escapeHtml(node.name)}</span>
      <span class="tree-line-badge">${node.headings}h</span>
    `;
    fileEl.addEventListener('click', () => {
      document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
      fileEl.classList.add('active');
      openMarkdownFile(node.path);
    });
    container.appendChild(fileEl);
  }
}

function openMarkdownFile(filePath, targetHeading = null) {
  currentFilePath = filePath;
  document.getElementById('current-breadcrumb').textContent = filePath;

  // 1. Fetch TOC
  fetch(`/api/doc/toc?file=${encodeURIComponent(filePath)}&format=json`)
    .then(res => res.json())
    .then(headings => {
      currentToc = headings;
      renderTocList(headings);
    });

  // 2. Fetch Content
  fetch(`/api/doc/section?file=${encodeURIComponent(filePath)}`)
    .then(res => res.json())
    .then(data => {
      currentFileContent = data.content;
      switchTab('toc');

      if (targetHeading) {
        selectHeadingByTitle(targetHeading);
      } else if (currentToc.length > 0) {
        selectHeading(currentToc[0]);
      } else {
        renderMarkdown(currentFileContent);
      }
    });
}

function renderTocList(headings) {
  const container = document.getElementById('tree-toc-content');
  container.innerHTML = '';
  if (!headings || headings.length === 0) {
    container.innerHTML = '<div style="padding:16px; color:#8b949e; text-align:center;">No headings found.</div>';
    return;
  }

  headings.forEach(h => {
    const el = document.createElement('div');
    el.className = `tree-item toc-item`;
    el.style.paddingLeft = `${(h.level - 1) * 14 + 8}px`;
    el.innerHTML = `
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${'#'.repeat(h.level)} ${escapeHtml(h.title)}</span>
      <span class="tree-line-badge">L${h.line}</span>
    `;
    el.addEventListener('click', () => {
      document.querySelectorAll('.toc-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      selectHeading(h);

      // Find 3D node and focus
      const matchedNode = graphData.nodes.find(n => n.name === h.title);
      if (matchedNode) focusOnNode(matchedNode);
    });
    container.appendChild(el);
  });
}

function selectHeading(heading) {
  fetch(`/api/doc/section?file=${encodeURIComponent(currentFilePath)}&heading=${encodeURIComponent(heading.title)}&sub=1`)
    .then(res => res.json())
    .then(data => {
      const slicedText = data.content;
      updateStatsAndIntelligence(currentFileContent, slicedText, heading);
      renderMarkdown(isSliceMode ? slicedText : currentFileContent);
    });
}

function selectHeadingByTitle(title) {
  const found = currentToc.find(h => h.title.toLowerCase().includes(title.toLowerCase()));
  if (found) {
    selectHeading(found);
  } else {
    renderMarkdown(currentFileContent);
  }
}

function renderMarkdown(mdText) {
  const container = document.getElementById('markdown-render-area');
  if (window.marked) {
    container.innerHTML = marked.parse(mdText);
    document.querySelectorAll('pre code').forEach((block) => {
      if (window.hljs) hljs.highlightElement(block);
    });
  } else {
    container.innerText = mdText;
  }
}

function updateStatsAndIntelligence(fullText, slicedText, heading) {
  const fullTokens = Math.ceil(fullText.length / 3.8);
  const slicedTokens = Math.ceil(slicedText.length / 3.8);
  const savings = Math.max(0, ((fullTokens - slicedTokens) / (fullTokens || 1)) * 100).toFixed(1);

  document.getElementById('stat-savings-badge').textContent = `${savings}%`;
  document.getElementById('stat-savings-fill').style.width = `${savings}%`;
  document.getElementById('stat-full-tokens').textContent = `${fullTokens.toLocaleString()} tokens`;
  document.getElementById('stat-sliced-tokens').textContent = `${slicedTokens.toLocaleString()} tokens`;

  document.getElementById('active-sec-title').textContent = heading.title;
  document.getElementById('active-sec-kind').textContent = `H${heading.level || 1} Heading`;
  document.getElementById('active-sec-line').textContent = `Line ${heading.line || 1}`;
  document.getElementById('active-sec-chars').textContent = slicedText.length.toLocaleString();

  document.getElementById('mcp-prompt-box').value = `[DocGraph Sliced Context: ${heading.title}]\n${slicedText}`;
}

function copyCurrentSection() {
  const text = document.getElementById('markdown-render-area').innerText;
  navigator.clipboard.writeText(text);
  showToast('✅ Sliced section copied!');
}

function copyMcpPayload() {
  const text = document.getElementById('mcp-prompt-box').value;
  if (!text) return;
  navigator.clipboard.writeText(text);
  showToast('✅ AI Prompt payload copied!');
}

function toggleTreePanel() {
  isTreeOpen = !isTreeOpen;
  const treePanel = document.getElementById('tree-panel');
  const btn = document.getElementById('btn-toggle-tree');
  treePanel.classList.toggle('hidden', !isTreeOpen);
  btn.classList.toggle('active', isTreeOpen);
}

function toggleDrawer() {
  isDrawerOpen = !isDrawerOpen;
  const drawer = document.getElementById('drawer');
  const btn = document.getElementById('btn-toggle-drawer');
  drawer.classList.toggle('hidden', !isDrawerOpen);
  btn.classList.toggle('active', isDrawerOpen);
}

function toggleSliceMode() {
  isSliceMode = !isSliceMode;
  const btn = document.getElementById('btn-toggle-slice');
  btn.classList.toggle('active', isSliceMode);
  btn.textContent = isSliceMode ? '🗡️ Section Focus' : '📖 Full Doc View';
}

function switchTab(tab) {
  const tocBtn = document.getElementById('tab-toc-btn');
  const filesBtn = document.getElementById('tab-files-btn');
  const tocContent = document.getElementById('tree-toc-content');
  const filesContent = document.getElementById('tree-files-content');

  if (tab === 'toc') {
    tocBtn.classList.add('active');
    filesBtn.classList.remove('active');
    tocContent.style.display = 'block';
    filesContent.style.display = 'none';
  } else {
    filesBtn.classList.add('active');
    tocBtn.classList.remove('active');
    filesContent.style.display = 'block';
    tocContent.style.display = 'none';
  }
}

function openPathModal() {
  document.getElementById('path-modal').classList.add('show');
  loadRepositories();
}

function closePathModal() {
  document.getElementById('path-modal').classList.remove('show');
}

function submitAddPath() {
  const input = document.getElementById('custom-path-input');
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
      loadRepositories();
      showToast('✅ Directory added successfully!');
    } else {
      alert('Error: ' + res.error);
    }
  });
}

function initSearch() {
  const searchBox = document.getElementById('search-box');
  searchBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = searchBox.value.trim().toLowerCase();
      if (!q) return;

      // Find in 3D graph
      const found = graphData.nodes.find(n => n.name.toLowerCase().includes(q));
      if (found) {
        focusOnNode(found);
        showToast(`🎯 Focused on node: ${found.name}`);
      } else {
        showToast(`❌ Node not found in 3D topology: ${q}`);
      }
    }
  });
}

function initResizers() {
  const treeResizer = document.getElementById('tree-resizer');
  const treePanel = document.getElementById('tree-panel');
  let isDraggingLeft = false;

  treeResizer.addEventListener('mousedown', () => {
    isDraggingLeft = true;
    document.body.style.cursor = 'col-resize';
  });

  const drawerResizer = document.getElementById('drawer-resizer');
  const drawer = document.getElementById('drawer');
  let isDraggingRight = false;

  drawerResizer.addEventListener('mousedown', () => {
    isDraggingRight = true;
    document.body.style.cursor = 'col-resize';
  });

  window.addEventListener('mousemove', (e) => {
    if (isDraggingLeft) {
      const newWidth = Math.max(200, Math.min(600, e.clientX));
      treePanel.style.width = newWidth + 'px';
    }
    if (isDraggingRight) {
      const newWidth = Math.max(280, Math.min(700, window.innerWidth - e.clientX));
      drawer.style.width = newWidth + 'px';
    }
  });

  window.addEventListener('mouseup', () => {
    isDraggingLeft = false;
    isDraggingRight = false;
    document.body.style.cursor = 'default';
  });
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
      document.getElementById('custom-path-input').value = selected;
    }
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

function toggleLanguage() {
  currentLanguage = currentLanguage === 'en' ? 'zh' : 'en';
  document.getElementById('btn-lang').textContent = `Language: ${currentLanguage.toUpperCase()}`;
  showToast(`Language: ${currentLanguage.toUpperCase()}`);
}

function resetToWelcome() {
  resetCamera();
  showToast('Reset camera view to center');
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
