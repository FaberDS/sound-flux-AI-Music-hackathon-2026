// Small, deterministic PCM fixtures. No model, audio program, or downloads needed.
const rate = 16000
export function makeWav(seconds, seed = 0, effects = [], speech = false) {
  const count = Math.round(seconds * rate)
  const samples = new Float32Array(count)
  const notes = [60, 64, 67, 72, 69, 67, 64, 62]
  for (let i = 0; i < count; i++) {
    const time = i / rate
    const beat = time % 0.5
    const midi = notes[(Math.floor(time / 0.5) + Math.abs(seed)) % notes.length]
    const frequency = 440 * 2 ** ((midi - 69) / 12)
    const envelope = Math.min(beat / 0.012, 1) * Math.exp(-beat * 6)
    const fade = Math.min(1, (seconds - time) / 0.06)
    samples[i] = (speech ? 0.055 : 0.19) * Math.sin(2 * Math.PI * frequency * time) * envelope * fade
  }
  for (const effect of effects) {
    const length = effect.effect === 'drum' ? 0.4 : 1.2
    const midi = (effect.pitch === 'high' ? 72 : 60) + (effect.effect === 'bells' ? 12 : 0)
    const frequency = 440 * 2 ** ((midi - 69) / 12)
    for (let i = 0; i < Math.round(length * rate); i++) {
      const t = i / rate
      const phase = 2 * Math.PI * (effect.effect === 'drum' ? 145 * t - 125 * t * t : frequency * t)
      let wave = Math.sin(phase)
      if (effect.effect === 'guitar') wave = 2 / Math.PI * Math.asin(wave)
      if (effect.effect === 'bells') wave += 0.18 * Math.sin(phase * 2.76)
      samples[(Math.round(effect.at * rate) + i) % count] += wave * Math.min(t / 0.012, 1) * Math.exp(-7 * t / length) * (0.12 + 0.2 * effect.intensity) * effect.volume
    }
  }
  const wav = Buffer.alloc(44 + count * 2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36)
  wav.writeUInt32LE(count * 2, 40)
  for (let i = 0; i < count; i++) wav.writeInt16LE(Math.round(Math.max(-0.99, Math.min(0.99, samples[i])) * 32767), 44 + i * 2)
  return wav
}
