"use client";

import { useState } from "react";

interface ToolCallCardProps {
  text: string;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function AvailabilityCard({ data }: { data: Record<string, unknown> }) {
  const total = Number(data.total_slots) || 0;
  const free = Number(data.free_count) || 0;
  const reserved = Number(data.reserved_count) || 0;
  const consumed = Number(data.consumed_count) || 0;

  const freePercent = total > 0 ? (free / total) * 100 : 0;
  const reservedPercent = total > 0 ? (reserved / total) * 100 : 0;
  const consumedPercent = total > 0 ? (consumed / total) * 100 : 0;

  return (
    <div className="bg-rh-gray-10 rounded-lg p-3 border border-rh-gray-20 my-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-rh-gray-80">
          {String(data.resource_name || data.resource_type)}
        </span>
        <span className="text-xs text-rh-gray-40">{String(data.date)}</span>
      </div>

      <div className="h-3 bg-rh-gray-20 rounded-full overflow-hidden flex">
        {reservedPercent > 0 && (
          <div className="bg-rh-red-50 h-full" style={{ width: `${reservedPercent}%` }} />
        )}
        {consumedPercent > 0 && (
          <div className="bg-amber-500 h-full" style={{ width: `${consumedPercent}%` }} />
        )}
        {freePercent > 0 && (
          <div className="bg-green-500 h-full" style={{ width: `${freePercent}%` }} />
        )}
      </div>

      <div className="flex gap-4 mt-2 text-xs text-rh-gray-50">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-green-500 rounded-full" /> {free} free
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-rh-red-50 rounded-full" /> {reserved} reserved
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-amber-500 rounded-full" /> {consumed} consumed
        </span>
      </div>
    </div>
  );
}

function ConfigCard({ data }: { data: Record<string, unknown> }) {
  const resources = data.resources as Array<Record<string, unknown>> | undefined;
  if (!resources || !Array.isArray(resources)) return null;

  return (
    <div className="bg-rh-gray-10 rounded-lg p-3 border border-rh-gray-20 my-2">
      <div className="text-sm font-semibold text-rh-gray-80 mb-2">GPU Resources</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-rh-gray-40">
            <th className="text-left py-1">Resource</th>
            <th className="text-right py-1">Count</th>
            <th className="text-right py-1">GPU Equiv</th>
          </tr>
        </thead>
        <tbody>
          {resources.map((r, i) => (
            <tr key={i} className="border-t border-rh-gray-20">
              <td className="py-1 text-rh-gray-70">{String(r.name)}</td>
              <td className="py-1 text-right text-rh-gray-70">{String(r.count)}</td>
              <td className="py-1 text-right text-rh-gray-50">{String(r.gpuEquivalent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-xs text-rh-gray-40">
        Booking window: {String(data.bookingWindowDays)} days
      </div>
    </div>
  );
}

function BookingResultCard({ data }: { data: Record<string, unknown> }) {
  const status = data.status as string | undefined;
  const isDeleted = status === "deleted";

  if (isDeleted) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-3 my-2">
        <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Booking cancelled successfully
        </div>
      </div>
    );
  }

  if (!data.id) return null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 my-2">
      <div className="flex items-center gap-2 text-blue-700 text-sm font-medium mb-1">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Booking confirmed
      </div>
      <div className="grid grid-cols-2 gap-1 text-xs text-rh-gray-60">
        <span>Resource:</span>
        <span className="font-medium text-rh-gray-80">{String(data.resource)}</span>
        <span>Date:</span>
        <span className="font-medium text-rh-gray-80">{String(data.date)}</span>
        <span>Slot:</span>
        <span className="font-medium text-rh-gray-80">{String(data.slotIndex)}</span>
        {data.description ? (
          <>
            <span>Note:</span>
            <span className="font-medium text-rh-gray-80">{String(data.description)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function JsonViewer({ data }: { data: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-rh-gray-40 hover:text-rh-gray-60 flex items-center gap-1"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        {expanded ? "Hide" : "Show"} JSON
      </button>
      {expanded && (
        <pre className="mt-1 bg-rh-gray-10 border border-rh-gray-20 rounded-lg p-2 text-xs text-rh-gray-60 overflow-x-auto max-h-48">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function ToolCallCard({ text }: ToolCallCardProps) {
  const data = tryParseJson(text);
  if (!data) return null;

  if ("free_count" in data && "total_slots" in data) {
    return <AvailabilityCard data={data} />;
  }

  if ("resources" in data && "bookingWindowDays" in data) {
    return <ConfigCard data={data} />;
  }

  if (("id" in data && "resource" in data && "slotIndex" in data) || ("status" in data && data.status === "deleted")) {
    return <BookingResultCard data={data} />;
  }

  if ("error" in data) {
    return (
      <div className="bg-rh-red-10 border border-rh-red-30 rounded-lg p-3 my-2 text-sm text-rh-red-60">
        Error: {String(data.error)}
        {data.detail ? <span className="block text-xs mt-1">{JSON.stringify(data.detail)}</span> : null}
      </div>
    );
  }

  return <JsonViewer data={data} />;
}
