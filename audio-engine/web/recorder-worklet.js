class HumRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.active = true;
    this.port.onmessage = ({ data }) => {
      if (data === "stop") {
        if (this.offset) this.send();
        this.active = false;
        this.port.postMessage({ type: "stopped" });
      }
    };
  }

  send() {
    const samples = this.buffer.slice(0, this.offset);
    this.port.postMessage({ type: "samples", samples }, [samples.buffer]);
    this.offset = 0;
  }

  process(inputs) {
    if (!this.active) return false;
    const input = inputs[0]?.[0];
    if (input) {
      for (const value of input) {
        this.buffer[this.offset++] = value;
        if (this.offset === this.buffer.length) this.send();
      }
    }
    return true;
  }
}

registerProcessor("hum-recorder", HumRecorder);
