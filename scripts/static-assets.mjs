// Favicons, touch icon, logo and manifest generated from the logo mark.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PUBLIC_DIR } from './lib/common.mjs';

const mark = (bg = '#17181a', fg = '#ffffff', radius = 9) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="${radius}" fill="${bg}"/><rect x="7" y="8" width="18" height="5" rx="1.75" fill="${fg}"/><rect x="7" y="15" width="18" height="3" rx="1.25" fill="${fg}" opacity=".62"/><rect x="7" y="20" width="11" height="3" rx="1.25" fill="${fg}" opacity=".38"/></svg>`;

fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.svg'), mark() + '\n');
const png = (size, radius = 9) => sharp(Buffer.from(mark('#17181a', '#ffffff', radius))).resize(size, size).png().toBuffer();

// apple-touch-icon: full-bleed square (iOS rounds it), maskable-ish.
fs.writeFileSync(path.join(PUBLIC_DIR, 'apple-touch-icon.png'), await sharp(Buffer.from(mark('#17181a', '#ffffff', 0))).resize(180, 180).png().toBuffer());
fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon-192.png'), await png(192));
fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon-512.png'), await png(512));
fs.writeFileSync(path.join(PUBLIC_DIR, 'logo-512.png'), await sharp(Buffer.from(mark('#17181a', '#ffffff', 0))).resize(512, 512).png().toBuffer());

// favicon.ico containing a 32×32 PNG (PNG-in-ICO is valid everywhere modern).
const ico32 = await png(32, 8);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt8(32, 6); header.writeUInt8(32, 7); header.writeUInt8(0, 8); header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(ico32.length, 14); header.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.ico'), Buffer.concat([header, ico32]));

fs.writeFileSync(
  path.join(PUBLIC_DIR, 'site.webmanifest'),
  JSON.stringify({
    name: 'UI Sections',
    short_name: 'UI Sections',
    description: 'Website section design inspiration',
    start_url: '/',
    display: 'browser',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/favicon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/favicon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }, null, 2) + '\n',
);
console.log('Static assets written to public/');
