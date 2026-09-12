export const states = Object.freeze(['idle', 'listening', 'thinking', 'speaking']);
export const defaultLabels = Object.freeze({idle: 'Bereit', listening: 'Ich höre zu', thinking: 'Einen Moment', speaking: 'Ich spreche'});
export const palette = Object.freeze({brown: '#693D2B', yellow: '#FFDE5A', orange: '#FE751F'});
export const DEFAULT_WOBBLE = 0.625;
const TAU = 2 * Math.PI;

export function clamp(value, name, min = 0, max = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  return Math.min(max, Math.max(min, value));
}

function path(points, closed = true) {
  const n = points.length;
  const f = value => value.toFixed(3);
  let d = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let j = 0; j < n - (closed ? 0 : 1); j++) {
    const a = points[closed ? (j - 1 + n) % n : Math.max(0, j - 1)];
    const b = points[j], c = points[(j + 1) % n];
    const e = points[closed ? (j + 2) % n : Math.min(n - 1, j + 2)];
    d += `C${f(b[0] + (c[0] - a[0]) / 6)},${f(b[1] + (c[1] - a[1]) / 6)} ${f(c[0] - (e[0] - b[0]) / 6)},${f(c[1] - (e[1] - b[1]) / 6)} ${f(c[0])},${f(c[1])}`;
  }
  return d + (closed ? 'Z' : '');
}

function blob(phase, radius, amount) {
  return Array.from({length: 80}, (_, j) => {
    const angle = j / 80 * TAU;
    const r = radius + amount * (8 * Math.sin(3 * angle + phase) + 5.5 * Math.sin(2 * angle - phase) + 3 * Math.cos(angle + 2 * phase));
    return [r * Math.cos(angle), r * Math.sin(angle)];
  });
}

/** Pure geometry shared by the live component and preview renderer. */
export function getFrame({time = 0, wobble = DEFAULT_WOBBLE, level = 0, weights = {}, reduced = false} = {}) {
  const t = reduced ? 0 : ((time % 6) + 6) % 6;
  const phase = TAU * t / 6;
  const listening = weights.listening || 0, thinking = weights.thinking || 0, speaking = weights.speaking || 0;
  const energy = reduced ? 0 : level * speaking;
  const radius = 110 * (1 + (reduced ? 0 : .017 * Math.sin(phase))) + 3 * energy;
  const amount = wobble + energy * .2;
  const points = blob(phase, radius, amount);
  const main = path(points);
  const incoming = [0, 1].map(j => {
    const u = reduced ? .25 + j * .5 : (t / 3 + j / 2) % 1;
    return {d: path(blob(phase, 145 - u * 35, wobble)), opacity: listening * .4 * Math.sin(Math.PI * u)};
  });
  // Fractional resampling makes the orbit smooth at any refresh rate.
  const start = t / 3 * points.length;
  const arcs = [0, 1].map(k => {
    const segment = Array.from({length: 21}, (_, j) => {
      const pos = (start + k * points.length / 2 + j) % points.length;
      const i = Math.floor(pos), f = pos - i;
      const a = points[i], b = points[(i + 1) % points.length];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    });
    return {d: path(segment, false), opacity: thinking * (k === 0 ? .85 : .9)};
  });
  return {
    main, mainOpacity: .58 + .12 * Math.min(1, listening + thinking + speaking),
    incoming, arcs,
    outer: {d: path(blob(phase, 121 + energy * 4, wobble + .05 + energy * .2)), opacity: speaking * (.2 + (reduced ? 0 : level) * .2)}
  };
}

/** Static SVG frame for testing/export; no scripts, fonts or network requests. */
export function frameSvg(frame) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><g transform="translate(160 160)" stroke-linecap="round"><path d="${frame.main}" fill="${palette.yellow}" fill-opacity=".14" stroke="${palette.orange}" stroke-width="2.1" stroke-opacity="${frame.mainOpacity}"/>${frame.incoming.map(p => `<path d="${p.d}" fill="none" stroke="${palette.orange}" stroke-width="1.35" opacity="${p.opacity}"/>`).join('')}${frame.arcs.map((p, i) => `<path d="${p.d}" fill="none" stroke="${i ? palette.orange : palette.brown}" stroke-width="3.2" opacity="${p.opacity}"/>`).join('')}<path d="${frame.outer.d}" fill="none" stroke="${palette.orange}" stroke-width="1.5" opacity="${frame.outer.opacity}"/></g></svg>`;
}
