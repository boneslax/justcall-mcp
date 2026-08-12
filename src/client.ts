const BASE_URL = "https://api.justcall.io/v2.1";

const API_KEY = process.env.JUSTCALL_API_KEY ?? "";
const API_SECRET = process.env.JUSTCALL_API_SECRET ?? "";

function authHeader(): string {
  return `${API_KEY}:${API_SECRET}`;
}

export async function apiGet(
  path: string,
  params: Record<string, string | number> = {}
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`JustCall API error ${res.status} on ${path}: ${body}`);
  }

  return res.json();
}

export interface CallsListResponse {
  status: string;
  count: number;
  data: CallRecord[];
}

export interface CallRecord {
  id: number;
  agent_name: string;
  agent_id: number;
  contact_name: string;
  contact_number: string;
  call_date: string;
  call_time: string;
  direction: string;
  call_duration: {
    total_duration: number;
    ring_time?: number;
    talk_time?: number;
    hold_time?: number;
  };
  call_info: {
    direction: string;
    recording?: string;
    call_type?: string;
  };
  queue_data?: unknown;
  ai_data?: unknown;
  [key: string]: unknown;
}

export type CallsAiUtterance = {
  speaker_id: string | number | null;
  speaker_name: string | null;
  sentence: string;
  start_time: string | number | null;
  end_time: string | number | null;
};

export type CallsAiResult =
  | { kind: "ready"; summary: Record<string, unknown>; transcript: string; utterances: CallsAiUtterance[] }
  | { kind: "not_ready" }
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "rate_limited"; retry_after_ms: number | null }
  | { kind: "provider_error"; status: number; reason: string }
  | { kind: "transport_error"; reason: string };

function retryAfterMs(value: string | null): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) && at >= Date.now() ? at - Date.now() : null;
}

export function parseCallsAiEnvelope(raw: unknown): CallsAiResult {
  const envelope = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const data = envelope?.data && typeof envelope.data === "object"
    ? envelope.data as Record<string, unknown>
    : null;
  const transcription = data?.call_transcription;
  if (!Array.isArray(transcription)) return { kind: "not_ready" };
  const utterances = transcription.flatMap((entry): CallsAiUtterance[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const sentence = typeof row.sentence === "string" ? row.sentence.trim() : "";
    if (!sentence) return [];
    const timestamp = row.timestamp && typeof row.timestamp === "object"
      ? row.timestamp as Record<string, unknown>
      : {};
    const time = (value: unknown): string | number | null =>
      typeof value === "string" || typeof value === "number" ? value : null;
    return [{
      speaker_id: typeof row.speaker_id === "string" || typeof row.speaker_id === "number" ? row.speaker_id : null,
      speaker_name: typeof row.speaker_name === "string" ? row.speaker_name.trim() || null : null,
      sentence,
      start_time: time(timestamp.starttime),
      end_time: time(timestamp.endtime),
    }];
  });
  if (utterances.length === 0) return { kind: "not_ready" };
  const { call_transcription: _transcription, ...summary } = data!;
  return {
    kind: "ready",
    summary,
    utterances,
    transcript: utterances.map((row) => `${row.speaker_name ?? row.speaker_id ?? "Speaker"}: ${row.sentence}`).join("\n"),
  };
}

export async function classifyCallsAiResponse(response: Response): Promise<CallsAiResult> {
  if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
  if (response.status === 404) return { kind: "not_found" };
  if (response.status === 429) {
    return { kind: "rate_limited", retry_after_ms: retryAfterMs(response.headers.get("retry-after")) };
  }
  if (!response.ok) return { kind: "provider_error", status: response.status, reason: `http_${response.status}` };
  try {
    return parseCallsAiEnvelope(await response.json());
  } catch {
    return { kind: "provider_error", status: response.status, reason: "invalid_json" };
  }
}

export async function fetchCallsAi(
  id: number | string,
  fetchImpl: typeof fetch = fetch
): Promise<CallsAiResult> {
  const exactId = String(id).trim();
  if (!exactId) return { kind: "provider_error", status: 0, reason: "invalid_call_id" };
  if (!API_KEY || !API_SECRET) return { kind: "provider_error", status: 0, reason: "not_configured" };
  let response: Response;
  try {
    response = await fetchImpl(
      `${BASE_URL}/calls_ai/${encodeURIComponent(exactId)}?platform=justcall&fetch_transcription=true`,
      { headers: { Authorization: authHeader(), Accept: "application/json" } }
    );
  } catch (error) {
    return { kind: "transport_error", reason: error instanceof Error ? error.name : "transport_error" };
  }
  return classifyCallsAiResponse(response);
}

export async function fetchCalls(params: Record<string, string | number>): Promise<CallsListResponse> {
  return apiGet("/calls", params) as Promise<CallsListResponse>;
}

export async function fetchCall(
  id: number | string,
  fetchQueueData = false,
  fetchAiData = false
): Promise<{ status: string; data: CallRecord }> {
  const params: Record<string, string | number> = {};
  if (fetchQueueData) params["fetch_queue_data"] = 1;
  // AI data lives on the dedicated calls_ai endpoint. This flag is retained in
  // the signature for compatibility but intentionally does not alter this request.
  return apiGet(`/calls/${id}`, params) as Promise<{ status: string; data: CallRecord }>;
}

export async function fetchUsers(): Promise<unknown> {
  return apiGet("/users");
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function parseIvrPath(
  queueData: unknown
): Array<{ step: number; menu?: string; option_pressed?: string; label?: string; raw: unknown }> {
  if (!queueData || !Array.isArray(queueData)) {
    if (queueData && typeof queueData === "object") {
      return [{ step: 1, raw: queueData }];
    }
    return [];
  }

  return (queueData as unknown[]).map((entry, idx) => {
    const e = entry as Record<string, unknown>;
    return {
      step: idx + 1,
      menu: (e["queue_name"] ?? e["menu_name"] ?? e["ivr_name"]) as string | undefined,
      option_pressed: (e["digit_pressed"] ?? e["option"] ?? e["key_pressed"]) as string | undefined,
      label: (e["option_label"] ?? e["destination_name"] ?? e["label"]) as string | undefined,
      raw: entry,
    };
  });
}
