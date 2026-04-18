"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { ChatMessage as ChatMsg, A2AEvent, A2AEventRecord, A2AAgentCard, A2ATask, A2AStatusUpdate, A2AArtifactUpdate, A2ADirectMessage } from "../../lib/a2a-types";
import { streamMessage, fetchAgentCard } from "../../lib/a2a-client";
import ChatPanel from "./ChatPanel";
import EventPanel from "./EventPanel";

function extractText(event: A2AEvent): string {
  if (event.kind === "task") {
    const task = event as A2ATask;
    const parts = task.status.message?.parts || [];
    const artifactParts = task.artifacts?.flatMap(a => a.parts) || [];
    return [...parts, ...artifactParts]
      .filter(p => p.kind === "text")
      .map(p => p.text || "")
      .join("\n");
  }
  if (event.kind === "status-update") {
    const su = event as A2AStatusUpdate;
    return (su.status.message?.parts || [])
      .filter(p => p.kind === "text")
      .map(p => p.text || "")
      .join("\n");
  }
  if (event.kind === "artifact-update") {
    const au = event as A2AArtifactUpdate;
    return au.artifact.parts
      .filter(p => p.kind === "text")
      .map(p => p.text || "")
      .join("\n");
  }
  if (event.kind === "message") {
    const dm = event as A2ADirectMessage;
    return dm.parts
      .filter(p => p.kind === "text")
      .map(p => p.text || "")
      .join("\n");
  }
  return "";
}

function getTaskId(event: A2AEvent): string | undefined {
  if (event.kind === "task") return (event as A2ATask).id;
  if (event.kind === "status-update") return (event as A2AStatusUpdate).taskId;
  if (event.kind === "artifact-update") return (event as A2AArtifactUpdate).taskId;
  return undefined;
}

function getContextId(event: A2AEvent): string | undefined {
  if (event.kind === "task") return (event as A2ATask).contextId;
  if (event.kind === "status-update") return (event as A2AStatusUpdate).contextId;
  if (event.kind === "artifact-update") return (event as A2AArtifactUpdate).contextId;
  if (event.kind === "message") return (event as A2ADirectMessage).contextId;
  return undefined;
}

function getState(event: A2AEvent): ChatMsg["status"] {
  if (event.kind === "task") return (event as A2ATask).status.state;
  if (event.kind === "status-update") return (event as A2AStatusUpdate).status.state;
  return undefined;
}

