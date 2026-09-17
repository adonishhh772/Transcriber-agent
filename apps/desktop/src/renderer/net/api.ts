export type TranscribeResponse = {
  transcript: string;
  segments: Array<{ text: string; start: number; end: number }>;
  detected_language: string;
  summary: any;
};

export async function postTranscribe(
  baseUrl: string,
  file: File,
  language: string | undefined,
  includeSummary: boolean
): Promise<TranscribeResponse> {
  const url = new URL("/v1/simple/transcribe", baseUrl);
  if (language && language !== "auto") {
    url.searchParams.set("language", language);
  }
  if (!includeSummary) {
    url.searchParams.set("summary", "false");
  }

  const form = new FormData();
  form.append("audio", file, file.name || "audio.wav");

  const resp = await fetch(url.toString(), {
    method: "POST",
    body: form,
  });

  if (!resp.ok) {
    const message = await safeJsonMessage(resp);
    throw new Error(message || `HTTP ${resp.status}`);
  }

  return (await resp.json()) as TranscribeResponse;
}

async function safeJsonMessage(resp: Response): Promise<string | undefined> {
  try {
    const data = await resp.json();
    return data?.detail || JSON.stringify(data);
  } catch {
    return undefined;
  }
}
