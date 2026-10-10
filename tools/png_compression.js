// Compress generated runtime images only. Editable source assets are copied by
// the package builder and must never pass through an image encoder.
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PIXELS = 120000000;

function normalizePngQuality(value) {
  if (value === undefined) return 100;
  const quality = typeof value === "number" || typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error("PNG quality must be an integer from 1 through 100 (100 is lossless).");
  }
  return quality;
}

async function compressPng(buffer, value) {
  const quality = normalizePngQuality(value);
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Invalid PNG for compression.");
  }
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (!width || !height || width > 16384 || height > 16384 || width * height > MAX_PIXELS) {
    throw new Error("PNG exceeds the export limit of 16384 px per side or 120 million pixels.");
  }
  let sharp;
  try { sharp = require("sharp"); }
  catch (cause) { throw new Error("PNG compression requires sharp. Run npm install in the Frame Tuner directory.", { cause }); }
  // Retain color profiles without adding EXIF/DPI metadata to Canvas output.
  const image = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: "warning" }).keepIccProfile();
  const metadata = await image.metadata();
  // Canvas exports are 8-bit with no orientation tag. Preserve uncommon input
  // without silently reducing 16-bit precision or removing display orientation.
  if (buffer[24] === 16 || metadata.orientation > 1) {
    await image.clone().stats(); // Validate pixel data too, not just the header.
    return buffer;
  }
  // `quality: 100` with a palette is still a quantization operation. The default
  // uses full color instead, preserving every channel, including hidden RGB.
  const lossless = await image.clone().png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer();
  let best = lossless.length < buffer.length ? lossless : buffer;
  if (quality < 100) {
    const reduced = await image.clone().png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, quality, effort: 7 }).toBuffer();
    // Do not lose colors unless doing so saves bytes over both the original and
    // the lossless candidate (flat-color sprites often compress best losslessly).
    if (reduced.length < best.length) best = reduced;
  }
  return best;
}

async function compressRuntimePngs(files, imagePaths, value) {
  const quality = normalizePngQuality(value);
  const report = { quality, files: 0, optimizedFiles: 0, inputBytes: 0, outputBytes: 0 };
  for (const name of new Set(imagePaths)) {
    // Allowlist frame images rather than walking the package's PNG files. The
    // explicit source guard also protects callers passing an overly broad list.
    if (/^(?:source|frame-tuner-source)[/\\]/i.test(name) || !/\.png$/i.test(name)) continue;
    const original = files.get(name);
    if (!Buffer.isBuffer(original)) throw new Error(`Missing runtime PNG: ${name}`);
    let compressed;
    try { compressed = await compressPng(original, quality); }
    catch (cause) { throw new Error(`Could not compress ${name}: ${cause.message}`, { cause }); }
    files.set(name, compressed);
    report.files += 1;
    report.optimizedFiles += Number(compressed.length < original.length);
    report.inputBytes += original.length;
    report.outputBytes += compressed.length;
  }
  return report;
}

module.exports = { normalizePngQuality, compressPng, compressRuntimePngs };
