"use client";

import { useState } from "react";
import type { A2AEventRecord, A2ATask, A2AStatusUpdate, A2AArtifactUpdate, A2ADirectMessage, A2ATaskStatus } from "../../lib/a2a-types";

function kindColor(kind: string): string {
  switch (kind) {
    case "task": return "bg-blue-100 text-blue-700 border-blue-200";
    case "status-update": return "bg-amber-100 text-amber-700 border-amber-200";
    case "artifact-update": return "bg-purple-100 text-purple-700 border-purple-200";
    case "message": return "bg-green-100 text-green-700 border-green-200";
    default: return "bg-rh-gray-10 text-rh-gray-60 border-rh-gray-20";
  }
}

function statusBadge(state: A2ATaskStatus["state"]) {
  const colors: Record<string, string> = {
    submitted: "bg-blue-100 text-blue-700",
    working: "bg-amber-100 text-amber-700",
    "input-required": "bg-purple-100 text-purple-700",
    completed: "bg-green-100 text-green-700",
    failed: "bg-rh-red-10 text-rh-red-60",
    canceled: "bg-rh-gray-10 text-rh-gray-50",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${colors[state] || ""}`}>
      {state}
    </span>
  );
}

function EventCard({ record, isHighlighted, onHighlight }: {
  record: A2AEventRecord;
  isHighlighted: boolean;
  onHighlight?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const getEventSummary = (): string => {
    const ev = record.raw;
    switch (ev.kind) {
      case "task":
        return `Task ${(ev as A2ATask).status.state}`;
      case "status-update":
        return `Status: ${(ev as A2AStatusUpdate).status.state}`;
      case "artifact-update": {
        const art = (ev as A2AArtifactUpdate).artifact;
        return `Artifact: ${art.name || art.artifactId}`;
      }
      case "message": {
        const msg = ev as A2ADirectMessage;
        const text = msg.parts.find(p => p.kind === "text")?.text || "";
        return text.length > 60 ? text.slice(0, 60) + "..." : text;
      }
      default:
        return "Event";
    }
  };

  const getEventStatus = (): A2ATaskStatus["state"] | null => {
    const ev = record.raw;
    if (ev.kind === "task") return (ev as A2ATask).status.state;
    if (ev.kind === "status-update") return (ev as A2AStatusUpdate).status.state;
    return null;
  };

  const eventStatus = getEventStatus();

  return (
    <div
      className={`border rounded-lg mb-1.5 transition-all ${
        isHighlighted ? "ring-2 ring-rh-red-50/40 border-rh-red-50" : "border-rh-gray-20"
      }`}
    >
      <button
        onClick={() => { setExpanded(!expanded); onHighlight?.(); }}
        className="w-full text-left px-3 py-2 flex items-center gap-2"
      >
        <svg
          className={`w-3 h-3 text-rh-gray-40 transition-transform flex-shrink-0 ${expanded ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>

        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${kindColor(record.kind)}`}>
          {record.kind}
        </span>

        {eventStatus && statusBadge(eventStatus)}

        <span className="text-xs text-rh-gray-60 truncate flex-1">
          {getEventSummary()}
        </span>

        <span className="text-[10px] text-rh-gray-30 flex-shrink-0">
          {record.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 border-t border-rh-gray-20">
          <pre className="mt-2 text-[11px] text-rh-gray-50 overflow-x-auto max-h-64 bg-rh-gray-10 rounded p-2">
            {JSON.stringify(record.raw, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

interface TaskGroup {
  taskId: string;
  contextId: string;
  latestState: A2ATaskStatus["state"];
  events: A2AEventRecord[];
}

function groupByTask(events: A2AEventRecord[]): TaskGroup[] {
  const groups: Record<string, TaskGroup> = {};

  for (const ev of events) {
    const taskId = ev.taskId || "ungrouped";
    if (!groups[taskId]) {
      groups[taskId] = {
        taskId,
        contextId: "",
        latestState: "submitted",
        events: [],
      };
    }
    groups[taskId].events.push(ev);

    const raw = ev.raw;
    if (raw.kind === "task") {
      const task = raw as A2ATask;
      groups[taskId].contextId = task.contextId;
      groups[taskId].latestState = task.status.state;
    } else if (raw.kind === "status-update") {
      const su = raw as A2AStatusUpdate;
      groups[taskId].contextId = su.contextId;
      groups[taskId].latestState = su.status.state;
    }
  }

  return Object.values(groups);
}

interface EventPanelProps {
  events: A2AEventRecord[];
  highlightedTaskId?: string | null;
  onHighlightTask?: (taskId: string | null) => void;
}

export default function EventPanel({ events, highlightedTaskId, onHighlightTask }: EventPanelProps) {
  const [viewMode, setViewMode] = useState<"timeline" | "grouped">("timeline");
  const taskGroups = groupByTask(events);

  if (events.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-rh-gray-30 text-sm p-4">
        <div className="text-center">
          <svg className="w-8 h-8 mx-auto mb-2 text-rh-gray-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
          </svg>
          Events will appear here as the agent processes your messages.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-rh-gray-20">
        <span className="text-xs font-semibold text-rh-gray-60 uppercase tracking-wider">
          Events ({events.length})
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode("timeline")}
            className={`text-xs px-2 py-0.5 rounded ${viewMode === "timeline" ? "bg-rh-gray-80 text-white" : "text-rh-gray-40 hover:text-rh-gray-60"}`}
          >
            Timeline
          </button>
          <button
            onClick={() => setViewMode("grouped")}
            className={`text-xs px-2 py-0.5 rounded ${viewMode === "grouped" ? "bg-rh-gray-80 text-white" : "text-rh-gray-40 hover:text-rh-gray-60"}`}
          >
            Tasks
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {viewMode === "timeline" ? (
          events.map((ev) => (
            <EventCard
              key={ev.id}
              record={ev}
              isHighlighted={highlightedTaskId === ev.taskId}
              onHighlight={() => onHighlightTask?.(ev.taskId || null)}
            />
          ))
        ) : (
          taskGroups.map((group) => (
            <div key={group.taskId} className="mb-3">
              <div className="flex items-center gap-2 mb-1 px-1">
                <span className="text-xs font-medium text-rh-gray-60">
                  Task #{group.taskId.slice(0, 8)}
                </span>
                {statusBadge(group.latestState)}
                <span className="text-[10px] text-rh-gray-30">
                  {group.events.length} event{group.events.length !== 1 ? "s" : ""}
                </span>
              </div>
              {group.events.map((ev) => (
                <EventCard
                  key={ev.id}
                  record={ev}
                  isHighlighted={highlightedTaskId === ev.taskId}
                  onHighlight={() => onHighlightTask?.(ev.taskId || null)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
