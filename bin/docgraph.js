#!/usr/bin/env node

const { extractToc, extractSection, searchDoc } = require('../lib/docgraph');
const pkg = require('../package.json');

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
DocGraph v${pkg.version} - Surgical precision Markdown AST, TOC & section slicer for AI Agents.

Usage:
  docgraph toc <file.md> [--json] [--md]      Extract Table of Contents with line numbers
  docgraph section <file.md> <heading> [--no-sub]  Extract target section surgically
  docgraph search <dir/file> <query> [--limit N]  Search keywords across Markdown
  docgraph --help, -h                          Show help
  docgraph --version, -v                       Show version
`);
}

if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  printHelp();
  process.exit(0);
}

if (args.includes('-v') || args.includes('--version')) {
  console.log(`docgraph v${pkg.version}`);
  process.exit(0);
}

const command = args[0];

if (command === 'toc') {
  const file = args[1];
  if (!file) {
    console.error('Error: Please specify a Markdown file path.');
    process.exit(1);
  }
  const format = args.includes('--json') ? 'json' : (args.includes('--md') ? 'markdown' : 'text');
  console.log(extractToc(file, format));

} else if (command === 'section') {
  const file = args[1];
  const heading = args[2];
  if (!file || !heading) {
    console.error('Error: Usage: docgraph section <file.md> <heading>');
    process.exit(1);
  }
  const includeSub = !args.includes('--no-sub');
  console.log(extractSection(file, heading, includeSub));

} else if (command === 'search') {
  const targetPath = args[1];
  const query = args[2];
  if (!targetPath || !query) {
    console.error('Error: Usage: docgraph search <path> <query>');
    process.exit(1);
  }
  let limit = 30;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10) || 30;
  }
  console.log(searchDoc(targetPath, query, limit));

} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}
