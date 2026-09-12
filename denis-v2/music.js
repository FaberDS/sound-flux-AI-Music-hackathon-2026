export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function rms(samples) {
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
}

export function nearestNote(frequency, scale = [60, 62, 64, 67, 69, 72]) {
  if (!Number.isFinite(frequency) || frequency < 70 || frequency > 1000) return null;
  const midi = 69 + 12 * Math.log2(frequency / 440);
  return scale.reduce((closest, note) => Math.abs(note - midi) < Math.abs(closest - midi) ? note : closest);
}

export function frequencyFromNote(note) {
  return 440 * 2 ** ((note - 69) / 12);
}
