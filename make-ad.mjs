// make-ad.mjs — builds the TikTok ad for make.fun's bring-the-humans-03 bounty.
//
// Written and run by the agent in its recorded session. It:
//   1. checks the press-pack assets (brand badge overlay, referral end card,
//      mascot illustrations) in the press directory, fetching any that are
//      missing from the URLs the press manifest lists and verifying the end
//      card's sha256 against the manifest;
//   2. synthesises a short original music bed as PCM and writes it as a WAV;
//   3. composes the vertical scenes (animated glow, mascot illustrations,
//      on-screen text) into a base clip with ffmpeg;
//   4. finishes the clip with the press pack's brand badge over it from the
//      first frame and the referral end card over its last seconds, with our
//      referral code typed into the card's field, following the press guide's
//      recipe (https://make.fun/press/llms.txt).
//
// Press files themselves are never copied into this repository: they stay in
// the press directory (MAKEFUN_PRESS_DIR, default ../bring-the-humans-03-press
// next to this repo's parent), as the bounty's AGENT.md asks.
//
// Usage: node make-ad.mjs
// Output: ad.mp4 in this directory, plus build/ intermediates and the
// first-frame.png / last-frame.png check frames.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRESS = process.env.MAKEFUN_PRESS_DIR ?? join(HERE, '..', '..', 'bring-the-humans-03-press');
const BUILD = join(HERE, 'build');
mkdirSync(BUILD, { recursive: true });

// --- the ad's facts -------------------------------------------------------
const REFERRAL_CODE = 'c4487pg0';
const W = 1080;
const H = 1920;
const FPS = 30;
const DURATION = 22; // seconds of base clip; the card overlays the last 2.5
const CARD_LEN = 2.5;
const CARD_REST = 1.433;
const CARD_AT = DURATION - CARD_LEN;
const INK = '0x191419';
const MAGENTA = '0xc41c83';
const FONT_BLACK = '/usr/share/fonts/truetype/noto/NotoSans-Black.ttf';
const FONT_MONO = join(PRESS, 'JetBrainsMono-Bold.ttf');

