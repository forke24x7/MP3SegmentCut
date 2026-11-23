const size = 2048;
const height = 144;
const reverse = new Uint16Array(size);
const windowGain = new Float32Array(size);
const cos = new Float32Array(size / 2);
const sin = new Float32Array(size / 2);

for (let i = 0; i < size; i++) {
  reverse[i] = (reverse[i >> 1] >> 1) | ((i & 1) * (size / 2));
  windowGain[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (size - 1));
  if (i < size / 2) {
    cos[i] = Math.cos(2 * Math.PI * i / size);
    sin[i] = -Math.sin(2 * Math.PI * i / size);
  }
}

const palette = [
  [34, 33, 38], [53, 33, 69], [103, 43, 110], [195, 57, 140],
  [255, 126, 177], [255, 213, 156]
];
const real = new Float32Array(size);
const imag = new Float32Array(size);
let channels = [];

function transform(center, samples) {
  imag.fill(0);
  for (let i = 0; i < size; i++) {
    real[reverse[i]] = (samples[center + i - size / 2] ?? 0) * windowGain[i];
  }
  for (let span = 2; span <= size; span *= 2) {
    const half = span / 2;
    for (let base = 0; base < size; base += span) {
      for (let i = 0; i < half; i++) {
        const a = base + i;
        const b = a + half;
        const phase = i * size / span;
        const r = real[b] * cos[phase] - imag[b] * sin[phase];
        const j = real[b] * sin[phase] + imag[b] * cos[phase];
        real[b] = real[a] - r;
        imag[b] = imag[a] - j;
        real[a] += r;
        imag[a] += j;
      }
    }
  }
}

self.onmessage = ({ data }) => {
  if (data.channels) {
    channels = data.channels;
    return;
  }

  const { id, start, duration, rate, width } = data;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const topHz = Math.min(rate / 2, 16000);
  // Equal distances on the frequency axis represent equal ratios.
  const bands = Array.from({ length: height + 1 }, (_, y) =>
    30 * (topHz / 30) ** (1 - y / height) * size / rate);
  const power = new Float32Array(size / 2 + 1);

  for (let x = 0; x < width; x++) {
    const center = Math.round((start + (x + .5) * duration / width) * rate);
    power.fill(0);
    for (const samples of channels) {
      transform(center, samples);
      for (let i = 0; i < power.length; i++) {
        power[i] += (real[i] ** 2 + imag[i] ** 2) / channels.length;
      }
    }

    for (let y = 0; y < height; y++) {
      const low = Math.max(1, Math.round(bands[y + 1]));
      const high = Math.max(low, Math.floor(bands[y]));
      let peak = 0;
      for (let bin = low; bin <= high; bin++) peak = Math.max(peak, power[bin]);
      const db = 10 * Math.log10(Math.max(peak / (size / 4) ** 2, 1e-10));
      const color = Math.min(5, Math.max(0, (db + 78) / 14));
      const left = Math.floor(color);
      const right = Math.min(5, left + 1);
      const offset = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        rgba[offset + c] = palette[left][c] + (palette[right][c] - palette[left][c]) * (color - left);
      }
      rgba[offset + 3] = 255;
    }
  }
  self.postMessage({ id, rgba, width, height }, [rgba.buffer]);
};
