#!/usr/bin/env node

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { extractToc, extractSection, searchDoc } = require('../lib/docgraphical');
const { runNodeMcpServer } = require('../lib/mcp');
const pkg = require('../package.json');

const args = process.argv.slice(2);

function printBanner() {
  console.log(`
===================================================================
   DocGraphical v${pkg.version} - Precision Markdown AST & Section Slicer
   Saving up to 97.4% tokens for AI Agents & Developers
===================================================================
`);
}

function printHelp() {
  printBanner();
  console.log(`
Commands:
  docgraphical toc <file.md> [--json] [--md]            Extract Table of Contents with line numbers
  docgraphical section <file.md> <heading> [--no-sub]   Extract target section surgically
  docgraphical search <dir/file> <query> [--limit N]    Search keywords across Markdown
  docgraphical mcp                                      Run stdio Model Context Protocol (MCP) server
  docgraphical --help, -h                               Show help
  docgraphical --version, -v                            Show version
`);
}

if (args[0] === 'mcp') {
  runNodeMcpServer();
} else if (args.length === 0) {
  printBanner();
  console.log('DocGraphical Interactive Terminal Mode (Type help for usage, exit to quit)\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'docg> '
  });

  rl.prompt();

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed === 'exit' || trimmed === 'quit' || trimmed === 'q') {
      process.exit(0);
    }

    if (trimmed === 'help' || trimmed === 'h' || trimmed === '?') {
      printHelp();
      rl.prompt();
      return;
    }

    const parts = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const cmd = parts[0];
    const cleanParts = parts.map(p => p.replace(/^"|"$/g, ''));

    if (cmd === 'toc') {
      const file = cleanParts[1];
      if (!file) {
        console.log('Error: Please provide a Markdown file path, e.g.: toc README.md');
      } else {
        const format = cleanParts.includes('--json') ? 'json' : (cleanParts.includes('--md') ? 'markdown' : 'text');
        console.log('\n' + extractToc(file, format) + '\n');
      }
    } else if (cmd === 'section') {
      const file = cleanParts[1];
      const heading = cleanParts[2];
      if (!file || !heading) {
        console.log('Error: Please provide file and section heading, e.g.: section README.md "Installation"');
      } else {
        const includeSub = !cleanParts.includes('--no-sub');
        console.log('\n' + extractSection(file, heading, includeSub) + '\n');
      }
    } else if (cmd === 'search') {
      const targetPath = cleanParts[1];
      const query = cleanParts[2];
      if (!targetPath || !query) {
        console.log('Error: Please provide path and search term, e.g.: search . "Token"');
      } else {
        console.log('\n' + searchDoc(targetPath, query, 30) + '\n');
      }
    } else {
      console.log(`Unknown command: ${cmd} (type help for usage)`);
    }

    rl.prompt();
  }).on('close', () => {
    process.exit(0);
  });

} else {
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log(`docgraphical v${pkg.version}`);
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
      console.error('Error: Usage: docgraphical section <file.md> <heading>');
      process.exit(1);
    }
    const includeSub = !args.includes('--no-sub');
    console.log(extractSection(file, heading, includeSub));

  } else if (command === 'search') {
    const targetPath = args[1];
    const query = args[2];
    if (!targetPath || !query) {
      console.error('Error: Usage: docgraphical search <path> <query>');
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
}