function run(cmd, args) {
  console.log('+', cmd, args.slice(0, 3).join(' '), args.length > 3 ? '…' : '');
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// --- 1. press assets ------------------------------------------------------
const ASSETS = [
  { file: 'makefun-badge-9x16.png', url: 'https://make.fun/press/brand-badge/9x16/makefun-badge-9x16.png' },
  {
    file: 'makefun-card-9x16-transparent.webm',
    url: 'https://make.fun/press/referral-card/9x16/makefun-card-9x16-transparent.webm',
    sha256: '286b76c671fa3bf3b1580a7c71675d7b7e502f4fb374b56d30f1104044808cd1',
  },
  { file: 'ghost-laptop-recording.png', url: 'https://make.fun/press/illustrations/ghost-laptop-recording.png' },
  { file: 'ghost-judge-paddle.png', url: 'https://make.fun/press/illustrations/ghost-judge-paddle.png' },
];
for (const a of ASSETS) {
  const p = join(PRESS, a.file);
  if (!existsSync(p)) {
    console.log('fetching', a.url);
    run('curl', ['-sSL', '--retry', '5', '--retry-all-errors', '-o', p, a.url]);
  }
  if (a.sha256 && sha256(p) !== a.sha256) {
    throw new Error(`${a.file}: sha256 does not match the press manifest`);
  }
  console.log('asset ok:', a.file);
}
if (!existsSync(FONT_MONO)) throw new Error('JetBrainsMono-Bold.ttf missing in the press directory');

// --- 2. music bed (original synth, PCM WAV) -------------------------------
// A I–V–vi–IV loop in C at a gentle tempo: soft triangle arpeggios over a
// sine root, written sample by sample. Nothing sampled, nothing downloaded.
function writeMusic() {
  const sr = 44100;
  const total = Math.floor(sr * DURATION);
  const data = new Float32Array(total);
  const chords = [
    [130.81, 164.81, 196.0, 261.63], // C
    [98.0, 146.83, 196.0, 246.94], //   G
    [110.0, 164.81, 220.0, 261.63], //  Am
    [87.31, 130.81, 174.61, 220.0], //  F
  ];
  const barLen = 2.75; // seconds per chord; 8 bars fill the clip
  const step = barLen / 8; // eighth-note arpeggio
  const addTone = (freq, start, dur, gain, bright = 0.25) => {
    const s0 = Math.floor(start * sr);
    const s1 = Math.min(total, Math.floor((start + dur) * sr));
    for (let i = s0; i < s1; i++) {
      const t = (i - s0) / sr;
      const env = Math.exp(-3.2 * t) * Math.min(1, t / 0.012);
      const ph = 2 * Math.PI * freq * t;
      data[i] += gain * env * (Math.sin(ph) + bright * Math.sin(2 * ph));
    }
  };
  for (let bar = 0; bar < 8; bar++) {
    const chord = chords[bar % 4];
    const t0 = bar * barLen;
    addTone(chord[0] / 2, t0, barLen * 0.95, 0.5, 0.1); // root, an octave down
    addTone(chord[0], t0, barLen * 0.9, 0.22, 0.1);
    for (let s = 0; s < 8; s++) {
      const note = chord[[0, 1, 2, 3, 2, 1, 2, 3][s]];
      addTone(note * 2, t0 + s * step, step * 1.6, 0.16);
    }
  }
  // master fades, then 16-bit PCM
  const fadeIn = 0.3 * sr;
  const fadeOut = 1.6 * sr;
  const pcm = Buffer.alloc(44 + total * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + total * 2, 4); pcm.write('WAVE', 8);
  pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(sr, 24); pcm.writeUInt32LE(sr * 2, 28);
  pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36);
  pcm.writeUInt32LE(total * 2, 40);
  for (let i = 0; i < total; i++) {
    let g = 0.55;
    if (i < fadeIn) g *= i / fadeIn;
    if (i > total - fadeOut) g *= (total - i) / fadeOut;
    const v = Math.max(-1, Math.min(1, data[i] * g));
    pcm.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  const out = join(BUILD, 'music.wav');
  writeFileSync(out, pcm);
  console.log('music written:', out);
  return out;
}

// --- 3a. a soft magenta glow sprite (PNG written by hand) ------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function writeGlow() {
  const S = 512;
  const raw = Buffer.alloc(S * (1 + S * 4));
  for (let y = 0; y < S; y++) {
    const row = y * (1 + S * 4);
    raw[row] = 0;
    for (let x = 0; x < S; x++) {
      const dx = (x - S / 2) / (S / 2);
      const dy = (y - S / 2) / (S / 2);
      const r2 = dx * dx + dy * dy;
      const a = Math.max(0, 1 - Math.sqrt(r2));
      const o = row + 1 + x * 4;
      raw[o] = 0xc4; raw[o + 1] = 0x1c; raw[o + 2] = 0x83;
      raw[o + 3] = Math.round(165 * a * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const out = join(BUILD, 'glow.png');
  writeFileSync(out, png);
  console.log('glow written:', out);
  return out;
}

// --- 3b. scenes -------------------------------------------------------------
// Text lives in the manifest's safe zone (x 120..960) and below the badge
// (the badge's box ends at y 400; keep 24 px clear). Lines fade in and out.
const SCENES = [
  { at: 0.0, until: 3.4, art: 'laptop', lines: [
    { text: 'Your AI agent', size: 96, y: 500, colour: 'white' },
    { text: 'just got a job.', size: 96, y: 620, colour: 'white' },
    { text: 'and it pays real money', size: 54, y: 760, colour: MAGENTA },
  ] },
  { at: 3.4, until: 7.6, lines: [
    { text: 'On make.fun,', size: 84, y: 560, colour: 'white' },
    { text: 'AI agents compete', size: 84, y: 680, colour: 'white' },
    { text: 'in bounties', size: 84, y: 800, colour: 'white' },
    { text: 'for real money.', size: 84, y: 920, colour: MAGENTA },
  ] },
  { at: 7.6, until: 11.8, stagger: 0.55, lines: [
    { text: 'People post bounties.', size: 72, y: 540, colour: 'white' },
    { text: 'Agents build, code', size: 72, y: 660, colour: 'white' },
    { text: 'and create.', size: 72, y: 780, colour: 'white' },
    { text: 'The best work wins USDC.', size: 60, y: 920, colour: MAGENTA },
  ] },
  { at: 11.8, until: 16.0, art: 'judge', lines: [
    { text: 'Real prizes.', size: 84, y: 500, colour: 'white' },
    { text: 'Public rankings.', size: 84, y: 620, colour: 'white' },
    { text: 'New bounties every week.', size: 58, y: 750, colour: 'white' },
  ] },
  { at: 16.0, until: 19.5, lines: [
    { text: 'Enter your AI agent', size: 80, y: 640, colour: 'white' },
    { text: 'in a bounty', size: 80, y: 770, colour: 'white' },
    { text: 'on make.fun', size: 80, y: 900, colour: MAGENTA },
  ] },
];

function drawtextFilters() {
  const parts = [];
  SCENES.forEach((scene, si) => {
    scene.lines.forEach((line, li) => {
      const start = scene.at + (scene.stagger ? li * scene.stagger : 0);
      const file = join(BUILD, `line-${si}-${li}.txt`);
      writeFileSync(file, line.text);
      // The first scene is fully visible from frame 0 (it is the thumbnail a
      // scrolling viewer sees); later scenes fade in over 0.3 s.
      const fadeIn = si === 0 ? '1' : `if(lt(t\\,${start + 0.3})\\,(t-${start})/0.3\\,1)`;
      const fadeOut = `if(gt(t\\,${scene.until - 0.3})\\,(${scene.until}-t)/0.3\\,1)`;
      const shown = `between(t\\,${start}\\,${scene.until})`;
      parts.push(
        `drawtext=fontfile=${FONT_BLACK}:textfile=${file}:fontsize=${line.size}` +
        `:fontcolor=${line.colour}:x=(w-text_w)/2:y=${line.y}` +
        `:shadowcolor=black@0.45:shadowx=3:shadowy=3` +
        `:alpha='${fadeIn}*${fadeOut}':enable='${shown}'`,
      );
    });
  });
  return parts;
}

function buildClip(music, glow) {
  const laptop = join(PRESS, 'ghost-laptop-recording.png');
  const judge = join(PRESS, 'ghost-judge-paddle.png');
  const filters = [];
  // background: solid ink, two glow sprites drifting slowly (one split, two uses)
  filters.push(`color=c=${INK}:s=${W}x${H}:r=${FPS}:d=${DURATION}[bg0]`);
  filters.push(`[1:v]split[g1][g2]`);
  filters.push(`[bg0][g1]overlay=x='120+40*sin(t*0.21)':y='180+30*cos(t*0.17)'[bg1]`);
  filters.push(`[bg1][g2]overlay=x='430+50*cos(t*0.13)':y='1150+40*sin(t*0.19)'[bg]`);
  // mascot illustrations, native size, inside their scenes
  filters.push(`[bg][2:v]overlay=x=(W-w)/2:y=1010:enable='between(t,0,3.4)'[s1]`);
  filters.push(`[s1][3:v]overlay=x=(W-w)/2:y=860:enable='between(t,11.8,16.0)'[s4]`);
  filters.push(`[s4]${drawtextFilters().join(',')}[v]`);
  const out = join(BUILD, 'clip.mp4');
  run('ffmpeg', [
    '-y',
    '-i', music,
    '-loop', '1', '-t', String(DURATION), '-i', glow,
    '-loop', '1', '-t', String(DURATION), '-i', laptop,
    '-loop', '1', '-t', String(DURATION), '-i', judge,
    '-filter_complex', filters.join(';'),
    '-map', '[v]', '-map', '0:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17',
    '-c:a', 'aac', '-shortest', out,
  ]);
  console.log('clip written:', out);
  return out;
}

// --- 4. badge + end card (the press guide's recipe, our numbers) -----------
function finish(clip) {
  const badge = join(PRESS, 'makefun-badge-9x16.png');
  const card = join(PRESS, 'makefun-card-9x16-transparent.webm');
  const T = CARD_AT;
  const fc = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuva420p,split[clip][soft]`,
    `[soft]gblur=sigma=28,eq=saturation=0.35,fade=t=in:st=${T}:d=0.8:alpha=1[softf]`,
    `[clip][softf]overlay[bg]`,
    `[bg][2:v]overlay=enable='lt(t,${T})'[badged]`,
    `[1:v]format=yuva420p,setpts=PTS-STARTPTS+${T}/TB[card]`,
    `[badged][card]overlay=eof_action=pass,` +
      `drawbox=x=208:y=1230:w=9:h=82:color=white:t=fill:enable='gte(t,${T + CARD_REST})',` +
      `drawtext=fontfile=${FONT_MONO}:text=${REFERRAL_CODE}:fontsize=62:fontcolor=${INK}` +
      `:x=210:y=1271-(ascent-descent)/2:enable='gte(t,${T + CARD_REST})'[v]`,
  ].join(';');
  const out = join(HERE, 'ad.mp4');
  run('ffmpeg', [
    '-y', '-i', clip,
    '-c:v', 'libvpx-vp9', '-i', card,
    '-i', badge,
    '-filter_complex', fc,
    '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
    '-c:a', 'aac', '-movflags', '+faststart', out,
  ]);
  console.log('ad written:', out);
  return out;
}

const music = writeMusic();
const glow = writeGlow();
const clip = buildClip(music, glow);
const ad = finish(clip);

// check frames, the way the bounty's AGENT.md asks
run('ffmpeg', ['-y', '-i', ad, '-frames:v', '1', join(HERE, 'first-frame.png')]);
run('ffmpeg', ['-y', '-sseof', '-0.1', '-i', ad, '-frames:v', '1', join(HERE, 'last-frame.png')]);
console.log('done:', ad);
