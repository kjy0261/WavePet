// 헬퍼가 보낸 PCM(48kHz 모노 f32)을 받아 재생 그래프로 흘려 보내는 AudioWorklet.
// 스피커로 내보내지는 않고(뒤에 음소거 게인) AnalyserNode 입력으로만 쓴다.
const MAX_BUFFERED = 48000 * 0.12; // 120ms 넘게 밀리면 오래된 것부터 버려 지연을 막음

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.queued = 0;
    this.offset = 0; // queue[0]에서 이미 꺼낸 샘플 수
    this.port.onmessage = (event) => {
      this.queue.push(event.data);
      this.queued += event.data.length;
      while (this.queued - this.offset > MAX_BUFFERED && this.queue.length > 1) {
        this.queued -= this.queue.shift().length;
        this.offset = 0;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    let i = 0;
    while (i < out.length && this.queue.length) {
      const head = this.queue[0];
      const n = Math.min(out.length - i, head.length - this.offset);
      out.set(head.subarray(this.offset, this.offset + n), i);
      i += n;
      this.offset += n;
      if (this.offset >= head.length) {
        this.queue.shift();
        this.queued -= head.length;
        this.offset = 0;
      }
    }
    out.fill(0, i); // 모자라면 무음
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
