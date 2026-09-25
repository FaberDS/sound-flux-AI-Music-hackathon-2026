const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
export const motionInputs = [
  ['mouth', 'Mouth opening', 'Face & head', 'filter'],
  ['nodUp', 'Tilt up', 'Face & head', 'pitch'],
  ['nodDown', 'Tilt forward / down', 'Face & head', 'off'],
  ['tiltLeft', 'Tilt left', 'Face & head', 'panLeft'],
  ['tiltRight', 'Tilt right', 'Face & head', 'panRight'],
  ...['Left', 'Right'].flatMap(side => [
    [`${side}Lift`, 'Lift hand', `${side} hand`, 'off'],
    [`${side}MoveLeft`, 'Move left', `${side} hand`, 'off'],
    [`${side}MoveRight`, 'Move right', `${side} hand`, 'off'],
    ...['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].map((finger, index) =>
      [`${side}${finger}`, `${finger} bend`, `${side} hand`, side === 'Right' ? ['kick', 'bell', 'snare', 'echo', 'hat'][index] : 'off']),
  ]),
];
const accents = { kick: 'Kick', snare: 'Snare', hat: 'Hi-hat', bell: 'Bell', pluck: 'Pluck' };
const controls = { next: 'Next phrase', pause: 'Play / pause loop' };
const effects = { filter: 'Wah / filter', echo: 'Echo', pitch: 'Pitch lift', panLeft: 'Pan left', panRight: 'Pan right', volume: 'Volume swell' };

export function motionSignals(frame, baseline, aspect = 4 / 3, handBaseline = {}) {
  const values = Object.fromEntries(motionInputs.map(([id]) => [id, null]));
  const valid = point => point && [point.x, point.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    && (point.z === undefined || Number.isFinite(point.z));
  const [left, right, nose] = [33, 263, 1].map(index => frame.face[index]);
  let head = null;
  if (frame.face.length && Number.isFinite(frame.expressions.jawOpen)) values.mouth = clamp(frame.expressions.jawOpen);
  if ([left, right, nose].every(valid)) {
    const dx = (right.x - left.x) * aspect, dy = right.y - left.y;
    const distance = dx * dx + dy * dy;
    if (distance > 0.0001) {
      const nx = (nose.x - (left.x + right.x) / 2) * aspect, ny = nose.y - (left.y + right.y) / 2;
      head = { nod: (-nx * dy + ny * dx) / distance, tilt: Math.atan2(dy, dx) };
      const neutral = baseline || head;
      values.nodUp = clamp((neutral.nod - head.nod - 0.02) / 0.12);
      values.nodDown = clamp((head.nod - neutral.nod - 0.02) / 0.12);
      values.tiltLeft = clamp((head.tilt - neutral.tilt - 0.03) / 0.28);
      values.tiltRight = clamp((neutral.tilt - head.tilt - 0.03) / 0.28);
    }
  }
  const handPositions = {};
  for (const { side, points } of frame.hands) {
    if (!['Left', 'Right'].includes(side)) continue;
    if ([points[0], points[5], points[17]].every(valid)) {
      const wrist = points[0];
      const span = Math.hypot((points[5].x - points[17].x) * aspect, points[5].y - points[17].y);
      if (span > 0.01) {
        handPositions[side] = { x: wrist.x, y: wrist.y, range: Math.max(0.12, span * 2) };
        const neutral = handBaseline[side] || handPositions[side];
        // ponytail: camera-space displacement; use torso-relative coordinates if walking must be ignored.
        const x = (wrist.x - neutral.x) * aspect / neutral.range;
        const lift = (neutral.y - wrist.y) / neutral.range;
        values[`${side}Lift`] = clamp((lift - 0.08) / 0.92);
        values[`${side}MoveLeft`] = clamp((x - 0.08) / 0.92); // Mirrored preview.
        values[`${side}MoveRight`] = clamp((-x - 0.08) / 0.92);
      }
    }
    for (const [index, finger] of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].entries()) {
      const joints = points.slice(index * 4 + 1, index * 4 + 5);
      if (joints.length !== 4 || !joints.every(valid)) continue;
      const bend = (a, b, c) => {
        const vector = point => [(point.x - b.x) * aspect, point.y - b.y, ((point.z ?? 0) - (b.z ?? 0)) * aspect];
        const u = vector(a), v = vector(c), length = Math.hypot(...u) * Math.hypot(...v);
        if (length < 0.000001) return null;
        return clamp((1 + u.reduce((sum, value, axis) => sum + value * v[axis], 0) / length) / 1.4);
      };
      // ponytail: joint-angle flexion is a demo heuristic; use per-finger calibration for limited mobility.
      const bends = [bend(...joints.slice(0, 3)), bend(...joints.slice(1, 4))];
      if (bends.every(value => value !== null)) values[`${side}${finger}`] = (bends[0] + bends[1]) / 2;
    }
  }
  return { head, values, handPositions };
}

