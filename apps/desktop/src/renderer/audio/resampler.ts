export const OUT_SR = 16000;

export function mixToMono(buf: AudioBuffer): Float32Array {
  const ch = buf.numberOfChannels; if (ch===1) return buf.getChannelData(0);
  const len = buf.length, out = new Float32Array(len);
  for (let c=0;c<ch;c++){ const data = buf.getChannelData(c); for (let i=0;i<len;i++) out[i]+=data[i]/ch; }
  return out;
}

export function resampleLinear(src: Float32Array, srcRate: number): Float32Array {
  if (srcRate === OUT_SR) return src;
  const ratio = OUT_SR / srcRate, outLen = Math.floor(src.length * ratio), out = new Float32Array(outLen);
  for (let i=0;i<outLen;i++){ const pos=i/ratio, i0=Math.floor(pos), i1=Math.min(i0+1,src.length-1), frac=pos-i0; out[i]=src[i0]*(1-frac)+src[i1]*frac; }
  return out;
}

export function f32ToPCM16(f32: Float32Array): ArrayBuffer {
  const out = new Int16Array(f32.length);
  for (let i=0;i<f32.length;i++){ let s=Math.max(-1,Math.min(1,f32[i])); out[i] = s<0 ? s*0x8000 : s*0x7fff; }
  return out.buffer;
}
