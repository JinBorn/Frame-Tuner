"use strict";

const zlib = require("node:zlib");

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, bytes) {
  const tag = Buffer.from(type);
  const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length);
  tag.copy(result, 4); bytes.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([tag, bytes])), bytes.length + 8);
  return result;
}

function samplePng(pose, width = 192, height = 176) {
  const rows = Buffer.alloc(height * (width * 4 + 1));
  const colors = [[84, 209, 204], [145, 127, 239], [245, 166, 83], [255, 104, 127]];
  const color = colors[pose];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const body = x >= 63 && x < 108 && y >= 65 && y < 131;
      const head = Math.hypot(x - 85, y - 44) < 22;
      const feet = y >= 128 && y < 158 && ((x >= 61 + pose * 3 && x < 77 + pose * 3) || (x >= 94 && x < 110));
      const arm = x >= 103 && x < 125 + pose * 13 && y >= 73 - pose * 4 && y < 88 + pose * 4;
      const eye = x >= 92 && x < 100 && y >= 40 && y < 48;
      if (!body && !head && !feet && !arm) continue;
      const index = y * (width * 4 + 1) + 1 + x * 4;
      rows[index] = eye ? 14 : color[0];
      rows[index + 1] = eye ? 20 : color[1];
      rows[index + 2] = eye ? 32 : color[2];
      rows[index + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", zlib.deflateSync(rows)), pngChunk("IEND", Buffer.alloc(0))]);
}

function sampleWav() {
  const rate = 22050, samples = 2205;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) wav.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 660 / rate) * (1 - index / samples) * 7000), 44 + index * 2);
  return wav;
}

function createSamplePackage() {
  const files = new Map();
  const durations = [120, 0, 310, 80];
  const frames = durations.map((durationMs, index) => {
    const file = `frames/demo_${index}.png`;
    files.set(file, samplePng(index));
    return {
      sourceFrame: index, durationMs, disabled: index === 1, path: file, width: 192, height: 176,
      origin: { x: 85, y: 158 },
      boxes: [
        { kind: "hurtbox", enabled: true, position: { x: 0, y: -67 }, size: { x: 48, y: 130 }, rotation: 0 },
        { kind: "hitbox", enabled: index >= 2, position: { x: 54 + index * 4, y: -78 }, size: { x: 60, y: 22 }, rotation: index === 3 ? -12 : 0 },
      ],
      audio: index === 2 ? [{ path: "audio/tick.wav", volume: 0.35 }] : [],
    };
  });
  files.set("audio/tick.wav", sampleWav());
  return {
    pkg: {
      schema: "frame-tuner-package-v1", version: 1, projectId: "demo", bakedVisual: true,
      coordinateSystem: { unit: "pixel", x: "right", y: "down" },
      animations: [{ id: "demo/punch", profileId: "demo", name: "Punch · 120 / 310 / 80 ms", loop: true, sourceFacesLeft: false, frames }],
    },
    files,
  };
}

module.exports = { createSamplePackage };
