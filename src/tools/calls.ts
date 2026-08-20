import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fetchCalls,
  fetchCall,
  fetchCallAiFor,
  formatDuration,
  parseIvrPath,
  CallRecord,
} from "../client.js";

// The API labels call_direction values "Incoming"/"Outgoing" — accept the friendlier
// inbound/outbound from callers and translate before hitting the API.
const DIRECTION_TO_API: Record<string, string> = {
  inbound: "Incoming",
  outbound: "Outgoing",
};

function summarizeCall(call: CallRecord) {
  const dur = call.call_duration ?? {};
  // call_date/call_time are UTC; call_user_date/call_user_time are account-local (Pacific for
  // this account) and are what every human-facing consumer actually wants. Prefer the latter.
  const userDate = (call["call_user_date"] as string | undefined) ?? call.call_date;
  const userTime = (call["call_user_time"] as string | undefined) ?? call.call_time;
  return {
    id: call.id,
    agent: call.agent_name,
    agent_id: call.agent_id,
    contact: call.contact_name,
    contact_number: call.contact_number,
    date: userDate,
    time: userTime,
    timezone: "account-local (Pacific)",
    direction: call.direction ?? call.call_info?.direction,
    duration: {
      total_seconds: dur.total_duration,
      total_formatted: formatDuration(dur.total_duration ?? 0),
      ring_time_seconds: dur.ring_time,
      ring_time_formatted: dur.ring_time != null ? formatDuration(dur.ring_time) : undefined,
      talk_time_seconds: dur.talk_time,
      talk_time_formatted: dur.talk_time != null ? formatDuration(dur.talk_time) : undefined,
      hold_time_seconds: dur.hold_time,
      hold_time_formatted: dur.hold_time != null ? formatDuration(dur.hold_time) : undefined,
    },
    recording_url: call.call_info?.recording,
  };
}

export function registerCallsTools(server: McpServer): void {
  server.tool(
    "justcall-list-calls",
    "List calls from JustCall with duration breakdown. Filter by date range, agent, or direction.",
    {
      from_datetime: z
        .string()
        .optional()
        .describe(
          "Start datetime (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS), interpreted in the ACCOUNT'S LOCAL TIMEZONE (Pacific for this account), NOT UTC — despite that being a common assumption."
        ),
      to_datetime: z
        .string()
        .optional()
        .describe(
          "End datetime (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS), interpreted in the ACCOUNT'S LOCAL TIMEZONE (Pacific for this account), NOT UTC."
        ),
      contact_number: z
        .string()
        .optional()
        .describe(
          "Filter to calls with/from this contact phone number (with country code, e.g. 13239540402). The fastest way to find a specific lead's calls — use this instead of paging through the full log."
        ),
      agent_id: z.number().optional().describe("Filter by agent ID"),
      call_direction: z
        .enum(["inbound", "outbound"])
        .optional()
        .describe("Filter by call direction"),
      sort: z
        .enum(["id", "datetime"])
        .optional()
        .default("datetime")
        .describe(
          "Sort key. Default 'datetime' — the API's own default ('id') sorts by ingestion order, which is NOT reliably chronological (a call can be indexed out of start-time order)."
        ),
      order: z.enum(["asc", "desc"]).optional().default("desc").describe("Sort direction"),
      page: z
        .number()
        .optional()
        .default(0)
        .describe("Page number (API is 0-indexed — page 0 is the first/newest page)."),
      per_page: z
        .number()
        .optional()
        .default(50)
        .describe("Results per page (max 100)"),
    },
    async ({
      from_datetime,
      to_datetime,
      contact_number,
      agent_id,
      call_direction,
      sort,
      order,
      page,
      per_page,
    }) => {
      const params: Record<string, string | number> = { page, per_page, sort, order };
      if (from_datetime) params["from_datetime"] = from_datetime;
      if (to_datetime) params["to_datetime"] = to_datetime;
      if (contact_number) params["contact_number"] = contact_number;
      if (agent_id) params["agent_id"] = agent_id;
      if (call_direction) params["call_direction"] = DIRECTION_TO_API[call_direction];

      const res = await fetchCalls(params);
      const calls = (res.data ?? []).map(summarizeCall);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ total: res.count, page, calls }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "justcall-get-call",
    "Get full detail for a single call including duration breakdown and IVR path (menu options the caller pressed to reach an agent).",
    {
      call_id: z.number().describe("The JustCall call ID"),
      include_transcript: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include AI transcript and summary if available"),
    },
    async ({ call_id, include_transcript }) => {
      const res = await fetchCall(call_id, true, include_transcript);
      const call = res.data;

      const summary = summarizeCall(call);
      const ivr_path = parseIvrPath(call.queue_data);

      const result: Record<string, unknown> = {
        ...summary,
        ivr_path:
          ivr_path.length > 0
            ? ivr_path
            : "No IVR path data — call may have been direct-dialed or queue data unavailable",
        queue_data_raw: call.queue_data,
      };

      if (include_transcript) {
        const ai = await fetchCallAiFor(call);
        result["ai_data"] = ai
          ? { summary: ai.call_summary, sentiment: ai.customer_sentiment, transcript: ai.call_transcription }
          : "No AI data available for this call (transcription/AI may not be enabled on this line, or the call hasn't finished processing yet)";
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "justcall-get-call-recording",
    "Get the recording URL for a specific call.",
    {
      call_id: z.number().describe("The JustCall call ID"),
    },
    async ({ call_id }) => {
      const res = await fetchCall(call_id);
      const recording = res.data?.call_info?.recording;

      if (!recording) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ call_id, recording_url: null, message: "No recording available for this call" }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ call_id, recording_url: recording }),
          },
        ],
      };
    }
  );

  server.tool(
    "justcall-get-call-transcript",
    "Get the AI-generated transcript and summary for a call.",
    {
      call_id: z.number().describe("The JustCall call ID"),
    },
    async ({ call_id }) => {
      const res = await fetchCall(call_id);
      const call = res.data;
      const ai = await fetchCallAiFor(call);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                call_id,
                agent: call.agent_name,
                date: (call["call_user_date"] as string | undefined) ?? call.call_date,
                summary: ai?.call_summary || undefined,
                sentiment: ai?.customer_sentiment || undefined,
                transcript:
                  ai?.call_transcription ??
                  "No transcript available — AI/transcription may not be enabled on this line, or the call hasn't finished processing yet",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
