// Source-preserving format conversion, not an illustration or background-removal tool.
// Run with Electron: electron scripts/create-lulu-icon.cjs --output=<absolute .ico path>
const fs = require('node:fs');
const path = require('node:path');
const ICON_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 128, 256]);

function fitIconFrame(width, height, size) {
  if (![width, height, size].every(value => Number.isInteger(value) && value > 0)) {
    throw new Error('Image dimensions must be positive integers.');
  }
  const scale = size / Math.max(width, height);
  const fittedWidth = Math.max(1, Math.round(width * scale));
  const fittedHeight = Math.max(1, Math.round(height * scale));
  return { width: fittedWidth, height: fittedHeight,
    left: Math.floor((size - fittedWidth) / 2), top: Math.floor((size - fittedHeight) / 2) };
}

function createIconBuffer(image, nativeImage) {
  if (image.isEmpty()) throw new Error('The source mascot could not be decoded.');
  const sourceSize = image.getSize();
  const placements = ICON_SIZES.map(size => ({ size, ...fitIconFrame(sourceSize.width, sourceSize.height, size) }));
  const frames = placements.map(({ size, width, height, left, top }) => {
    const fitted = image.resize({ width, height, quality: 'best' }).toBitmap({ scaleFactor: 1 });
    if (fitted.length !== width * height * 4) throw new Error('Unexpected decoded bitmap dimensions.');
    // Keep the complete image and its alpha. Only add transparent rows/columns to fit ICO squares.
    const square = Buffer.alloc(size * size * 4);
    for (let y = 0; y < height; y++) {
      fitted.copy(square, ((y + top) * size + left) * 4, y * width * 4, (y + 1) * width * 4);
    }
    return nativeImage.createFromBitmap(square, { width: size, height: size, scaleFactor: 1 }).toPNG();
  });
  const header = Buffer.alloc(6 + ICON_SIZES.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(ICON_SIZES.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    header[entry] = ICON_SIZES[index] === 256 ? 0 : ICON_SIZES[index];
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  return { buffer: Buffer.concat([header, ...frames]), sourceSize, placements };
}

module.exports = { fitIconFrame, createIconBuffer, ICON_SIZES };

// Electron's default launcher loads a .cjs entry without assigning require.main.
const isElectronEntry = process.versions.electron && process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (require.main === module || isElectronEntry) {
  const { app, nativeImage } = require('electron');
  try {
    const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
    if (!output || !path.isAbsolute(output) || path.extname(output).toLowerCase() !== '.ico') {
      throw new Error('An explicit absolute --output=<path.ico> is required.');
    }
    const image = nativeImage.createFromPath(path.resolve(__dirname, '../assets/lulu/mascot.png'));
    const { buffer, sourceSize, placements } = createIconBuffer(image, nativeImage);
    fs.writeFileSync(output, buffer, { flag: 'wx' });
    console.log(JSON.stringify({ output, frames: ICON_SIZES, bytes: buffer.length, sourceSize, placements }));
    app.exit(0);
  } catch (error) {
    console.error(error.message);
    app.exit(1);
  }
}
