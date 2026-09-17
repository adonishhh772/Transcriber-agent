export const TARGET_SAMPLE_RATE = 16_000;

export function resampleLinear(
  input: Float32Array,
  sourceRate: number,
  targetRate = TARGET_SAMPLE_RATE,
): Float32Array {
  if (input.length === 0 || sourceRate <= 0 || targetRate <= 0)
    return new Float32Array();
  if (sourceRate === targetRate) return new Float32Array(input);

  const outputLength = Math.max(
    1,
    Math.round((input.length * targetRate) / sourceRate),
  );
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const left = Math.floor(sourcePosition);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = sourcePosition - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

export function interleavedToMono(
  input: Float32Array,
  channels: number,
): Float32Array {
  if (channels <= 1) return new Float32Array(input);
  const frames = Math.floor(input.length / channels);
  const output = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let total = 0;
    for (let channel = 0; channel < channels; channel += 1)
      total += input[frame * channels + channel];
    output[frame] = total / channels;
  }
  return output;
}

export function pcm16ToFloat32(input: ArrayBuffer): Float32Array {
  const samples = new Int16Array(input);
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1)
    output[index] = samples[index] / 32768;
  return output;
}

export function float32ToPcm16(input: Float32Array): ArrayBuffer {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}
