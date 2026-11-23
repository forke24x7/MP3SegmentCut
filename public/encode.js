self.onmessage = ({ data: { channels, rate } }) => {
  try {
    importScripts('vendor/lame.min.js');
    const encoder = new lamejs.Mp3Encoder(channels.length, rate, 192);
    const chunks = [];
    const blockSize = 1152;

    function pcm(samples, start, end) {
      const result = new Int16Array(end - start);
      for (let i = start; i < end; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        result[i - start] = Math.round(sample * (sample < 0 ? 32768 : 32767));
      }
      return result;
    }

    for (let start = 0; start < channels[0].length; start += blockSize) {
      const end = Math.min(start + blockSize, channels[0].length);
      const left = pcm(channels[0], start, end);
      const chunk = channels.length === 1
        ? encoder.encodeBuffer(left)
        : encoder.encodeBuffer(left, pcm(channels[1], start, end));
      if (chunk.length) chunks.push(chunk);
    }
    chunks.push(encoder.flush());
    self.postMessage({ blob: new Blob(chunks, { type: 'audio/mpeg' }) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
