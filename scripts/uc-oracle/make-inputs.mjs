#!/usr/bin/env node
/**
 * オラクルの入力 PDF を凍結する。
 *
 * **なぜ今のうちに作ってコミットするのか**
 * writer のテストは AcroForm の検体を **pdf-lib で毎回組み立てている**
 * （`tests/form.test.ts` の `makeFormPdf`）。pdf-lib を撤去すると**検体を作る手段ごと消える**ので、
 * フォーム系の UC は「新実装で作った入力を新実装で読む」ことになり、
 * 誤りが打ち消し合う（GUARDS T-2）。だから **pdf-lib がまだ在るうちに** 1 回だけ生成し、
 * バイト列としてリポジトリに固定する。以後この入力は二度と再生成しない。
 *
 *   node scripts/uc-oracle/make-inputs.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'inputs');
mkdirSync(outDir, { recursive: true });

/** text / checkbox / dropdown / radio を 1 つずつ持つフォーム（tests/form.test.ts と同じ形） */
const doc = await PDFDocument.create();
const page = doc.addPage([400, 300]);
const font = await doc.embedFont(StandardFonts.Helvetica);
const form = doc.getForm();

const name = form.createTextField('user.name');
name.setText('Taro');
name.addToPage(page, { x: 50, y: 200, width: 200, height: 24, font });

const agree = form.createCheckBox('agree');
agree.addToPage(page, { x: 50, y: 150, width: 16, height: 16 });

const plan = form.createDropdown('plan');
plan.setOptions(['Basic', 'Pro']);
plan.select('Basic');
plan.addToPage(page, { x: 50, y: 100, width: 120, height: 24, font });

const color = form.createRadioGroup('color');
color.addOptionToPage('red', page, { x: 50, y: 60, width: 16, height: 16 });
color.addOptionToPage('blue', page, { x: 80, y: 60, width: 16, height: 16 });

// 日付を固定して決定論的に（毎回違うバイト列を凍結しても意味が無い）
doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
doc.setProducer('uc-oracle frozen input');
doc.setCreator('uc-oracle frozen input');

const bytes = await doc.save();
const path = join(outDir, 'form-basic.pdf');
writeFileSync(path, bytes);
console.log(`凍結した: ${path} (${bytes.length} bytes)`);
