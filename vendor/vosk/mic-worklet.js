/* ═══════════════════════════════════════════════════════
   Microphone capture worklet for the offline (Vosk) engine.

   Runs on the audio thread and posts raw mono frames back to
   the page, which forwards them to the recogniser's worker.
   Doing the capture here rather than in a ScriptProcessorNode
   keeps a long practice session off the main thread, so the
   audio does not glitch while the UI renders.
   ═══════════════════════════════════════════════════════ */

class MicCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // A disconnected or silent input yields an empty array; keep the
    // processor alive regardless so it resumes when audio returns.
    if (channel && channel.length) {
      // Copy: the frame buffer is reused by the audio thread.
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}

registerProcessor('mic-capture', MicCaptureProcessor);
