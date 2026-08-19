/**
 * Istemci modulleri icin bagimlilik denetimi.
 *
 * Tarayici kodu Node'da calistirilamadigi icin (document/window yok) klasik
 * birim testi yerine STATIK kontrol yapiyoruz:
 *   1. Her dosya sozdizimi acisindan gecerli mi? (node --check)
 *   2. Her `import { X } from './y.js'` ifadesindeki X, hedef dosyada
 *      gercekten export edilmis mi?
 *   3. Import edilen dosya diskte var mi?
 *
 * Bu kontrol, "fonksiyon adini yaninlis yazdim" veya "export etmeyi unuttum"
 * gibi hatalari tarayiciyi acmadan yakalar.
 *
 * Kullanim: node scripts/check-frontend.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = path.join(ROOT_DIR, 'public', 'scripts');

let problems = 0;

/** Dosyadaki export edilen isimleri toplar. */
function collectExports(source) {
  const names = new Set();

  // export function foo / export async function foo / export class Foo
  for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(match[1]);
  }
  // export const foo = ... / export let foo
  for (const match of source.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(match[1]);
  }
  // export { foo, bar as baz }
  for (const match of source.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const part of match[1].split(',')) {
      const exported = part.includes(' as ') ? part.split(' as ')[1] : part;
      const trimmed = exported.trim();
      if (trimmed !== '') names.add(trimmed);
    }
  }
  if (/^export\s+default\b/m.test(source)) names.add('default');

  return names;
}

/** Dosyadaki import ifadelerini toplar. */
function collectImports(source) {
  /** @type {{ specifier: string, names: string[] }[]} */
  const imports = [];

  for (const match of source.matchAll(/^import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"]/gm)) {
    const clause = match[1].trim();
    const specifier = match[2];

    const names = [];

    // Suslu parantez icindeki adlandirilmis importlar
    const namedMatch = clause.match(/\{([^}]*)\}/);
    if (namedMatch) {
      for (const part of namedMatch[1].split(',')) {
        const imported = part.split(' as ')[0].trim();
        if (imported !== '') names.push(imported);
      }
    }

    // Varsayilan import (suslu parantezden onceki ad)
    const defaultMatch = clause.match(/^([A-Za-z0-9_$]+)\s*(?:,|$)/);
    if (defaultMatch) names.push('default');

    imports.push({ specifier, names });
  }

  return imports;
}

const files = (await readdir(SCRIPTS_DIR)).filter((name) => name.endsWith('.js'));

console.log(`\nIstemci modul denetimi (${files.length} dosya)\n`);

/** @type {Map<string, Set<string>>} */
const exportsByFile = new Map();
/** @type {Map<string, string>} */
const sourceByFile = new Map();

for (const file of files) {
  const source = readFileSync(path.join(SCRIPTS_DIR, file), 'utf8');
  sourceByFile.set(file, source);
  exportsByFile.set(file, collectExports(source));
}

// 1. Sozdizimi kontrolu
for (const file of files) {
  const filePath = path.join(SCRIPTS_DIR, file);
  try {
    execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
    console.log(`  OK   sozdizimi: ${file}`);
  } catch (error) {
    problems += 1;
    console.error(`  FAIL sozdizimi: ${file}\n${error.stderr?.toString() ?? error.message}`);
  }
}

// 2 + 3. Import/export tutarliligi
for (const file of files) {
  for (const { specifier, names } of collectImports(sourceByFile.get(file))) {
    // Yalnizca yerel (goreli) importlari denetleriz
    if (!specifier.startsWith('.')) continue;

    const targetFile = path.basename(specifier);

    if (!exportsByFile.has(targetFile)) {
      problems += 1;
      console.error(`  FAIL ${file}: "${specifier}" dosyasi bulunamadi`);
      continue;
    }

    const available = exportsByFile.get(targetFile);
    for (const name of names) {
      if (!available.has(name)) {
        problems += 1;
        console.error(`  FAIL ${file}: "${name}" adi ${targetFile} tarafindan export edilmiyor`);
      }
    }
  }
  console.log(`  OK   importlar: ${file}`);
}

// 4. innerHTML kullanimi (XSS riski) uyarisi
for (const file of files) {
  if (/\.innerHTML\s*=/.test(sourceByFile.get(file))) {
    problems += 1;
    console.error(`  FAIL ${file}: innerHTML atamasi bulundu (textContent kullanilmali)`);
  }
}

console.log(problems === 0 ? '\nTum kontroller gecti.\n' : `\n${problems} sorun bulundu.\n`);
process.exit(problems === 0 ? 0 : 1);
