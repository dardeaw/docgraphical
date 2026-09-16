// DocGraph Desktop Client Logic
(function() {
  const { extractToc, extractSection, searchDoc, parseHeadings } = window.docgraphCore || {};

  let currentFilePath = '';
  let currentFileContent = '';
  let currentHeadings = [];
  let currentActiveHeading = null;
  let isSliceMode = true;

  const tocTree = document.getElementById('tocTree');
  const markdownContainer = document.getElementById('markdownContainer');
  const currentDocName = document.getElementById('currentDocName');
  const headingCountBadge = document.getElementById('headingCountBadge');
  const breadcrumbPath = document.getElementById('breadcrumbPath');
  const toggleSliceModeBtn = document.getElementById('toggleSliceModeBtn');
  const copySliceBtn = document.getElementById('copySliceBtn');
  const copyMcpBtn = document.getElementById('copyMcpBtn');
  const mcpPayloadBox = document.getElementById('mcpPayloadBox');
  const searchInput = document.getElementById('searchInput');

  // Stats elements
  const savingPercentBadge = document.getElementById('savingPercentBadge');
  const tokenSavingsFill = document.getElementById('tokenSavingsFill');
  const fullTokenCount = document.getElementById('fullTokenCount');
  const slicedTokenCount = document.getElementById('slicedTokenCount');
  const activeHeadingTitle = document.getElementById('activeHeadingTitle');
  const activeHeadingLevel = document.getElementById('activeHeadingLevel');
  const activeLineSpan = document.getElementById('activeLineSpan');
  const activeCharCount = document.getElementById('activeCharCount');

  // Load File
  window.loadMarkdownContent = function(filePath, content) {
    currentFilePath = filePath;
    currentFileContent = content;
    const fileName = filePath.split(/[\\/]/).pop();

    currentDocName.textContent = fileName;
    breadcrumbPath.textContent = filePath;

    // Parse Headings
    currentHeadings = parseMarkdownHeadings(content);
    headingCountBadge.textContent = `${currentHeadings.length} Headings`;

    renderTocTree(currentHeadings);

    // Default: Focus first heading or full content
    if (currentHeadings.length > 0) {
      selectHeading(currentHeadings[0]);
    } else {
      renderMarkdown(content);
    }
  };

  function parseMarkdownHeadings(text) {
    const lines = text.split(/\r?\n/);
    const headings = [];
    let inCode = false;

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const stripped = line.trim();
      if (stripped.startsWith('```') || stripped.startsWith('~~~')) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;

      const m = stripped.match(/^(#{1,6})\s+(.+)$/);
      if (m) {
        headings.push({
          level: m[1].length,
          title: m[2].trim().replace(/\s+#+$/, ''),
          line: idx + 1
        });
      }
    }
    return headings;
  }

  function renderTocTree(headings) {
    tocTree.innerHTML = '';
    if (headings.length === 0) {
      tocTree.innerHTML = '<div class="empty-state"><p>No headings found.</p></div>';
      return;
    }

    headings.forEach((h, index) => {
      const el = document.createElement('div');
      el.className = `toc-item toc-level-${h.level}`;
      el.innerHTML = `
        <span class="toc-title">${'#'.repeat(h.level)} ${escapeHtml(h.title)}</span>
        <span class="toc-line">L${h.line}</span>
      `;
      el.addEventListener('click', () => {
        document.querySelectorAll('.toc-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
        selectHeading(h);
      });
      tocTree.appendChild(el);
    });
  }

  function selectHeading(heading) {
    currentActiveHeading = heading;
    const sliced = sliceSectionContent(currentFileContent, heading.title);

    // Update Stats
    updateIntelligenceStats(currentFileContent, sliced, heading);

    if (isSliceMode) {
      renderMarkdown(sliced);
    } else {
      renderMarkdown(currentFileContent);
      // Scroll to heading anchor if full doc
    }
  }

  function sliceSectionContent(fullText, targetTitle) {
    const lines = fullText.split(/\r?\n/);
    const cleanTarget = targetTitle.toLowerCase().replace(/^#+/, '').trim();

    let startIdx = -1;
    let targetLevel = -1;
    let inCode = false;

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const stripped = line.trim();
      if (stripped.startsWith('```') || stripped.startsWith('~~~')) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;

      const m = stripped.match(/^(#{1,6})\s+(.+)$/);
      if (m) {
        const title = m[2].trim().toLowerCase().replace(/\s+#+$/, '');
        if (title.includes(cleanTarget) || title === cleanTarget) {
          startIdx = idx;
          targetLevel = m[1].length;
          break;
        }
      }
    }

    if (startIdx === -1) return fullText;

    const outLines = [lines[startIdx]];
    inCode = false;

    for (let idx = startIdx + 1; idx < lines.length; idx++) {
      const line = lines[idx];
      const stripped = line.trim();
      if (stripped.startsWith('```') || stripped.startsWith('~~~')) {
        inCode = !inCode;
        outLines.push(line);
        continue;
      }
      if (!inCode) {
        const m = stripped.match(/^(#{1,6})\s+(.+)$/);
        if (m && m[1].length <= targetLevel) {
          break;
        }
      }
      outLines.push(line);
    }

    return outLines.join('\n');
  }

  function renderMarkdown(mdText) {
    if (window.marked) {
      markdownContainer.innerHTML = marked.parse(mdText);
      // Apply syntax highlight
      document.querySelectorAll('pre code').forEach((block) => {
        if (window.hljs) hljs.highlightElement(block);
      });
    } else {
      markdownContainer.innerText = mdText;
    }
  }

  function updateIntelligenceStats(fullText, slicedText, heading) {
    const fullTokens = Math.ceil(fullText.length / 3.8);
    const slicedTokens = Math.ceil(slicedText.length / 3.8);
    const savings = Math.max(0, ((fullTokens - slicedTokens) / (fullTokens || 1)) * 100).toFixed(1);

    fullTokenCount.textContent = fullTokens.toLocaleString();
    slicedTokenCount.textContent = slicedTokens.toLocaleString();
    savingPercentBadge.textContent = `${savings}%`;
    tokenSavingsFill.style.width = `${savings}%`;

    activeHeadingTitle.textContent = heading.title;
    activeHeadingLevel.textContent = `H${heading.level}`;
    activeLineSpan.textContent = `Line ${heading.line}`;
    activeCharCount.textContent = slicedText.length.toLocaleString();

    // Generate MCP Payload
    mcpPayloadBox.value = `[DocGraph Sliced Context: ${heading.title}]\n${slicedText}`;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Toggle Slice Mode
  toggleSliceModeBtn.addEventListener('click', () => {
    isSliceMode = !isSliceMode;
    toggleSliceModeBtn.classList.toggle('active', isSliceMode);
    toggleSliceModeBtn.textContent = isSliceMode ? '🗡️ Section Focus' : '📖 Full Doc View';
    if (currentActiveHeading) selectHeading(currentActiveHeading);
  });

  // Copy Slice
  copySliceBtn.addEventListener('click', () => {
    if (!currentActiveHeading) return;
    const sliced = sliceSectionContent(currentFileContent, currentActiveHeading.title);
    navigator.clipboard.writeText(sliced);
    copySliceBtn.textContent = '✅ Copied!';
    setTimeout(() => { copySliceBtn.textContent = '📋 Copy Sliced Section'; }, 2000);
  });

  // Copy MCP Payload
  copyMcpBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(mcpPayloadBox.value);
    copyMcpBtn.textContent = '✅ Copied for AI!';
    setTimeout(() => { copyMcpBtn.textContent = '📋 Copy for AI Agent'; }, 2000);
  });

  // Drag and Drop
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.getElementById('dropZoneOverlay').classList.remove('hidden');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.clientX === 0 && e.clientY === 0) {
      document.getElementById('dropZoneOverlay').classList.add('hidden');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.getElementById('dropZoneOverlay').classList.add('hidden');
    const file = e.dataTransfer.files[0];
    if (file && /\.(md|markdown|txt)$/i.test(file.name)) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        window.loadMarkdownContent(file.path || file.name, evt.target.result);
      };
      reader.readAsText(file);
    }
  });

  // Electron IPC Open Buttons
  document.getElementById('openFileBtn').addEventListener('click', () => {
    if (window.electronAPI) {
      window.electronAPI.openFileDialog();
    }
  });

})();