export default function AgentView() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [events, setEvents] = useState<A2AEventRecord[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingLabel, setStreamingLabel] = useState<string | undefined>();
  const [showEvents, setShowEvents] = useState(true);
  const [agentCard, setAgentCard] = useState<A2AAgentCard | null>(null);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "error" | "checking">("checking");
  const [showAbout, setShowAbout] = useState(false);

  const contextIdRef = useRef<string | undefined>(undefined);
  const taskIdRef = useRef<string | undefined>(undefined);
  const currentAgentMsgIdRef = useRef<string | null>(null);
  const eventCounterRef = useRef(0);

  useEffect(() => {
    fetchAgentCard().then((card) => {
      if (card) {
        setAgentCard(card);
        setConnectionStatus("connected");
      } else {
        setConnectionStatus("error");
      }
    });
  }, []);

  const appendEvent = useCallback((event: A2AEvent, linkedMessageId?: string) => {
    const record: A2AEventRecord = {
      id: `evt-${++eventCounterRef.current}`,
      timestamp: new Date(),
      kind: event.kind,
      raw: event,
      taskId: getTaskId(event),
      linkedMessageId,
    };
    setEvents(prev => [...prev, record]);
  }, []);

  const handleSend = useCallback((text: string) => {
    const userMsg: ChatMsg = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    setStreamingLabel("Connecting to agent...");

    const agentMsgId = crypto.randomUUID();
    currentAgentMsgIdRef.current = agentMsgId;
    let accumulatedText = "";
    let latestTaskId: string | undefined;

    streamMessage(
      text,
      (event) => {
        appendEvent(event, agentMsgId);

        const eventText = extractText(event);
        const eventTaskId = getTaskId(event);
        const eventContextId = getContextId(event);
        const state = getState(event);

        if (eventTaskId) {
          latestTaskId = eventTaskId;
          taskIdRef.current = eventTaskId;
        }
        if (eventContextId) {
          contextIdRef.current = eventContextId;
        }

        if (state === "working") {
          setStreamingLabel("Agent is working...");
        } else if (state === "input-required") {
          setStreamingLabel(undefined);
        }

        if (eventText) {
          accumulatedText += (accumulatedText ? "\n" : "") + eventText;

          setMessages(prev => {
            const existing = prev.find(m => m.id === agentMsgId);
            if (existing) {
              return prev.map(m =>
                m.id === agentMsgId
                  ? { ...m, text: accumulatedText, status: state, taskId: latestTaskId, isStreaming: true }
                  : m
              );
            }
            return [...prev, {
              id: agentMsgId,
              role: "agent" as const,
              text: accumulatedText,
              timestamp: new Date(),
              status: state,
              taskId: latestTaskId,
              isStreaming: true,
            }];
          });
        } else if (state && state !== "working") {
          setMessages(prev => {
            const existing = prev.find(m => m.id === agentMsgId);
            if (existing) {
              return prev.map(m => m.id === agentMsgId ? { ...m, status: state, taskId: latestTaskId } : m);
            }
            return prev;
          });
        }
      },
      () => {
        setIsStreaming(false);
        setStreamingLabel(undefined);
        currentAgentMsgIdRef.current = null;

        setMessages(prev =>
          prev.map(m =>
            m.id === agentMsgId ? { ...m, isStreaming: false, status: "completed" } : m
          )
        );

        if (!accumulatedText) {
          setMessages(prev => {
            const existing = prev.find(m => m.id === agentMsgId);
            if (!existing) {
              return [...prev, {
                id: agentMsgId,
                role: "agent" as const,
                text: "I processed your request but didn't produce a text response.",
                timestamp: new Date(),
                status: "completed" as const,
                taskId: latestTaskId,
              }];
            }
            return prev;
          });
        }
      },
      (err) => {
        setIsStreaming(false);
        setStreamingLabel(undefined);
        currentAgentMsgIdRef.current = null;

        setMessages(prev => [...prev, {
          id: agentMsgId,
          role: "agent" as const,
          text: `Error: ${err}`,
          timestamp: new Date(),
          status: "failed" as const,
        }]);
      },
      contextIdRef.current,
      taskIdRef.current,
    );
  }, [appendEvent]);

  const handleEventClick = useCallback((taskId: string) => {
    setHighlightedTaskId(taskId);
    if (!showEvents) setShowEvents(true);
  }, [showEvents]);

  return (
    <>
    <header className="relative bg-rh-gray-95 text-white overflow-hidden">
      <div className="rh-hero-accent" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-rh-display font-bold tracking-tight">
          GPU Resource Booking
        </h1>
        <p className="mt-2 text-rh-gray-30">
          AI-powered assistant for GPU resource management
        </p>
      </div>
    </header>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-rh-display font-semibold text-rh-gray-80">AI Assistant</h2>
          <span className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${
            connectionStatus === "connected" ? "bg-green-100 text-green-700" :
            connectionStatus === "error" ? "bg-rh-red-10 text-rh-red-60" :
            "bg-rh-gray-10 text-rh-gray-50"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              connectionStatus === "connected" ? "bg-green-500" :
              connectionStatus === "error" ? "bg-rh-red-50" :
              "bg-rh-gray-40 animate-pulse"
            }`} />
            {connectionStatus === "connected" ? "Connected" :
             connectionStatus === "error" ? "Agent unavailable" : "Checking..."}
          </span>
          {agentCard && (
            <button
              onClick={() => setShowAbout(!showAbout)}
              className="text-xs text-rh-gray-40 hover:text-rh-gray-60"
            >
              About
            </button>
          )}
        </div>
        <button
          onClick={() => setShowEvents(!showEvents)}
          className={`text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
            showEvents
              ? "border-rh-red-50 text-rh-red-50 bg-rh-red-10"
              : "border-rh-gray-20 text-rh-gray-50 hover:border-rh-gray-30"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
          </svg>
          Events{events.length > 0 ? ` (${events.length})` : ""}
        </button>
      </div>

      {showAbout && agentCard && (
        <div className="mb-4 bg-white rounded-xl border border-rh-gray-20 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-rh-gray-80">{agentCard.name}</h3>
            {agentCard.version && <span className="text-xs text-rh-gray-40">v{agentCard.version}</span>}
          </div>
          {agentCard.description && <p className="text-sm text-rh-gray-50 mb-2">{agentCard.description}</p>}
          {agentCard.skills && agentCard.skills.length > 0 && (
            <div>
              <span className="text-xs font-medium text-rh-gray-60">Skills:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {agentCard.skills.map(skill => (
                  <span key={skill.id} className="text-xs bg-rh-gray-10 text-rh-gray-60 px-2 py-0.5 rounded-full" title={skill.description}>
                    {skill.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {agentCard.capabilities && (
            <div className="mt-2 flex gap-2">
              {agentCard.capabilities.streaming && (
                <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">streaming</span>
              )}
            </div>
          )}
        </div>
      )}

      <div className={`flex gap-4 ${showEvents ? "" : ""}`} style={{ height: "calc(100vh - 280px)", minHeight: "500px" }}>
        <div className={`bg-white rounded-xl border border-rh-gray-20 shadow-sm overflow-hidden flex flex-col ${
          showEvents ? "flex-1" : "w-full"
        }`}>
          <ChatPanel
            messages={messages}
            isStreaming={isStreaming}
            streamingLabel={streamingLabel}
            onSend={handleSend}
            onEventClick={handleEventClick}
          />
        </div>

        {showEvents && (
          <div className="w-80 bg-white rounded-xl border border-rh-gray-20 shadow-sm overflow-hidden flex-shrink-0">
            <EventPanel
              events={events}
              highlightedTaskId={highlightedTaskId}
              onHighlightTask={setHighlightedTaskId}
            />
          </div>
        )}
      </div>
    </div>
    </>
  );
}
