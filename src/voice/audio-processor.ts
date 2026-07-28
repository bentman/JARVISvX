// @ts-nocheck
// AudioWorklet modules are evaluated by Chromium directly, so this file must
// remain valid JavaScript even though it is kept with the TypeScript sources.
class JarvisAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inputRate = sampleRate;
    this.buffer = [];
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    const ratio = this.inputRate / 16000;
    for (let position = 0; position < channel.length; position += ratio) this.buffer.push(channel[Math.floor(position)] || 0);
    while (this.buffer.length >= 1280) {
      const frame = new Float32Array(this.buffer.splice(0, 1280));
      this.port.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}
registerProcessor('jarvis-audio-processor', JarvisAudioProcessor);
