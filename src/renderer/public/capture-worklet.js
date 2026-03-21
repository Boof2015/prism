class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true

    const left = input[0]
    if (!left || left.length === 0) return true

    const right = input.length > 1 ? input[1] : left

    this.port.postMessage({
      left: left.slice(),
      right: right.slice(),
    })

    return true
  }
}

registerProcessor('capture-processor', CaptureProcessor)
