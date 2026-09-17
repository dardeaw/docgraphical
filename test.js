const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseHeadings, extractToc, extractSection, searchDoc } = require('./lib/docgraphical');

const samplePath = path.join(__dirname, 'test_sample.md');
const sampleContent = `# Sample Spec

Intro text.

## 1. Architecture
Details about architecture.

### 1.1 Storage Engine
Details on storage.

\`\`\`python
# Comment in python code block
x = 1
\`\`\`

## 2. Quickstart
Run \`npm install -g docgraphical\`
`;

fs.writeFileSync(samplePath, sampleContent, 'utf-8');

try {
  console.log('Testing Node.js DocGraphical engine...');

  // 1. parseHeadings
  const headings = parseHeadings(samplePath);
  assert.strictEqual(headings.length, 4, 'Should parse exactly 4 headings');
  assert.strictEqual(headings[0].title, 'Sample Spec');
  assert.strictEqual(headings[1].title, '1. Architecture');
  console.log('  ✔ parseHeadings (code block protection intact)');

  // 2. extractToc
  const toc = extractToc(samplePath);
  assert.ok(toc.includes('[DocGraphical TOC]'), 'TOC header must exist');
  assert.ok(toc.includes('## 1. Architecture'), 'TOC item must exist');
  console.log('  ✔ extractToc text format');

  // 3. extractSection
  const sec = extractSection(samplePath, '1. Architecture');
  assert.ok(sec.includes('### 1.1 Storage Engine'), 'Subsections should be included by default');
  assert.ok(!sec.includes('## 2. Quickstart'), 'Next section must be excluded');
  console.log('  ✔ extractSection surgical slicing');

  // 4. searchDoc
  const res = searchDoc(samplePath, 'quickstart');
  assert.ok(res.includes('Quickstart'), 'Search should find keyword');
  console.log('  ✔ searchDoc line query');

  console.log('\n🎉 All 4 Node.js tests passed 100%!');
} finally {
  if (fs.existsSync(samplePath)) {
    fs.unlinkSync(samplePath);
  }
}
