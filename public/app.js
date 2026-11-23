const ui = Object.fromEntries(Array.from(document.querySelectorAll('[id]'), el => [el.id, el]));
const canvasContext = ui.canvas.getContext('2d');
const spectrumImage = document.createElement('canvas');
const MAX_BYTES = 25_000_000;
const MAX_SECONDS = 900;
const RATE = 44100;
const PEAK_BLOCK = 256;
const time = seconds => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return [Math.floor(ms / 60000), Math.floor(ms / 1000) % 60]
    .map(part => String(part).padStart(2, '0')).join(':') + '.' + String(ms % 1000).padStart(3, '0');
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

let context;
let buffer;
let channels;
let peaks;
let filename;
let loadId = 0;
let mode = 'wave';
let offset = 0;
let span = 0;
let start = null;
let end = null;
let cursor = 0;
let playback;
let playId = 0;
let drag;
let spectrumWorker;
let spectrumJob = 0;
let spectrumTimer;
let encodeWorker;

function status(message = '', error = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle('error', error);
}

function timeLimit() {
  return Math.floor(buffer.duration * 1000) / 1000;
}

function showFields() {
  ui.start.max = ui.end.max = timeLimit().toFixed(3);
  ui.start.value = start?.toFixed(3) ?? '';
  ui.end.value = end?.toFixed(3) ?? '';
  refreshSelection();
}

function refreshSelection() {
  ui.length.textContent = validSelection() ? time(end - start) : '–';
  updateButtons();
  overlays();
}

function validSelection() {
  return start !== null && end !== null && end > start;
}

function updateButtons() {
  ui.clearStart.disabled = start === null;
  ui.clearEnd.disabled = end === null;
  ui.export.disabled = !!encodeWorker || !validSelection();
  ui.play.textContent = playback ? '■ Anhalten' : '▶ Abspielen';
  ui.export.textContent = encodeWorker ? 'MP3 wird erstellt …' : 'MP3 speichern';
}

function markerTime(value) {
  return clamp(Math.round(value * 1000) / 1000, 0, timeLimit());
}

function setMark(mark, value) {
  if (mark === 'start') start = value;
  else end = value;
}

function setSelection(a, b) {
  start = a === null ? null : markerTime(a);
  end = b === null ? null : markerTime(b);
  showFields();
}

function showMarker(element, value) {
  if (value === null) {
    element.hidden = true;
    return;
  }
  const position = (value - offset) / span;
  element.hidden = position < 0 || position > 1;
  element.style.left = `min(${position * 100}%, calc(100% - 2px))`;
}

function overlays() {
  if (!buffer) return;
  const left = (start - offset) / span;
  const right = (end - offset) / span;
  ui.selection.hidden = !validSelection() || right <= 0 || left >= 1;
  ui.selection.style.left = `${clamp(left, 0, 1) * 100}%`;
  ui.selection.style.right = `${(1 - clamp(right, 0, 1)) * 100}%`;
  showMarker(ui.markStart, start);
  showMarker(ui.markEnd, end);
  const position = (cursor - offset) / span;
  ui.cursor.hidden = position < 0 || position > 1;
  ui.cursor.style.left = `min(${position * 100}%, calc(100% - 2px))`;
  ui.position.textContent = time(cursor);
}

function buildPeaks() {
  const blocks = new Float32Array(Math.ceil(buffer.length / PEAK_BLOCK));
  for (const samples of channels) {
    for (let i = 0; i < samples.length; i++) {
      const index = Math.floor(i / PEAK_BLOCK);
      const amplitude = Math.abs(samples[i]);
      if (amplitude > blocks[index]) blocks[index] = amplitude;
    }
  }
  return blocks;
}

