"use client";

import { useMemo } from "react";
import type { Booking, GPUResource } from "./actions";

// Colors for each resource type
const RESOURCE_COLORS: Record<string, string> = {
  "nvidia.com/gpu": "#0066CC",
  "nvidia.com/mig-3g.71gb": "#5E40BE",
  "nvidia.com/mig-2g.35gb": "#009596",
  "nvidia.com/mig-1g.18gb": "#F0AB00",
};

const FREE_COLOR = "#D2D2D2";
const CONSUMED_COLOR = "#4CB140";
const RESERVED_COLOR = "#EE0000";

interface GpuUsagePanelProps {
  bookings: Booking[];
  resources: GPUResource[];
  selectedDate?: string;
}

interface ResourceUsage {
  resource: GPUResource;
  reservedCount: number;
  consumedCount: number;
  totalBooked: number;
  totalSlots: number;
}

// Get UTC date as YYYY-MM-DD
function utcDateStr(): string {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}-${String(n.getUTCDate()).padStart(2, "0")}`;
}

function localDateStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export default function GpuUsagePanel({
  bookings,
  resources,
  selectedDate,
}: GpuUsagePanelProps) {
  const today = selectedDate || localDateStr();

  // When viewing today and UTC date differs from local date, include both
  const utcToday = utcDateStr();
  const localToday = localDateStr();
  const showAdjacentUtcDate = today === localToday && utcToday !== localToday;
  const displayDates = showAdjacentUtcDate ? [today, utcToday] : [today];

  const usageData: ResourceUsage[] = useMemo(() => {
    return resources.map((r) => {
      const dayBookings = bookings.filter(
        (b) => b.resource === r.type && displayDates.includes(b.date)
      );
      // Count unique units that have any booking (not individual slot records)
      const bookedUnits = new Set<number>();
      const reservedUnits = new Set<number>();
      const consumedUnits = new Set<number>();
      for (const b of dayBookings) {
        bookedUnits.add(b.slotIndex);
        if (b.source === "consumed") {
          consumedUnits.add(b.slotIndex);
        } else {
          reservedUnits.add(b.slotIndex);
        }
      }

      return {
        resource: r,
        reservedCount: reservedUnits.size,
        consumedCount: consumedUnits.size,
        totalBooked: bookedUnits.size,
        totalSlots: r.count,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, resources, today, showAdjacentUtcDate]);

  const totalBooked = usageData.reduce((s, u) => s + u.totalBooked, 0);
  const totalSlots = usageData.reduce((s, u) => s + u.totalSlots, 0);

  const formatDate = (d: string) => {
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-rh-gray-20 p-5 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-rh-display font-bold text-rh-gray-90">
            GPU Usage Overview
          </h2>
          <p className="text-xs text-rh-gray-40 mt-0.5">
            {formatDate(today)}
            {showAdjacentUtcDate && <span className="text-rh-gray-30"> + {formatDate(utcToday)} (UTC)</span>}
            {" "}— {totalBooked} of {totalSlots} slots booked
          </p>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-rh-gray-50">
          <div className="flex items-center gap-1.5">
            <span style={{ color: CONSUMED_COLOR }}>●</span>
            <span>Consumed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{ color: RESERVED_COLOR }}>●</span>
            <span>Reserved</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{ color: FREE_COLOR }}>●</span>
            <span>Free</span>
          </div>
        </div>
      </div>

      {/* Bars per resource */}
      <div className="space-y-4">
        {usageData.map((usage) => {
          const { resource, reservedCount, consumedCount, totalSlots } = usage;
          const freeCount = totalSlots - reservedCount - consumedCount;
          const consumedPct = totalSlots > 0 ? (consumedCount / totalSlots) * 100 : 0;
          const reservedPct = totalSlots > 0 ? (reservedCount / totalSlots) * 100 : 0;
          const freePct = totalSlots > 0 ? (freeCount / totalSlots) * 100 : 0;

          return (
            <div key={resource.type}>
              {/* Label row */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ backgroundColor: RESOURCE_COLORS[resource.type] || "#888" }}
                  />
                  <span className="text-sm font-rh-display font-semibold text-rh-gray-80">
                    {resource.name}
                  </span>
                  <span className="text-xs text-rh-gray-40">
                    {resource.count} units
                  </span>
                </div>
                <span className="text-xs text-rh-gray-50">
                  {consumedCount + reservedCount} / {totalSlots} booked
                </span>
              </div>

              {/* Per-unit bar */}
              <div className="h-8 flex rounded overflow-hidden bg-rh-gray-10">
                {Array.from({ length: totalSlots }, (_, unitIdx) => {
                  const unitBookings = bookings.filter(
                    (b) => b.resource === resource.type && displayDates.includes(b.date) && b.slotIndex === unitIdx
                  );
                  const hasReserved = unitBookings.some((b) => b.source === "reserved");
                  const hasConsumed = unitBookings.some((b) => b.source === "consumed");
                  const color = hasReserved ? RESERVED_COLOR : hasConsumed ? CONSUMED_COLOR : FREE_COLOR;
                  const label = hasReserved ? "reserved" : hasConsumed ? "consumed" : "";

                  return (
                    <div
                      key={unitIdx}
                      className="h-full transition-all duration-300 relative group"
                      style={{ width: `${100 / totalSlots}%`, backgroundColor: color }}
                    >
                      {label && (
                        <div className="absolute inset-0 flex items-center justify-center text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                          {unitBookings[0]?.user}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Per-unit breakdown: small dots showing each unit's status */}
              <div className="flex gap-1 mt-1.5">
                {Array.from({ length: resource.count }, (_, unitIdx) => {
                  const unitBookings = bookings.filter(
                    (b) =>
                      b.resource === resource.type &&
                      displayDates.includes(b.date) &&
                      b.slotIndex === unitIdx
                  );
                  const hasReserved = unitBookings.some((b) => b.source === "reserved");
                  const hasConsumed = unitBookings.some((b) => b.source === "consumed");
                  const bookedSlots = unitBookings.length;

                  let bgColor = FREE_COLOR;
                  let opacity = "opacity-40";
                  if (hasReserved && hasConsumed) {
                    bgColor = RESERVED_COLOR;
                    opacity = "opacity-100";
                  } else if (hasReserved) {
                    bgColor = RESERVED_COLOR;
                    opacity = "opacity-100";
                  } else if (hasConsumed) {
                    bgColor = CONSUMED_COLOR;
                    opacity = "opacity-100";
                  }

                  return (
                    <div key={unitIdx} className="group relative flex-1">
                      <div
                        className={`h-2 rounded-sm ${opacity} transition-opacity`}
                        style={{ backgroundColor: bgColor }}
                      />
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-20">
                        <div className="bg-rh-gray-90 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
                          Unit {unitIdx + 1}: {bookedSlots > 0 ? `${bookedSlots} slot${bookedSlots > 1 ? "s" : ""} booked` : "free"}
                          {unitBookings.map((b) => (
                            <div key={b.id} className="text-rh-gray-30">
                              {b.user} ({b.slotType}) {b.source === "consumed" ? "⚡" : ""}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
