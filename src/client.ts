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
  if (fetchAiData) params["fetch_ai_data"] = 1;
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