function drawWave(width, height) {
  // Keep quieter passages visible by expanding the lower part of the scale.
  const scale = amplitude => Math.log1p(9 * Math.min(1, amplitude)) / Math.log(10);
  const graphHeight = height * .95;
  canvasContext.fillStyle = '#f7c7e42b';
  for (const level of [.1, .25, .5]) {
    canvasContext.fillRect(0, height - scale(level) * graphHeight, width, 1);
  }
  const gradient = canvasContext.createLinearGradient(0, height, 0, 0);
  gradient.addColorStop(0, '#ff62b5');
  gradient.addColorStop(.62, '#ff8bcc');
  gradient.addColorStop(1, '#ffd3de');
  canvasContext.fillStyle = gradient;
  const stride = span * buffer.sampleRate / width;
  for (let x = 0; x < width; x++) {
    const first = Math.floor(offset * buffer.sampleRate + x * stride);
    const last = Math.min(buffer.length, Math.max(first + 1, Math.floor(first + stride)));
    let peak = 0;
    let sample = first;
    while (sample < last) {
      if (sample % PEAK_BLOCK === 0 && sample + PEAK_BLOCK <= last) {
        peak = Math.max(peak, peaks[sample / PEAK_BLOCK]);
        sample += PEAK_BLOCK;
      } else {
        for (const values of channels) {
          peak = Math.max(peak, Math.abs(values[sample]));
        }
        sample++;
      }
    }
    const bar = Math.max(1, scale(peak) * graphHeight);
    canvasContext.fillRect(x, height - bar, 1, bar);
  }
}

