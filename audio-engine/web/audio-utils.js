export function joinSamples(chunks, maxLength) {
  const length = Math.min(chunks.reduce((total, chunk) => total + chunk.length, 0), maxLength);
  const result = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    const count = Math.min(chunk.length, length - offset);
    result.set(chunk.subarray(0, count), offset);
    offset += count;
    if (offset === length) break;
  }
  return result;
}

export function mixToMono(channels) {
  const samples = new Float32Array(channels[0].length);
  for (const channel of channels) {
    for (let index = 0; index < samples.length; index++) samples[index] += channel[index] / channels.length;
  }
  return samples;
}

export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const value = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  });
  return buffer;
}

export function formatTime(seconds) {
  return `00:${String(Math.min(30, Math.max(0, Math.floor(seconds)))).padStart(2, "0")}`;
}
