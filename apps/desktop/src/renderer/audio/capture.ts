export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  // Request permission so device labels are revealed
  try { await navigator.mediaDevices.getUserMedia({audio:true}); } catch {}
  const all = await navigator.mediaDevices.enumerateDevices();
  const inputs = all.filter(d=>d.kind==="audioinput");

  // Prefer loopback/virtual devices
  const priority = ["blackhole", "vb-cable", "vb audio", "cable", "loopback", "stereo mix"];
  inputs.sort((a,b)=>{
    const as = (a.label||"").toLowerCase(), bs=(b.label||"").toLowerCase();
    const ap = priority.findIndex(k=>as.includes(k)); const bp = priority.findIndex(k=>bs.includes(k));
    return (ap<0?99:ap) - (bp<0?99:bp) || as.localeCompare(bs);
  });
  return inputs;
}

export async function getStream(deviceId?: string){
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: { ideal: 2 },
      echoCancellation: false, noiseSuppression: false, autoGainControl: false
    }, video:false
  });
}