// A gesture must first relax, then cross the upper threshold. Reacquisition cannot fire a held pose.
export function motionTrigger(value, armed = false) {
  if (value === null) return { armed: false, fire: false };
  if (value < 0.3) return { armed: true, fire: false };
  if (value >= 0.65 && armed) return { armed: false, fire: true };
  return { armed, fire: false };
}

export function initMotionAudio(root) {
  const $ = selector => root.querySelector(selector);
  const button = $('#motion-sound');
  const status = $('#motion-sound-status');
  const volume = $('#motion-volume');
  const sensitivity = $('#motion-sensitivity');
  const mappings = $('#motion-mappings');
  const optionList = options => Object.entries(options).map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
  for (const group of ['Face & head', 'Left hand', 'Right hand']) {
    const fieldset = document.createElement('fieldset');
    fieldset.innerHTML = `<legend>${group}</legend>` + motionInputs.filter(input => input[2] === group).map(([id, label]) => `
      <div class="motion-mapping" data-motion-input="${id}">
        <label for="motion-map-${id}">${label}</label><span class="motion-input-state">Not in view</span>
        <select id="motion-map-${id}" aria-label="Effect for ${group === 'Face & head' ? label : `${group.split(' ')[0]} ${label.toLowerCase()}`}">
          <option value="off">Off</option><optgroup label="Play an accent">${optionList(accents)}</optgroup><optgroup label="Shape the sound">${optionList(effects)}</optgroup><optgroup label="Music controls">${optionList(controls)}</optgroup>
        </select><meter min="0" max="1" value="0" aria-label="${group} · ${label} movement"></meter>
      </div>`).join('');
    mappings.append(fieldset);
    const readouts = $(`[data-motion-readouts="${group}"]`);
    readouts.innerHTML = motionInputs.filter(input => input[2] === group).map(([id, label]) => `
      <div class="motion-readout" data-motion-value="${id}"><span>${label}</span><output aria-live="off">—</output>
        <meter min="0" max="1" value="0" aria-label="${group} · ${label} live value"></meter><small></small></div>`).join('');
  }
  const rows = motionInputs.map(([id, label, group, preset]) => {
    const row = $(`[data-motion-input="${id}"]`), select = row.querySelector('select');
    select.value = preset;
    const result = { id, label: `${group === 'Face & head' ? '' : group.split(' ')[0] + ' '}${label}`, row, select, meter: row.querySelector('meter'), state: row.querySelector('.motion-input-state'), readout: $(`[data-motion-value="${id}"]`), armed: false, firedUntil: 0 };
    select.onchange = () => { result.armed = false; result.firedUntil = 0; update(lastFrame); };
    return result;
  });
  let audio = null, baseline = null, handBaseline = {};
  let lastFrame = { face: [], hands: [], expressions: {} }, aspect = 4 / 3;

  function stop() {
    const old = audio;
    audio = null;
    if (old) {
      clearInterval(old.timer);
      old.master.gain.value = 0;
      old.master.disconnect();
      for (const voice of old.voices) voice.stop();
      void old.context.close().catch(() => {});
    }
    rows.forEach(row => { row.armed = false; row.firedUntil = 0; });
    button.textContent = 'Start sound';
    button.setAttribute('aria-pressed', 'false');
    status.textContent = 'Sound is off. Start sound to hear the demo loop.';
  }

  async function start() {
    let context, sound;
    try {
      context = new AudioContext();
      const filter = context.createBiquadFilter(), pan = context.createStereoPanner();
      const delay = context.createDelay(1), feedback = context.createGain(), wet = context.createGain();
      const master = context.createGain(), compressor = context.createDynamicsCompressor();
      filter.type = 'lowpass'; filter.frequency.value = 4500; filter.Q.value = 1.5;
      delay.delayTime.value = 0.3; feedback.gain.value = 0.3; wet.gain.value = 0;
      master.gain.value = Number(volume.value) * 0.4;
      compressor.threshold.value = -12; compressor.ratio.value = 4;
      filter.connect(pan).connect(compressor);
      filter.connect(delay).connect(wet).connect(pan);
      delay.connect(feedback).connect(delay);
      compressor.connect(master).connect(context.destination);
      sound = { context, filter, pan, wet, master, voices: new Set(), pitch: 0, timer: 0, step: 0, phrase: 0, playing: true };
      audio = sound;
      rows.forEach(row => { row.armed = false; });
      button.textContent = 'Stop sound';
      button.setAttribute('aria-pressed', 'true');
      await context.resume();
      if (audio !== sound) return;
      const noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.3), context.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      sound.note = (effect, midi = 72) => {
        // ponytail: cap at 24 voices; add voice stealing if dense chords need it.
        if (audio !== sound || sound.voices.size >= 24) return;
        const now = context.currentTime, isNoise = effect === 'snare' || effect === 'hat';
        const source = isNoise ? context.createBufferSource() : context.createOscillator();
        const envelope = context.createGain(), tone = context.createBiquadFilter();
        const duration = effect === 'hat' ? 0.07 : effect === 'bell' ? 1.1 : 0.28;
        if (isNoise) {
          source.buffer = noise;
          tone.type = 'highpass'; tone.frequency.value = effect === 'hat' ? 7000 : 1200;
        } else {
          source.type = effect === 'pluck' ? 'triangle' : 'sine';
          source.frequency.setValueAtTime(effect === 'kick' ? 145 : 440 * 2 ** ((midi - 69) / 12), now);
          if (effect === 'kick') source.frequency.exponentialRampToValueAtTime(45, now + 0.22);
          tone.frequency.value = 18000;
          source.detune.value = sound.pitch;
        }
        envelope.gain.setValueAtTime(0, now);
        envelope.gain.linearRampToValueAtTime(effect === 'kick' ? 0.55 : 0.2, now + 0.008);
        envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
        source.connect(tone).connect(envelope).connect(filter);
        sound.voices.add(source);
        source.onended = () => { sound.voices.delete(source); source.disconnect(); tone.disconnect(); envelope.disconnect(); };
        source.start(now); source.stop(now + duration + 0.01);
      };
      const phrases = [[57, 60, 64, 67, 69, 67, 64, 60], [57, 64, 67, 71, 69, 64, 60, 64], [60, 64, 69, 72, 71, 67, 64, 60]];
      const play = () => { if (sound.playing) sound.note('pluck', phrases[sound.phrase][sound.step++ % 8]); };
      play();
      // ponytail: a 300 ms demo sequencer; use audio-clock scheduling for performance or recording.
      sound.timer = setInterval(play, 300);
      status.textContent = 'Demo loop playing. Relax, then move to play your mappings.';
    } catch (reason) {
      if (sound && audio !== sound) return;
      stop();
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      status.textContent = `Sound could not start: ${reason.message}`;
    }
  }

  function update(frame, imageAspect = aspect) {
    lastFrame = frame;
    aspect = imageAspect;
    const result = motionSignals(frame, baseline, aspect, handBaseline);
    if (!result.head) baseline = null;
    else baseline ||= result.head;
    for (const side of ['Left', 'Right']) {
      if (!result.handPositions[side]) delete handBaseline[side];
      else handBaseline[side] ||= result.handPositions[side];
    }
    const amounts = Object.fromEntries(Object.keys(effects).map(key => [key, 0]));
    for (const row of rows) {
      const raw = result.values[row.id], value = raw === null ? null : clamp(raw * Number(sensitivity.value));
      if (value === null) row.firedUntil = 0;
      const trigger = motionTrigger(value, row.armed);
      row.armed = trigger.armed;
      row.meter.value = value ?? 0;
      row.state.textContent = value === null ? 'Not in view' : value >= 0.65 ? 'Active' : 'Ready';
      row.row.classList.toggle('is-active', value >= 0.65 && row.select.value !== 'off');
      if (row.select.value in effects) amounts[row.select.value] = Math.max(amounts[row.select.value], value ?? 0);
      const effect = row.select.value;
      if (trigger.fire && audio?.note && (effect in accents || effect in controls)) {
        if (effect in accents) audio.note(effect);
        if (effect === 'next') { audio.phrase = (audio.phrase + 1) % 3; audio.step = 0; }
        if (effect === 'pause') audio.playing = !audio.playing;
        row.firedUntil = performance.now() + 900;
        status.textContent = `${row.label} → ${accents[effect] || controls[effect]}${effect === 'next' ? ` ${audio.phrase + 1}` : effect === 'pause' ? (audio.playing ? ' · Playing' : ' · Paused') : ''}`;
      }
      const fired = value !== null && audio && row.firedUntil > performance.now();
      const shaping = value !== null && value > 0.02 && audio && effect in effects;
      row.readout.querySelector('output').textContent = value === null ? '—' : `${Math.round(value * 100)}%`;
      row.readout.querySelector('meter').value = value ?? 0;
      row.readout.querySelector('small').textContent = effect === 'off' ? 'No effect assigned' :
        `${accents[effect] || effects[effect] || controls[effect]} · ${value === null ? 'Not in view' : !audio ? 'Sound off' : fired ? 'Triggered!' : shaping ? 'Applying' : effect in effects ? 'At rest' : row.armed ? 'Ready' : 'Return to rest'}`;
      row.readout.classList.toggle('is-active', Boolean(fired || shaping));
    }
    if (audio) {
      const now = audio.context.currentTime;
      const filterTracked = rows.some(row => row.select.value === 'filter' && result.values[row.id] !== null);
      audio.filter.frequency.setTargetAtTime(filterTracked ? 300 * 20 ** amounts.filter : 4500, now, 0.07);
      audio.wet.gain.setTargetAtTime(amounts.echo * 0.65, now, 0.08);
      audio.pan.pan.setTargetAtTime(amounts.panRight - amounts.panLeft, now, 0.08);
      audio.pitch = amounts.pitch * 700;
      const volumeTracked = rows.some(row => row.select.value === 'volume' && result.values[row.id] !== null);
      audio.master.gain.setTargetAtTime(Number(volume.value) * 0.4 * (volumeTracked ? 0.25 + 0.75 * amounts.volume : 1), now, 0.08);
      for (const voice of audio.voices) voice.detune.setTargetAtTime(audio.pitch, now, 0.08);
    }
  }
  $('#motion-center').onclick = () => {
    baseline = null;
    handBaseline = {};
    rows.forEach(row => { row.armed = false; row.firedUntil = 0; });
    update(lastFrame);
    status.textContent = baseline || Object.keys(handBaseline).length ? 'Pose centered. Move your head and hands from this position.' : 'Bring your face and hands into view to center your pose.';
  };
  sensitivity.oninput = () => { $('#motion-sensitivity-value').textContent = `${Number(sensitivity.value).toFixed(1)}×`; update(lastFrame); };
  volume.oninput = () => {
    $('#motion-volume-value').textContent = `${Math.round(Number(volume.value) * 100)}%`;
    update(lastFrame);
  };
  button.onclick = () => { if (audio) { stop(); update(lastFrame); } else void start(); };
  update(lastFrame);
  return { update, stop() { stop(); baseline = null; handBaseline = {}; update({ face: [], hands: [], expressions: {} }); } };
}
