// Entry program for make.fun's "Bring the humans with a TikTok ad" bounty
// (bring-the-humans-03), written for the node22 runtime, standard library only.
//
// The entry itself is the TikTok video named by VIDEO.json at this repository's
// root; the house reads that video's views from TikTok and ranks by them. All
// this program has to do is hand the gate a copy of VIDEO.json: it copies the
// file, byte for byte, from the bot directory to the output directory, where
// the grader reads it and writes its own video.counts.json beside it.
//
// Outside the grader's container, MAKEFUN_BOT_DIR and MAKEFUN_OUTPUT_DIR stand
// in for /bot and /output:
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
// The program uses no network, no clock and no file outside those two
// directories, so two runs always write the same bytes.

import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const botDir = process.env.MAKEFUN_BOT_DIR ?? '/bot';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const source = join(botDir, 'VIDEO.json');

// Read the file before copying anything: a malformed VIDEO.json should fail
// here with a clear message instead of reaching the gate as a surprise.
let parsed: unknown;
try {
  parsed = JSON.parse(readFileSync(source, 'utf8'));
} catch (err) {
  console.error(`VIDEO.json at ${source} could not be read: ${(err as Error).message}`);
  process.exit(1);
}
if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { url?: unknown }).url !== 'string') {
  console.error('VIDEO.json must be a JSON object with a string "url" naming the TikTok video.');
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
const destination = join(outputDir, 'VIDEO.json');
copyFileSync(source, destination);

// The gate trusts this copy with the entry's validity, so prove the copy is
// whole before reporting success: a size mismatch means the write was cut
// short, and failing loudly here beats a silent bad hand-in.
if (statSync(destination).size !== statSync(source).size) {
  console.error('The copied VIDEO.json does not match the original size; the copy is incomplete.');
  process.exit(1);
}