function draw() {
  if (!buffer) return;
  const ratio = Math.min(2, devicePixelRatio || 1);
  const width = Math.max(1, Math.round(ui.canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(ui.canvas.clientHeight * ratio));
  ui.canvas.width = width;
  ui.canvas.height = height;
  if (mode === 'wave') drawWave(width, height);
  else if (spectrumImage.width) canvasContext.drawImage(spectrumImage, 0, 0, width, height);

  const ticks = ui.canvas.clientWidth < 500 ? 4 : 7;
  ui.ruler.replaceChildren();
  canvasContext.fillStyle = '#f7c7e426';
  for (let i = 0; i < ticks; i++) {
    const fraction = i / (ticks - 1);
    const label = document.createElement('span');
    label.textContent = time(offset + span * fraction);
    ui.ruler.append(label);
    canvasContext.fillRect(Math.round(width * fraction), 0, 1, height);
  }
  overlays();
}

function scheduleSpectrum() {
  clearTimeout(spectrumTimer);
  const id = ++spectrumJob;
  spectrumImage.width = 0;
  ui.analysis.hidden = mode !== 'spectrum';
  draw();
  if (mode !== 'spectrum') return;

  spectrumTimer = setTimeout(() => {
    if (!spectrumWorker) {
      spectrumWorker = new Worker('spectrum.js');
      spectrumWorker.onmessage = ({ data }) => {
        if (data.id !== spectrumJob || !buffer) return;
        spectrumImage.width = data.width;
        spectrumImage.height = data.height;
        const image = new ImageData(data.rgba, data.width, data.height);
        spectrumImage.getContext('2d').putImageData(image, 0, 0);
        ui.analysis.hidden = true;
        draw();
      };
      spectrumWorker.onerror = () => {
        spectrumWorker?.terminate();
        spectrumWorker = undefined;
        setMode('wave');
        status('Das Spektrogramm konnte nicht berechnet werden.', true);
      };
      const copies = channels.map(samples => samples.slice());
      spectrumWorker.postMessage({ channels: copies }, copies.map(samples => samples.buffer));
    }
    spectrumWorker.postMessage({
      id, start: offset, duration: span, rate: buffer.sampleRate,
      width: clamp(ui.canvas.clientWidth, 1, 850)
    });
  }, 85);
}

function setMode(next) {
  mode = next;
  ui.wave.setAttribute('aria-pressed', mode === 'wave');
  ui.spectrum.setAttribute('aria-pressed', mode === 'spectrum');
  ui.frequency.hidden = mode !== 'spectrum';
  scheduleSpectrum();
}

function setView(nextOffset, nextSpan = span) {
  const minSpan = Math.min(.1, buffer.duration);
  span = clamp(nextSpan, minSpan, buffer.duration);
  offset = clamp(nextOffset, 0, buffer.duration - span);
  ui.pan.max = buffer.duration - span;
  ui.pan.value = offset;
  ui.pan.disabled = span >= buffer.duration;
  ui.out.disabled = ui.pan.disabled;
  ui.in.disabled = span <= minSpan;
  ui.fit.textContent = `${+(buffer.duration / span).toFixed(1)}×`;
  scheduleSpectrum();
}

function zoom(factor, anchor) {
  const target = clamp(span * factor, Math.min(.1, buffer.duration), buffer.duration);
  const fraction = (anchor - offset) / span;
  setView(anchor - target * fraction, target);
}

function currentPosition() {
  if (!playback) return cursor;
  const { from, to, at, origin } = playback;
  return from + (origin - from + context.currentTime - at) % (to - from);
}

function loopRange() {
  return validSelection() ? { from: start, to: end } : { from: 0, to: buffer.duration };
}

function startLoop({ from, to }, position) {
  const origin = position >= from && position < to ? position : from;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = from;
  source.loopEnd = to;
  source.connect(context.destination);
  const at = context.currentTime;
  source.start(at, origin);
  playback = { source, from, to, origin, at };
  updateButtons();

  function follow() {
    if (playback?.source !== source) return;
    cursor = currentPosition();
    overlays();
    requestAnimationFrame(follow);
  }
  follow();
}

function stopLoop() {
  const { source } = playback;
  playback = undefined;
  source.stop();
  source.disconnect();
}

function pause() {
  playId++;
  if (!playback) return;
  cursor = currentPosition();
  stopLoop();
  overlays();
  updateButtons();
}

function syncLoop(position) {
  if (!playback) return;
  const range = loopRange();
  if (position === undefined && range.from === playback.from && range.to === playback.to) return;
  stopLoop();
  startLoop(range, position ?? range.from);
}

async function play() {
  if (playback) {
    pause();
    return;
  }
  const id = ++playId;
  const audio = buffer;
  try {
    await context.resume();
  } catch {
    if (id === playId) status('Audio konnte im Browser nicht gestartet werden.', true);
    return;
  }
  if (id !== playId || buffer !== audio) return;
  startLoop(loopRange(), cursor);
}

function disposeAudio() {
  pause();
  clearTimeout(spectrumTimer);
  spectrumJob++;
  spectrumWorker?.terminate();
  spectrumWorker = undefined;
  encodeWorker?.terminate();
  encodeWorker = undefined;
  buffer = channels = peaks = drag = undefined;
}

function showEditor(audio, name, detail) {
  disposeAudio();
  buffer = audio;
  channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  peaks = buildPeaks();
  filename = name;
  ui.filename.textContent = name;
  ui.filename.title = name;
  ui.metadata.textContent = [detail, time(buffer.duration), channels.length === 1 ? 'Mono' : 'Stereo'].join(' · ');
  const topHz = Math.min(buffer.sampleRate / 2, 16000);
  ui.frequency.replaceChildren();
  for (let i = 0; i <= 4; i++) {
    const value = topHz * (30 / topHz) ** (i / 4);
    const label = document.createElement('span');
    label.textContent = value >= 1000 ? `${+(value / 1000).toFixed(1)} kHz` : `${Math.round(value)} Hz`;
    ui.frequency.append(label);
  }
  ui.empty.hidden = true;
  ui.editor.hidden = false;
  cursor = 0;
  setSelection(null, null);
  setView(0, buffer.duration);
  setMode('wave');
  status();
}

function audioContext() {
  if (!context) context = new AudioContext({ sampleRate: RATE });
  return context;
}

async function openFile(file) {
  if (!file) return;
  const id = ++loadId;
  if (!/\.mp3$/i.test(file.name) || !file.size) {
    status('Bitte eine MP3-Datei auswählen.', true);
    return;
  }
  if (file.size > MAX_BYTES) {
    status('Die Datei ist größer als 25 MB.', true);
    return;
  }
  status('MP3 wird gelesen …');

  try {
    // Use a fixed sample rate supported by the MP3 encoder on every device.
    const audio = await audioContext().decodeAudioData(await file.arrayBuffer());
    if (id !== loadId) return;
    if (audio.duration > MAX_SECONDS || audio.numberOfChannels > 2 || audio.duration < .001) {
      status('Die MP3 muss zwischen 1 ms und 15 Minuten lang sein und Mono oder Stereo verwenden.', true);
      return;
    }
    showEditor(audio, file.name, `${(file.size / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 2 })} MB`);
  } catch {
    if (id === loadId) status('Diese MP3-Datei konnte nicht gelesen werden.', true);
  }
}

function openDemo() {
  loadId++;
  try {
    const audio = audioContext().createBuffer(1, RATE * 18, RATE);
    const samples = audio.getChannelData(0);
    const notes = [220, 262, 330, 392, 440, 392, 330, 262];
    for (let i = 0; i < samples.length; i++) {
      const t = i / RATE;
      const beat = t / .375;
      const phase = beat % 1;
      const note = notes[Math.floor(beat) % notes.length];
      const envelope = Math.min(1, phase * 22) * (1 - phase) ** 2;
      const section = Math.floor(t / 3);
      const melody = Math.sin(2 * Math.PI * t * note) + .25 * Math.sin(4 * Math.PI * t * note);
      const bass = Math.sin(2 * Math.PI * t * (section % 2 ? 82.4 : 55));
      samples[i] = envelope * (.13 * melody + .17 * bass) * (section === 2 ? .22 : 1);
    }
    showEditor(audio, 'Demo.mp3', 'Beispielaudio');
    setSelection(3, 6);
    void play();
  } catch {
    status('Der Browser konnte das Beispielaudio nicht öffnen.', true);
  }
}

function exportMp3() {
  if (!validSelection() || encodeWorker) return;
  const first = Math.round(start * buffer.sampleRate);
  const last = Math.round(end * buffer.sampleRate);
  const tag = value => time(value).replaceAll(':', '-');
  const name = `${filename.replace(/\.mp3$/i, '')}_${tag(start)}_${tag(end)}.mp3`;
  const worker = new Worker('encode.js');
  encodeWorker = worker;
  updateButtons();
  status('Das Segment wird als MP3 erstellt …');

  function finish(blob) {
    if (encodeWorker !== worker) return;
    worker.terminate();
    encodeWorker = undefined;
    updateButtons();
    if (!blob?.size) {
      status('MP3-Export fehlgeschlagen. Bitte erneut versuchen.', true);
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`Download gestartet: ${name}`);
  }

  worker.onmessage = ({ data }) => finish(data.blob);
  worker.onerror = () => finish();
  try {
    const segment = channels.map(samples => samples.slice(first, last));
    worker.postMessage({ channels: segment, rate: buffer.sampleRate }, segment.map(samples => samples.buffer));
  } catch {
    finish();
  }
}

function pointerTime(event) {
  const bounds = ui.plot.getBoundingClientRect();
  return offset + clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * span;
}

function moveSelection(event) {
  if (Math.abs(event.clientX - drag.x) >= 3) drag.moved = true;
  if (!drag.moved) return;
  const point = pointerTime(event);
  const mark = drag.edge ?? drag.missing;
  if (mark && drag.resizeAnchor === null) {
    setMark(mark, markerTime(point));
    showFields();
  } else {
    const fixed = drag.resizeAnchor ?? drag.anchor;
    setSelection(Math.min(fixed, point), Math.max(fixed, point));
  }
}

ui.plot.addEventListener('pointerdown', event => {
  if (!buffer || drag || event.button !== 0) return;
  const point = pointerTime(event);
  const tolerance = 7 * span / ui.plot.clientWidth;
  const near = value => value !== null && value >= offset && value <= offset + span &&
    Math.abs(value - point) <= tolerance;
  const nearStart = near(start);
  const nearEnd = near(end);
  const edge = nearStart && (!nearEnd || Math.abs(start - point) <= Math.abs(end - point))
    ? 'start' : nearEnd ? 'end' : null;
  drag = {
    id: event.pointerId,
    edge,
    resizeAnchor: edge && validSelection() ? (edge === 'start' ? end : start) : null,
    missing: start === null && end !== null ? 'start' : end === null && start !== null ? 'end' : null,
    x: event.clientX,
    moved: false,
    anchor: point
  };
  ui.plot.setPointerCapture(event.pointerId);
});
ui.plot.addEventListener('pointermove', event => {
  if (drag?.id === event.pointerId) moveSelection(event);
});
ui.plot.addEventListener('pointerup', event => {
  if (drag?.id !== event.pointerId) return;
  moveSelection(event);
  const point = pointerTime(event);
  if (!drag.moved && !drag.edge && drag.missing) {
    setMark(drag.missing, markerTime(point));
    showFields();
  }
  const position = (drag.moved || drag.missing) && validSelection() ? start : point;
  drag = undefined;
  if (playback) syncLoop(position);
  else {
    cursor = position;
    overlays();
  }
});
ui.plot.addEventListener('lostpointercapture', () => {
  if (!drag) return;
  drag = undefined;
  syncLoop();
});
ui.plot.addEventListener('wheel', event => {
  if (!buffer || !event.shiftKey) return;
  event.preventDefault();
  zoom(event.deltaY < 0 ? .75 : 1 / .75, pointerTime(event));
}, { passive: false });

for (const [mark, clear] of [['start', ui.clearStart], ['end', ui.clearEnd]]) {
  const field = ui[mark];
  field.addEventListener('input', () => {
    setMark(mark, field.validity.valid && field.value !== '' ? field.valueAsNumber : null);
    refreshSelection();
    syncLoop();
  });
  clear.addEventListener('click', () => {
    const position = currentPosition();
    const hadSelection = validSelection();
    setMark(mark, null);
    field.value = '';
    refreshSelection();
    if (hadSelection) syncLoop(position);
    field.focus();
  });
}

ui.file.addEventListener('change', () => {
  const file = ui.file.files[0];
  ui.file.value = '';
  void openFile(file);
});
ui.choose.onclick = () => ui.file.click();
ui.demo.onclick = openDemo;
ui.clear.onclick = () => {
  loadId++;
  disposeAudio();
  ui.editor.hidden = true;
  ui.empty.hidden = false;
  status();
  ui.choose.focus();
};
ui.wave.onclick = () => setMode('wave');
ui.spectrum.onclick = () => setMode('spectrum');
const zoomAnchor = () => cursor >= offset && cursor <= offset + span ? cursor : offset + span / 2;
ui.in.onclick = () => zoom(.5, zoomAnchor());
ui.out.onclick = () => zoom(2, zoomAnchor());
ui.fit.onclick = () => setView(0, buffer.duration);
ui.pan.oninput = () => setView(ui.pan.valueAsNumber);
ui.play.onclick = () => void play();
ui.export.onclick = exportMp3;
window.addEventListener('keydown', event => {
  if (!buffer || event.code !== 'Space' || event.repeat ||
      event.target.closest('button, input, label, a, [contenteditable]')) return;
  event.preventDefault();
  void play();
});
window.addEventListener('dragover', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', event => {
  if (!event.relatedTarget) document.body.classList.remove('dragging');
});
window.addEventListener('drop', event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  document.body.classList.remove('dragging');
  void openFile(event.dataTransfer.files[0]);
});
new ResizeObserver(() => {
  if (buffer) scheduleSpectrum();
}).observe(ui.canvas);
