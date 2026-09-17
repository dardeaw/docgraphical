#!/usr/bin/env node

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { extractToc, extractSection, searchDoc } = require('../lib/docgraphical');
const pkg = require('../package.json');

const args = process.argv.slice(2);

function printBanner() {
  console.log(`
===================================================================
   📄 DocGraphical v${pkg.version} - Precision Markdown AST & Section Slicer
   Saving up to 97% tokens for AI Agents & Developers
===================================================================
`);
}

function printHelp() {
  printBanner();
  console.log(`
Commands:
  docgraphical toc <file.md> [--json] [--md]       Extract Table of Contents with line numbers
  docgraphical section <file.md> <heading> [--no-sub]   Extract target section surgically
  docgraphical search <dir/file> <query> [--limit N]   Search keywords across Markdown
  docgraphical --help, -h                           Show help
  docgraphical --version, -v                        Show version
`);
}

// Check if running from double click (no arguments)
if (args.length === 0) {
  printBanner();
  console.log('📌 進入 DocGraphical 互動式終端模式 (雙擊開啟)');
  console.log('-------------------------------------------------------------------');
  console.log('指令範例:');
  console.log('  1. toc <檔案路徑.md>                (提取大綱目錄與行號)');
  console.log('  2. section <檔案路徑.md> <章節標題>  (精準切取指定段落)');
  console.log('  3. search <目錄或檔案> <關鍵字>      (檢索關鍵字與行號)');
  console.log('  4. help                             (顯示說明)');
  console.log('  5. exit / q                         (結束離開)');
  console.log('-------------------------------------------------------------------\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'docgraphical> '
  });

  rl.prompt();

  rl.on('line', (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === 'exit' || input === 'quit' || input === 'q') {
      console.log('感謝使用 DocGraphical，告退！');
      process.exit(0);
    }

    if (input === 'help' || input === '?') {
      printHelp();
      rl.prompt();
      return;
    }

    // Parse command tokens respecting quotes
    const parts = input.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const cmd = parts[0];
    const cleanParts = parts.map(p => p.replace(/^"|"$/g, ''));

    if (cmd === 'toc') {
      const file = cleanParts[1];
      if (!file) {
        console.log('❌ 錯誤：請提供 Markdown 檔案路徑，例如：toc README.md');
      } else {
        const format = cleanParts.includes('--json') ? 'json' : (cleanParts.includes('--md') ? 'markdown' : 'text');
        console.log('\n' + extractToc(file, format) + '\n');
      }
    } else if (cmd === 'section') {
      const file = cleanParts[1];
      const heading = cleanParts[2];
      if (!file || !heading) {
        console.log('❌ 錯誤：請提供檔案與章節標題，例如：section README.md "Installation"');
      } else {
        const includeSub = !cleanParts.includes('--no-sub');
        console.log('\n' + extractSection(file, heading, includeSub) + '\n');
      }
    } else if (cmd === 'search') {
      const targetPath = cleanParts[1];
      const query = cleanParts[2];
      if (!targetPath || !query) {
        console.log('❌ 錯誤：請提供路徑與關鍵字，例如：search . "Token"');
      } else {
        console.log('\n' + searchDoc(targetPath, query, 30) + '\n');
      }
    } else {
      console.log(`❌ 未知指令: ${cmd} (輸入 help 查看說明)`);
    }

    rl.prompt();
  }).on('close', () => {
    process.exit(0);
  });

} else {
  // Command line argument mode
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
