export function inputGainDbToLinear(db: number): number {
  return Math.pow(10, db / 20)
}

export function applyInputGainToStereoSamples(
  left: Float32Array,
  right: Float32Array,
  linearGain: number,
): void {
  if (linearGain === 1) {
    return
  }

  for (let index = 0; index < left.length; index += 1) {
    left[index] *= linearGain
  }

  for (let index = 0; index < right.length; index += 1) {
    right[index] *= linearGain
  }
}
