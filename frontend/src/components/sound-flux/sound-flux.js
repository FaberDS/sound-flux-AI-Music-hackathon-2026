import {getFrame, frameSvg, states, defaultLabels, DEFAULT_WOBBLE, clamp} from './motion.js';
import {brandSvg} from './brand.js';

/** Mount a framework-independent Sound Flux voice indicator. */
export function createSoundFlux(container, options = {}) {
  if (!container?.ownerDocument || typeof container.appendChild !== 'function') throw new TypeError('A DOM container is required');
  const doc = container.ownerDocument, win = doc.defaultView;
  if (!win) throw new Error('Sound Flux requires a browser window');
  let state = options.state ?? 'idle';
  if (!states.includes(state)) throw new RangeError(`Unknown state: ${state}`);
  let wobble = clamp(options.wobble ?? DEFAULT_WOBBLE, 'wobble');
  let targetLevel = clamp(options.level ?? 0, 'level'), level = targetLevel;
  let paused = Boolean(options.paused), destroyed = false;
  const size = clamp(options.size ?? 320, 'size', 32, 2048);
  const labels = {...defaultLabels, ...options.labels};
  const media = win.matchMedia('(prefers-reduced-motion: reduce)');
  const weights = {idle: 0, listening: 0, thinking: 0, speaking: 0};
  weights[state] = 1;
  let time = 0, lastTime = null, request = 0;

  const host = doc.createElement('div');
  host.style.cssText = `display:block;width:${size}px;max-width:100%;color:var(--sf-brown,#693D2B)`;
  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = `<style>
    *{box-sizing:border-box}.sf{width:100%;text-align:center;color:var(--sf-brown,#693D2B);background:transparent}
    .graphic{width:100%;display:block}.graphic svg{display:block;width:100%;height:auto;overflow:visible}
    .brand{width:100%;margin:2px auto 0}.brand svg{display:block;width:100%;height:auto}
    .status{margin:4px 0 16px;font:400 clamp(14px,1em,24px)/1.35 Georgia,'Times New Roman',serif;color:var(--sf-brown,#693D2B)}
    [hidden]{display:none!important}
  </style><div class="sf"><div class="graphic" role="img"></div><div class="brand" aria-label="Sound Flux" role="img"></div><div class="status" role="status" aria-live="polite" aria-atomic="true"></div></div>`;
  const graphic = root.querySelector('.graphic');
  graphic.innerHTML = frameSvg(getFrame({wobble, level, weights, reduced: media.matches}));
  const paths = [...graphic.querySelectorAll('path')];
  // Color hooks remain scoped to this instance.
  paths[0].setAttribute('fill', 'var(--sf-yellow,#FFDE5A)');
  paths.forEach((p, i) => p.setAttribute('stroke', i === 3 ? 'var(--sf-brown,#693D2B)' : 'var(--sf-orange,#FE751F)'));
  const brand = root.querySelector('.brand');
  brand.innerHTML = brandSvg;
  const status = root.querySelector('.status');
  status.style.fontSize = `${Math.max(14, Math.min(30, size * .09375))}px`;
  brand.hidden = options.showBrand === false;
  status.hidden = options.showStatus === false;
  function label() {
    status.textContent = String(labels[state]);
    graphic.setAttribute('aria-label', `Sound Flux: ${labels[state]}`);
  }
  label();container.appendChild(host);

  function paint() {
    const f = getFrame({time, wobble, level, weights, reduced: media.matches});
    paths[0].setAttribute('d', f.main);paths[0].setAttribute('stroke-opacity', String(f.mainOpacity));
    [...f.incoming, ...f.arcs, f.outer].forEach((p, i) => {
      paths[i + 1].setAttribute('d', p.d);paths[i + 1].setAttribute('opacity', String(p.opacity));
    });
  }
  function canRun() { return !destroyed && !paused && !doc.hidden && !media.matches; }
  function schedule() {
    if (canRun() && !request) request = win.requestAnimationFrame(tick);
  }
  function tick(now) {
    request = 0;
    if (!canRun()) { lastTime = null;return; }
    const dt = lastTime === null ? 0 : Math.min(.1, (now - lastTime) / 1000);
    lastTime = now;time += dt;
    const stateBlend = 1 - Math.exp(-dt / .18);
    const levelBlend = 1 - Math.exp(-dt / (targetLevel > level ? .055 : .16));
    level += (targetLevel - level) * levelBlend;
    for (const key of states) weights[key] += ((key === state ? 1 : 0) - weights[key]) * stateBlend;
    paint();schedule();
  }
  function suspendOrResume() {
    if (request) win.cancelAnimationFrame(request);
    request = 0;lastTime = null;
    if (media.matches) { for (const key of states) weights[key] = key === state ? 1 : 0; }
    paint();schedule();
  }
  doc.addEventListener('visibilitychange', suspendOrResume);
  media.addEventListener('change', suspendOrResume);
  paint();schedule();

  function assertAlive() { if (destroyed) throw new Error('Sound Flux has been destroyed'); }
  return {
    element: host,
    setState(next) {
      assertAlive();if (!states.includes(next)) throw new RangeError(`Unknown state: ${next}`);
      state = next;label();
      if (!canRun()) { for (const key of states) weights[key] = key === state ? 1 : 0; }
      paint();schedule();
    },
    setLevel(value) { assertAlive();targetLevel = clamp(value, 'level'); },
    setWobble(value) { assertAlive();wobble = clamp(value, 'wobble');paint(); },
    setPaused(value) { assertAlive();paused = Boolean(value);suspendOrResume(); },
    setTextVisibility({showBrand = true, showStatus = true} = {}) { assertAlive();brand.hidden = !showBrand;status.hidden = !showStatus; },
    destroy() {
      if (destroyed) return;destroyed = true;
      if (request) win.cancelAnimationFrame(request);
      doc.removeEventListener('visibilitychange', suspendOrResume);
      media.removeEventListener('change', suspendOrResume);
      host.remove();
    }
  };
}
