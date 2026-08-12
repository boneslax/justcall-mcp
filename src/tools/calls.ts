import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fetchCalls,
  fetchCall,
  fetchCallsAi,
  formatDuration,
  parseIvrPath,
  CallRecord,
} from "../client.js";

function summarizeCall(call: CallRecord) {
  const dur = call.call_duration ?? {};
  return {
    id: call.id,
    agent: call.agent_name,
    agent_id: call.agent_id,
    contact: call.contact_name,
    contact_number: call.contact_number,
    date: call.call_date,
    time: call.call_time,
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
        .describe("Start datetime (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS) in UTC"),
      to_datetime: z
        .string()
        .optional()
        .describe("End datetime (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS) in UTC"),
      agent_id: z.number().optional().describe("Filter by agent ID"),
      call_direction: z
        .enum(["inbound", "outbound"])
        .optional()
        .describe("Filter by call direction"),
      page: z.number().optional().default(1).describe("Page number"),
      per_page: z
        .number()
        .optional()
        .default(50)
        .describe("Results per page (max 100)"),
    },
    async ({ from_datetime, to_datetime, agent_id, call_direction, page, per_page }) => {
      const params: Record<string, string | number> = { page, per_page };
      if (from_datetime) params["from_datetime"] = from_datetime;
      if (to_datetime) params["to_datetime"] = to_datetime;
      if (agent_id) params["agent_id"] = agent_id;
      if (call_direction) params["call_direction"] = call_direction;

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
      const res = await fetchCall(call_id, true);
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
        result["ai_data"] = await fetchCallsAi(call_id);
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
      const ai = await fetchCallsAi(call_id);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                call_id,
                outcome: ai.kind,
                ai_data: ai,
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
