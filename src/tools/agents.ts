import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchUsers, fetchCalls, formatDuration } from "../client.js";

export function registerAgentsTools(server: McpServer): void {
  server.tool(
    "justcall-list-agents",
    "List all JustCall agents/users with their IDs. Use agent IDs to filter calls by agent.",
    {},
    async () => {
      const res = await fetchUsers();
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    }
  );

  server.tool(
    "justcall-get-agent-stats",
    "Get call performance stats for a specific agent over a date range: total calls, avg duration, answer rate, inbound vs outbound breakdown.",
    {
      agent_id: z.number().describe("The JustCall agent/user ID"),
      from_datetime: z
        .string()
        .describe("Start datetime (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS) in UTC"),
      to_datetime: z
        .string()
        .describe("End datetime (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS) in UTC"),
    },
    async ({ agent_id, from_datetime, to_datetime }) => {
      // Fetch up to 5 pages (500 calls) for the agent in range.
      // API is 0-indexed — page 0 is the first/newest page, not page 1.
      let allCalls: unknown[] = [];
      let page = 0;

      while (page <= 4) {
        const res = await fetchCalls({
          agent_id,
          from_datetime,
          to_datetime,
          page,
          per_page: 100,
        });

        const data = res.data ?? [];
        allCalls = allCalls.concat(data);

        if (data.length < 100) break;
        page++;
        await new Promise((r) => setTimeout(r, 200));
      }

      const calls = allCalls as Array<{
        direction?: string;
        call_info?: { direction?: string };
        call_duration?: { total_duration?: number };
      }>;

      const total = calls.length;
      // API returns "Incoming"/"Outgoing", not "inbound"/"outbound" — see DIRECTION_TO_API
      // in calls.ts. Comparing against the lowercase inbound/outbound values here always
      // missed, so `inbound` silently read 0 for every agent.
      const inbound = calls.filter(
        (c) => (c.direction ?? c.call_info?.direction) === "Incoming"
      ).length;
      const outbound = total - inbound;

      const durations = calls
        .map((c) => c.call_duration?.total_duration ?? 0)
        .filter((d) => d > 0);

      const avgDuration =
        durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : 0;

      const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
      const minDuration = durations.length > 0 ? Math.min(...durations) : 0;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                agent_id,
                period: { from: from_datetime, to: to_datetime },
                totals: {
                  calls: total,
                  inbound,
                  outbound,
                },
                duration: {
                  avg: formatDuration(avgDuration),
                  avg_seconds: avgDuration,
                  max: formatDuration(maxDuration),
                  min: formatDuration(minDuration),
                },
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
