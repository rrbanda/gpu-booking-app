"use client";

import { useState, useRef, useEffect } from "react";
import type { ChatMessage as ChatMsg } from "../../lib/a2a-types";
import ChatMessage from "./ChatMessage";
import StreamingIndicator from "./StreamingIndicator";

interface ChatPanelProps {
  messages: ChatMsg[];
  isStreaming: boolean;
  streamingLabel?: string;
  onSend: (text: string) => void;
  onEventClick?: (taskId: string) => void;
}

export default function ChatPanel({ messages, isStreaming, streamingLabel, onSend, onEventClick }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    if (!isStreaming) {
      inputRef.current?.focus();
    }
  }, [isStreaming]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    onSend(text);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-rh-red-10 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-rh-red-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <h3 className="text-lg font-rh-display font-semibold text-rh-gray-80 mb-1">GPU Booking Assistant</h3>
            <p className="text-sm text-rh-gray-40 max-w-sm">
              Ask me about GPU availability, make bookings, or check existing reservations. I have access to real-time data from the booking system.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-6 max-w-md w-full">
              {[
                "What GPUs are available today?",
                "Book a H200 GPU for tomorrow",
                "Show my current bookings",
                "What resource types are available?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                  className="text-left text-xs text-rh-gray-50 px-3 py-2 border border-rh-gray-20 rounded-lg hover:border-rh-red-50 hover:text-rh-red-50 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} onEventClick={onEventClick} />
        ))}

        {isStreaming && <StreamingIndicator label={streamingLabel} />}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-rh-gray-20 px-4 py-3 bg-white">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about GPU availability, bookings..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-rh-gray-20 px-4 py-2.5 text-sm focus:outline-none focus:border-rh-red-50 focus:ring-1 focus:ring-rh-red-50 max-h-32"
            style={{ minHeight: "42px" }}
            disabled={isStreaming}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isStreaming}
            className="h-[42px] px-4 bg-rh-red-50 hover:bg-rh-red-60 text-white rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            Send
          </button>
        </div>
        <p className="text-[10px] text-rh-gray-30 mt-1 text-center">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
