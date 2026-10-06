const path = require('path');

const MP3_MIMES = new Set(['audio/mpeg','audio/mp3','application/octet-stream']);
const AAC_MIMES = new Set(['audio/aac','audio/x-aac','application/octet-stream']);

function mp3Duration(buffer) {
  let offset = 0;
  if (buffer.length >= 10 && buffer.toString('ascii',0,3) === 'ID3') {
    const size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
    offset = 10 + size + ((buffer[5] & 0x10) ? 10 : 0);
  }
  const bitrateV1L3 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
  const bitrateV2L3 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0];
  const sampleBase = [44100,48000,32000,0];
  let samples = 0, sampleRate = 0, frames = 0, i = offset;
  while (i + 4 <= buffer.length) {
    if (buffer[i] !== 0xff || (buffer[i+1] & 0xe0) !== 0xe0) { i++; continue; }
    const h = buffer.readUInt32BE(i);
    const versionBits = (h >>> 19) & 3;
    const layerBits = (h >>> 17) & 3;
    const bitrateIndex = (h >>> 12) & 15;
    const sampleIndex = (h >>> 10) & 3;
    const padding = (h >>> 9) & 1;
    if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) { i++; continue; }
    const version = versionBits === 3 ? 1 : (versionBits === 2 ? 2 : 2.5);
    const bitrate = (version === 1 ? bitrateV1L3 : bitrateV2L3)[bitrateIndex];
    let sr = sampleBase[sampleIndex];
    if (version === 2) sr /= 2;
    else if (version === 2.5) sr /= 4;
    const frameLength = Math.floor((version === 1 ? 144000 : 72000) * bitrate / sr) + padding;
    if (!frameLength || i + frameLength > buffer.length) { i++; continue; }
    if (!sampleRate) sampleRate = sr;
    if (sr !== sampleRate) { i++; continue; }
    samples += version === 1 ? 1152 : 576;
    frames++;
    i += frameLength;
  }
  if (!frames || !sampleRate) return 0;
  return samples / sampleRate;
}

function aacDuration(buffer) {
  const sampleRates = [96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350];
  let i = 0, seconds = 0, frames = 0;
  while (i + 7 <= buffer.length) {
    if (buffer[i] !== 0xff || (buffer[i+1] & 0xf6) !== 0xf0) { i++; continue; }
    const sampleIndex = (buffer[i+2] & 0x3c) >> 2;
    const sampleRate = sampleRates[sampleIndex];
    if (!sampleRate) { i++; continue; }
    const frameLength = ((buffer[i+3] & 0x03) << 11) | (buffer[i+4] << 3) | ((buffer[i+5] & 0xe0) >> 5);
    if (frameLength < 7 || i + frameLength > buffer.length) { i++; continue; }
    const rawBlocks = (buffer[i+6] & 0x03) + 1;
    seconds += (1024 * rawBlocks) / sampleRate;
    frames++;
    i += frameLength;
  }
  return frames ? seconds : 0;
}

function inspectAudio(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw new Error('Bạn cần chọn tệp âm thanh.');
  const ext = path.extname(file.originalname || '').toLowerCase();
  let seconds = 0;
  if (ext === '.mp3' && MP3_MIMES.has(file.mimetype)) seconds = mp3Duration(file.buffer);
  else if (ext === '.aac' && AAC_MIMES.has(file.mimetype)) seconds = aacDuration(file.buffer);
  else throw new Error('Chỉ nhận file nhạc .mp3 hoặc .aac hợp lệ.');
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Không đọc được thời lượng file nhạc. Hãy kiểm tra lại file .mp3/.aac.');
  return { ext, duration: Math.max(1, Math.round(seconds)) };
}

module.exports = { inspectAudio, mp3Duration, aacDuration };
