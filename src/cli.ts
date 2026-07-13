#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { render } from './index';

function usage() {
  console.log('Usage: cppslash -i <input.cpp> [-o out.html] [--clangd /path/to/clangd] [--theme nord]');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) return usage();
  let infile = '';
  let outfile = '';
  let clangd = 'clangd';
  let theme = 'nord';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-i' && argv[i + 1]) {
      infile = argv[++i];
    } else if (a === '-o' && argv[i + 1]) {
      outfile = argv[++i];
    } else if (a === '--clangd' && argv[i + 1]) {
      clangd = argv[++i];
    } else if (a === '--theme' && argv[i + 1]) {
      theme = argv[++i];
    } else {
      console.log('Unknown arg', a);
      return usage();
    }
  }
  if (!infile) return usage();
  const code = fs.readFileSync(infile, 'utf8');
  const result = await render(code, { fileName: path.basename(infile), clangdPath: clangd, theme });
  if (outfile) {
    fs.writeFileSync(outfile, result, 'utf8');
    console.log('Wrote', outfile);
  } else {
    console.log(result);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});