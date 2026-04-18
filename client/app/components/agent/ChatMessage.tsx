"use client";

import ReactMarkdown from "react-markdown";
import type { ChatMessage as ChatMsg } from "../../lib/a2a-types";
import ToolCallCard from "./ToolCallCard";

function UserAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-rh-gray-80 flex items-center justify-center flex-shrink-0">
      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
      </svg>
    </div>
  );
}

function AgentAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-rh-red-50 flex items-center justify-center flex-shrink-0">
      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    </div>
  );
}

function tryExtractToolResult(text: string): { plainText: string; jsonBlocks: string[] } {
  const jsonBlocks: string[] = [];
  let plainText = text;

  const jsonPattern = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
  let match;
  while ((match = jsonPattern.exec(text)) !== null) {
    jsonBlocks.push(match[1]);
    plainText = plainText.replace(match[0], "");
  }

  if (jsonBlocks.length === 0) {
    const standaloneJson = text.match(/^(\{[\s\S]*\})$/);
    if (standaloneJson) {
      try {
        JSON.parse(standaloneJson[1]);
        jsonBlocks.push(standaloneJson[1]);
        plainText = "";
      } catch {
        // not JSON
      }
    }
  }

  return { plainText: plainText.trim(), jsonBlocks };
}

export default function ChatMessage({ message, onEventClick }: { message: ChatMsg; onEventClick?: (taskId: string) => void }) {
  const isUser = message.role === "user";
  const { plainText, jsonBlocks } = isUser
    ? { plainText: message.text, jsonBlocks: [] }
    : tryExtractToolResult(message.text);

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {isUser ? <UserAvatar /> : <AgentAvatar />}

      <div className={`flex-1 max-w-[85%] ${isUser ? "flex flex-col items-end" : ""}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "bg-rh-gray-80 text-white rounded-tr-md"
              : "bg-white border border-rh-gray-20 text-rh-gray-80 rounded-tl-md shadow-sm"
          }`}
        >
          {plainText && (
            <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5">
              <ReactMarkdown>{plainText}</ReactMarkdown>
            </div>
          )}
        </div>

        {jsonBlocks.map((block, i) => (
          <div key={i} className="w-full">
            <ToolCallCard text={block} />
          </div>
        ))}

        <div className="flex items-center gap-2 mt-1 px-1">
          <span className="text-[10px] text-rh-gray-30">
            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {message.status && message.status !== "completed" && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              message.status === "working" ? "bg-amber-100 text-amber-700" :
              message.status === "failed" ? "bg-rh-red-10 text-rh-red-60" :
              message.status === "input-required" ? "bg-blue-100 text-blue-700" :
              "bg-rh-gray-10 text-rh-gray-50"
            }`}>
              {message.status}
            </span>
          )}
          {message.taskId && onEventClick && (
            <button
              onClick={() => onEventClick(message.taskId!)}
              className="text-[10px] text-rh-gray-30 hover:text-rh-red-50"
              title="View in event inspector"
            >
              #{message.taskId.slice(0, 8)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
