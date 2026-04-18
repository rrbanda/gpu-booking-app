"""
GPU Booking Agent -- Google ADK with MCP Tools

A multi-agent system for managing GPU resource bookings on an OpenShift cluster.
Uses ADK's MCPToolset to connect to the FastMCP tool server, which wraps the
Go booking backend API.

Architecture:
  root_agent (BookingAssistant)
    ├── availability_agent (read-only queries)
    └── reservation_agent (mutating operations)
"""

import os

from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams

MCP_URL = os.getenv("MCP_URL", "http://localhost:8000/mcp")
MODEL = os.getenv("ADK_MODEL", "gemini-2.0-flash")

SYSTEM_INSTRUCTION = """\
You are a GPU Booking Assistant that helps users manage GPU resource reservations
on an OpenShift cluster with NVIDIA H200 GPUs and MIG (Multi-Instance GPU) partitions.

## GPU Resource Types Available
- **nvidia.com/gpu** (H200 Full GPU): 8 units, 1.0 GPU equivalent each
- **nvidia.com/mig-3g.71gb** (MIG 3g.71gb): 8 units, 0.5 GPU equivalent each
- **nvidia.com/mig-2g.35gb** (MIG 2g.35gb): 8 units, 0.25 GPU equivalent each
- **nvidia.com/mig-1g.18gb** (MIG 1g.18gb): 16 units, 0.125 GPU equivalent each

## Booking Rules
- Dates are in UTC (YYYY-MM-DD format).
- Hours are in UTC (0-23 start, 1-24 end). Default is full day (0-24).
- "Reserved" bookings are user-created and have priority.
- "Consumed" bookings are auto-synced from Kueue workloads and can be overridden
  by making a reservation (the consumed booking is automatically evicted).
- Only reserved-vs-reserved conflicts are blocked (slot_taken error).
- Descriptions are limited to 160 characters.

## Workflow
1. Always call get_config first if you need to understand available resources.
2. Before creating bookings, check availability for the requested date(s).
3. For multi-resource or multi-day bookings, prefer bulk_book over individual calls.
4. When cancelling, list bookings first to find the booking ID.
5. Confirm mutating actions (create, cancel) with the user before executing.

## Communication Style
- Be concise but informative.
- Show availability as a clear summary (e.g., "3 of 8 H200 GPUs are free on 2026-04-18").
- When booking succeeds, confirm the details (resource, date, hours).
- If a booking fails, explain why and suggest alternatives.
"""

AVAILABILITY_INSTRUCTION = """\
You handle read-only GPU resource queries. Your job is to check what resources
are available and report status to the user.

Use these tools:
- get_config: to understand what GPU resources exist and their counts
- list_bookings: to see all current bookings
- check_availability: to find free slots for a specific resource and date

Always provide clear summaries like:
- "On 2026-04-18, there are 5 of 8 H200 GPUs free, 2 reserved, 1 consumed (overridable)"
- "MIG 1g.18gb has 12 of 16 units available tomorrow"

When asked about availability across multiple days, check each day and summarize.
"""

RESERVATION_INSTRUCTION = """\
You handle GPU booking mutations: creating and cancelling reservations.

Use these tools:
- create_booking: reserve a single GPU slot (use after checking availability)
- bulk_book: book multiple resources across a date range
- cancel_booking: cancel a booking by its ID

IMPORTANT RULES:
- Always confirm with the user before creating or cancelling bookings.
- For single-slot bookings, use create_booking with a specific slot_index from
  check_availability results.
- For multi-resource or multi-day requests, use bulk_book which auto-finds slots.
- Show the user what was booked after success (resource type, count, dates, hours).
- If a slot is taken, suggest checking availability for alternatives.
"""

mcp_toolset = McpToolset(
    connection_params=StreamableHTTPConnectionParams(url=MCP_URL),
)

availability_agent = LlmAgent(
    model=MODEL,
    name="availability_agent",
    description=(
        "Handles read-only GPU resource queries: checking configuration, "
        "listing bookings, and computing availability for specific resources and dates."
    ),
    instruction=AVAILABILITY_INSTRUCTION,
    tools=[mcp_toolset],
    tool_filter=["get_config", "list_bookings", "check_availability"],
)

reservation_agent = LlmAgent(
    model=MODEL,
    name="reservation_agent",
    description=(
        "Handles GPU booking mutations: creating single or bulk reservations "
        "and cancelling existing bookings. Confirms actions with the user before executing."
    ),
    instruction=RESERVATION_INSTRUCTION,
    tools=[mcp_toolset],
    tool_filter=["create_booking", "bulk_book", "cancel_booking", "check_availability"],
)

root_agent = LlmAgent(
    model=MODEL,
    name="gpu_booking_assistant",
    description=(
        "A GPU booking assistant that helps users manage NVIDIA H200 GPU "
        "and MIG partition reservations on an OpenShift cluster."
    ),
    instruction=SYSTEM_INSTRUCTION,
    sub_agents=[availability_agent, reservation_agent],
)


def main():
    """Entry point: expose the agent as an A2A server via uvicorn."""
    import uvicorn
    from google.adk.a2a.utils.agent_to_a2a import to_a2a

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8001"))

    a2a_app = to_a2a(root_agent, port=port)
    uvicorn.run(a2a_app, host=host, port=port)


if __name__ == "__main__":
    main()
