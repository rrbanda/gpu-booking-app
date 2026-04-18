"use client";

export default function StreamingIndicator({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-rh-gray-40 text-sm py-1">
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 bg-rh-red-50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-1.5 h-1.5 bg-rh-red-50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-1.5 h-1.5 bg-rh-red-50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
      <span>{label || "Agent is thinking..."}</span>
    </div>
  );
}
