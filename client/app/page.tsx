"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getBookings, createBooking, cancelBooking, createBulkBooking } from "./actions";
import type { Booking, GPUResource } from "./actions";
import GpuUsagePanel from "./GpuUsagePanel";

const FALLBACK_GPU_RESOURCES: GPUResource[] = [
  { name: "H200 Full GPU", type: "nvidia.com/gpu", count: 8, share: 0.0625, gpuEquivalent: 1.0 },
  { name: "MIG 3g.71gb", type: "nvidia.com/mig-3g.71gb", count: 8, share: 0.03125, gpuEquivalent: 0.5 },
  { name: "MIG 2g.35gb", type: "nvidia.com/mig-2g.35gb", count: 8, share: 0.015625, gpuEquivalent: 0.25 },
  { name: "MIG 1g.18gb", type: "nvidia.com/mig-1g.18gb", count: 16, share: 0.0078125, gpuEquivalent: 0.125 },
];

const SLOT_TYPE = "full";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Default booking window - overridden by /api/config
const DEFAULT_BOOKING_WINDOW_DAYS = 30;

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayStr(): string {
  return formatDate(new Date());
}

function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
}

// Get all dates in a month as YYYY-MM-DD strings
function getMonthDates(year: number, month: number): string[] {
  const dates: string[] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(formatDate(new Date(year, month, d)));
  }
  return dates;
}

// Get the day-of-week offset for the first day of the month (Sunday=0)
function getMonthStartOffset(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

// Check if a date is within the allowed booking window (today + N days forward)
function isInBookingWindow(dateStr: string, windowDays: number): boolean {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + windowDays);
  return date >= today && date < maxDate;
}

// Check if a date is in the past
function isPastDate(dateStr: string): boolean {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date < today;
}

function ChevronLeftIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function GPUIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-4 h-4 text-rh-gray-40"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
    </svg>
  );
}

// Get the browser's UTC offset in hours for a given date
function getUtcOffsetHours(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return -new Date(y, m - 1, d).getTimezoneOffset() / 60;
}

const HOUR_OPTIONS = Array.from({ length: 25 }, (_, i) => i); // 0-24

function formatHour(h: number): string {
  if (h === 24) return "00:00 +1d";
  return `${String(h).padStart(2, "0")}:00`;
}

// Convert a UTC hour to local hour for a given date
function utcHourToLocal(utcHour: number, dateStr: string): number {
  const offset = getUtcOffsetHours(dateStr);
  if (utcHour === 24) return 24;
  return ((utcHour + Math.round(offset)) % 24 + 24) % 24;
}

interface BookingModalProps {
  startDate: string;
  endDate: string;
  bookings: Booking[];
  editBooking?: Booking;
  gpuResources: GPUResource[];
  onClose: () => void;
  onSubmit: (resources: Record<string, number>, startDate: string, endDate: string, description: string, startHourUtc: number, endHourUtc: number) => Promise<void>;
}

function BookingModal({ startDate, endDate, bookings, editBooking, gpuResources, onClose, onSubmit }: BookingModalProps) {
  const [resources, setResources] = useState<Record<string, number>>(
    editBooking ? { [editBooking.resource]: 1 } : {}
  );
  const [start, setStart] = useState(editBooking?.date || startDate);
  const [end, setEnd] = useState(editBooking?.date || endDate);
  const [startHourLocal, setStartHourLocal] = useState(
    editBooking ? utcHourToLocal(editBooking.startHour, editBooking.date) : 0
  );
  const [endHourLocal, setEndHourLocal] = useState(
    editBooking ? utcHourToLocal(editBooking.endHour, editBooking.date) : 24
  );
  const [description, setDescription] = useState(editBooking?.description || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const utcOffset = getUtcOffsetHours(start);

  const adjustCount = (type: string, delta: number) => {
    setResources((prev) => {
      const current = prev[type] || 0;
      const next = Math.max(0, current + delta);
      if (next === 0) {
        const { [type]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [type]: next };
    });
  };

  // Calculate available units per resource for the date range
  const getMaxAvailable = (resourceType: string): number => {
    const gpu = gpuResources.find((r) => r.type === resourceType);
    if (!gpu) return 0;

    // Find the date in the range with the fewest available slots
    const [sy, sm, sd] = start.split("-").map(Number);
    const [ey, em, ed] = end.split("-").map(Number);
    const startD = new Date(sy, sm - 1, sd);
    const endD = new Date(ey, em - 1, ed);

    let minAvail = gpu.count;
    for (const d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      const dateStr = formatDate(d);
      // Only reserved bookings block availability — consumed ones can be overridden
      const reservedCount = bookings.filter(
        (b) => b.resource === resourceType && b.date === dateStr && b.slotType === "full" && b.source === "reserved"
      ).length;
      minAvail = Math.min(minAvail, gpu.count - reservedCount);
    }
    return Math.max(0, minAvail);
  };

  const totalResources = Object.values(resources).reduce((s, c) => s + c, 0);

  // Convert local hours to UTC
  const startHourUtc = ((startHourLocal - Math.round(utcOffset)) % 24 + 24) % 24;
  const endHourUtc = endHourLocal === 24 ? 24 : ((endHourLocal - Math.round(utcOffset)) % 24 + 24) % 24;
  const isFullDay = startHourLocal === 0 && endHourLocal === 24;

  const handleSubmit = async () => {
    if (totalResources === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(resources, start, end, description, isFullDay ? 0 : startHourUtc, isFullDay ? 24 : endHourUtc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create bookings");
      setSubmitting(false);
    }
  };

  // Calculate GPU equivalents for the selection
  const gpuEquivMap: Record<string, number> = {};
  for (const r of gpuResources) gpuEquivMap[r.type] = r.gpuEquivalent;

  const gpuEquivTotal = Object.entries(resources).reduce(
    (sum, [type, count]) => sum + count * (gpuEquivMap[type] || 0), 0
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-rh-gray-95 text-white px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-rh-display font-bold">{editBooking ? "Edit Reservation" : "Book GPU Resources"}</h2>
            <button onClick={onClose} className="text-rh-gray-30 hover:text-white transition-colors text-xl leading-none">&times;</button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Date range */}
          <div>
            <label className="block text-sm font-semibold text-rh-gray-70 mb-2">Date Range</label>
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="flex-1 px-3 py-2 border border-rh-gray-20 rounded-lg text-sm focus:outline-none focus:border-rh-red-50 focus:ring-1 focus:ring-rh-red-50"
              />
              <span className="text-rh-gray-40 text-sm">to</span>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="flex-1 px-3 py-2 border border-rh-gray-20 rounded-lg text-sm focus:outline-none focus:border-rh-red-50 focus:ring-1 focus:ring-rh-red-50"
              />
            </div>
          </div>

          {/* Hours */}
          <div>
            <label className="block text-sm font-semibold text-rh-gray-70 mb-2">
              Hours
              <span className="font-normal text-rh-gray-40 ml-1">
                (local time, UTC{utcOffset >= 0 ? "+" : ""}{utcOffset})
              </span>
            </label>
            <div className="flex items-center gap-3">
              <select
                value={startHourLocal}
                onChange={(e) => setStartHourLocal(Number(e.target.value))}
                className="flex-1 px-3 py-2 border border-rh-gray-20 rounded-lg text-sm focus:outline-none focus:border-rh-red-50 focus:ring-1 focus:ring-rh-red-50"
              >
                {HOUR_OPTIONS.filter((h) => h < 24).map((h) => (
                  <option key={h} value={h}>{formatHour(h)}</option>
                ))}
              </select>
              <span className="text-rh-gray-40 text-sm">to</span>
              <select
                value={endHourLocal}
                onChange={(e) => setEndHourLocal(Number(e.target.value))}
                className="flex-1 px-3 py-2 border border-rh-gray-20 rounded-lg text-sm focus:outline-none focus:border-rh-red-50 focus:ring-1 focus:ring-rh-red-50"
              >
                {HOUR_OPTIONS.filter((h) => h > startHourLocal).map((h) => (
                  <option key={h} value={h}>{formatHour(h)}</option>
                ))}
              </select>
            </div>
            {!isFullDay && (
              <p className="text-xs text-rh-gray-40 mt-1">
                UTC: {formatHour(startHourUtc)} — {endHourUtc === 24 ? "00:00 +1d" : formatHour(endHourUtc)}
              </p>
            )}
          </div>

          {/* Resource selectors */}
          <div>
            <label className="block text-sm font-semibold text-rh-gray-70 mb-2">Resources</label>
            <div className="space-y-2">
              {gpuResources.map((r) => {
                const count = resources[r.type] || 0;
                const maxAvail = getMaxAvailable(r.type);
                const equiv = r.gpuEquivalent;

                return (
                  <div
                    key={r.type}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      count > 0 ? "border-rh-red-50 bg-rh-red-10/30" : "border-rh-gray-20 bg-white"
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium text-rh-gray-80">{r.name}</div>
                      <div className="text-xs text-rh-gray-40">
                        {maxAvail} of {r.count} available
                        {equiv < 1 && ` \u00b7 ${equiv} GPU equiv each`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => adjustCount(r.type, -1)}
                        disabled={count === 0}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-rh-gray-20 text-rh-gray-60 hover:bg-rh-gray-10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-lg font-bold"
                      >
                        -
                      </button>
                      <span className={`w-8 text-center font-rh-display font-bold text-lg ${count > 0 ? "text-rh-red-50" : "text-rh-gray-30"}`}>
                        {count}
                      </span>
                      <button
                        onClick={() => adjustCount(r.type, 1)}
                        disabled={count >= maxAvail}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-rh-gray-20 text-rh-gray-60 hover:bg-rh-gray-10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-lg font-bold"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {gpuEquivTotal > 0 && (
              <div className="mt-2 text-xs text-rh-gray-50 text-right">
                Total: {gpuEquivTotal % 1 === 0 ? gpuEquivTotal : gpuEquivTotal.toFixed(2)} GPU equivalents
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-rh-gray-70 mb-2">
              Description
              <span className="font-normal text-rh-gray-40 ml-1">({160 - description.length} chars remaining)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 160))}
              maxLength={160}
              rows={2}
              placeholder="What will you use these GPUs for?"
              className="w-full px-3 py-2 border border-rh-gray-20 rounded-lg text-sm focus:outline-none focus:border-rh-red-50 focus:ring-1 focus:ring-rh-red-50 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-rh-red-10 border border-rh-red-30 text-rh-red-60 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-rh-gray-60 hover:text-rh-gray-80 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || totalResources === 0}
              className="px-6 py-2 bg-rh-red-50 hover:bg-rh-red-60 text-white text-sm font-semibold rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {editBooking ? "Saving..." : "Booking..."}
                </>
              ) : editBooking ? (
                "Save Changes"
              ) : (
                `Book ${totalResources} resource${totalResources !== 1 ? "s" : ""}`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BookingPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [reserving, setReserving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gpuResources, setGpuResources] = useState<GPUResource[]>(FALLBACK_GPU_RESOURCES);
  const [selectedResources, setSelectedResources] = useState<string[]>([FALLBACK_GPU_RESOURCES[0].type]);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [bookingWindowDays, setBookingWindowDays] = useState(DEFAULT_BOOKING_WINDOW_DAYS);
  const [utcNow, setUtcNow] = useState("");
  const [activeReservations, setActiveReservations] = useState<Record<string, string>>({});
  const [currentUser, setCurrentUser] = useState("");
  const dateRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const lastClickedDate = useRef<string | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [editBooking, setEditBooking] = useState<Booking | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showingMyBookings, setShowingMyBookings] = useState(false);

  // Month/year navigation (local timezone)
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDates, setSelectedDates] = useState<string[]>([todayStr()]);

  const selectedResourceObjects = gpuResources.filter((r) => selectedResources.includes(r.type));
  const monthDates = getMonthDates(viewYear, viewMonth);
  const monthStartOffset = getMonthStartOffset(viewYear, viewMonth);

  // Grid only shows selected dates
  const gridDates = useMemo(() => [...selectedDates].sort(), [selectedDates]);

  const gpuEquivalentMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of gpuResources) m[r.type] = r.gpuEquivalent;
    return m;
  }, [gpuResources]);

  const totalGpuEquivalents = useMemo(
    () => gpuResources.reduce((sum, r) => sum + r.count * r.gpuEquivalent, 0),
    [gpuResources]
  );

  const fetchBookings = useCallback(async () => {
    const result = await getBookings();
    if (result.success) {
      setBookings(result.data);
      setActiveReservations(result.activeReservations);
      setCurrentUser(result.currentUser);
    }
    setLoading(false);
  }, []);

  // Fetch config on mount
  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => {
        if (data.bookingWindowDays) {
          setBookingWindowDays(data.bookingWindowDays);
        }
        if (Array.isArray(data.resources) && data.resources.length > 0) {
          setGpuResources(data.resources);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchBookings();
    const interval = setInterval(fetchBookings, 30000);
    return () => clearInterval(interval);
  }, [fetchBookings]);

  useEffect(() => {
    function updateClock() {
      const n = new Date();
      setUtcNow(n.toLocaleString(undefined, {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        timeZoneName: "short",
      }));
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Close context menu on any click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  // Generate all dates between two YYYY-MM-DD strings (inclusive, sorted)
  const getDateRange = (a: string, b: string): string[] => {
    const [startStr, endStr] = a < b ? [a, b] : [b, a];
    const [sy, sm, sd] = startStr.split("-").map(Number);
    const [ey, em, ed] = endStr.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    const dates: string[] = [];
    for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
      dates.push(formatDate(cur));
    }
    return dates;
  };

  const handleCalendarClick = (dateStr: string, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedDate.current) {
      // Shift+click: select range from last clicked to this date
      const range = getDateRange(lastClickedDate.current, dateStr);
      if (e.ctrlKey || e.metaKey) {
        // Shift+Ctrl: add range to existing selection
        setSelectedDates((prev) => Array.from(new Set([...prev, ...range])));
      } else {
        setSelectedDates(range);
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle date in selection
      setSelectedDates((prev) =>
        prev.includes(dateStr)
          ? prev.filter((d) => d !== dateStr)
          : [...prev, dateStr]
      );
    } else {
      // Plain click: select single date
      setSelectedDates([dateStr]);
    }
    lastClickedDate.current = dateStr;
    setShowingMyBookings(false);
  };

  const navigateMonth = (delta: number) => {
    let newMonth = viewMonth + delta;
    let newYear = viewYear;
    if (newMonth > 11) {
      newMonth = 0;
      newYear++;
    } else if (newMonth < 0) {
      newMonth = 11;
      newYear--;
    }
    setViewMonth(newMonth);
    setViewYear(newYear);
    setSelectedDates([]);
  };

  // Navigation limits: back to earliest booking month, forward to end of booking window
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + bookingWindowDays);
  const earliestBooking = bookings.length > 0
    ? bookings.reduce((min, b) => b.date < min ? b.date : min, bookings[0].date)
    : null;
  const earliestDate = earliestBooking
    ? (() => { const [ey, em, ed] = earliestBooking.split("-").map(Number); return new Date(ey, em - 1, ed); })()
    : now;
  const canGoBack = viewYear > earliestDate.getFullYear() || (viewYear === earliestDate.getFullYear() && viewMonth > earliestDate.getMonth());
  const canGoForward = viewYear < maxDate.getFullYear() || (viewYear === maxDate.getFullYear() && viewMonth < maxDate.getMonth());

  const handleReserve = async (
    resource: string,
    slotIndex: number,
    date: string,
    slotType: string
  ) => {
    const key = `${resource}-${slotIndex}-${date}-${slotType}`;
    setReserving(key);
    setError(null);

    const result = await createBooking(resource, slotIndex, date, slotType);
    if (result.success) {
      await fetchBookings();
    } else {
      setError(
        result.error === "slot_taken"
          ? "This slot was just taken by someone else. Please choose another."
          : result.error
      );
    }
    setReserving(null);
  };

  const handleCancel = async (id: string) => {
    setError(null);
    const result = await cancelBooking(id);
    if (result.success) {
      setConfirmCancel(null);
      await fetchBookings();
    } else {
      setError(result.error);
    }
  };

  const handleCalendarContextMenu = (dateStr: string, e: React.MouseEvent) => {
    e.preventDefault();
    // Ensure the right-clicked date is in the selection
    if (!selectedDates.includes(dateStr)) {
      setSelectedDates([dateStr]);
    }
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleBulkBooking = async (
    resources: Record<string, number>,
    startDate: string,
    endDate: string,
    description: string,
    startHourUtc: number,
    endHourUtc: number
  ) => {
    // If editing, cancel the old booking first
    if (editBooking) {
      const cancelResult = await cancelBooking(editBooking.id);
      if (!cancelResult.success) {
        throw new Error("Failed to cancel original booking");
      }
    }

    const result = await createBulkBooking(resources, startDate, endDate, description, startHourUtc, endHourUtc);
    if (result.success) {
      setShowBookingModal(false);
      setEditBooking(null);
      await fetchBookings();
    } else {
      // If edit failed after cancel, re-fetch to show current state
      if (editBooking) await fetchBookings();
      throw new Error(result.error);
    }
  };

  const handleShowMyBookings = () => {
    if (!currentUser) return;
    if (showingMyBookings) {
      // Toggle off: return to today
      setShowingMyBookings(false);
      setViewMonth(now.getMonth());
      setViewYear(now.getFullYear());
      setSelectedDates([todayStr()]);
      return;
    }
    const myDates = Array.from(
      new Set(bookings.filter((b) => b.user === currentUser && b.source === "reserved").map((b) => b.date))
    ).sort();
    if (myDates.length === 0) return;
    // Navigate calendar to the month of the earliest booking
    const [fy, fm] = myDates[0].split("-").map(Number);
    setViewYear(fy);
    setViewMonth(fm - 1);
    setSelectedDates(myDates);
    setShowingMyBookings(true);
  };

  const handleEditBooking = (booking: Booking) => {
    setEditBooking(booking);
    setShowBookingModal(true);
  };

  const getBooking = (
    resource: string,
    slotIndex: number,
    date: string,
    slotType: string
  ): Booking | undefined => {
    return bookings.find(
      (b) =>
        b.resource === resource &&
        b.slotIndex === slotIndex &&
        b.date === date &&
        b.slotType === slotType
    );
  };

  // Calculate GPU equivalent usage for a date (unique units booked per resource, weighted)
  const getDateGpuUsage = (date: string): number => {
    let total = 0;
    for (const r of gpuResources) {
      const units = new Set(
        bookings.filter((b) => b.resource === r.type && b.date === date).map((b) => b.slotIndex)
      );
      total += units.size * (gpuEquivalentMap[r.type] || 0);
    }
    return total;
  };


  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-rh-red-50 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-rh-gray-50 font-rh-text">Loading booking system...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="relative bg-rh-gray-95 text-white overflow-hidden">
        <div className="rh-hero-accent" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-rh-display font-bold tracking-tight">
                GPU Resource Booking
              </h1>
              <p className="mt-2 text-rh-gray-30">
                Reserve H200 GPU resources with MIG partitioning
              </p>
              <p className="font-mono text-rh-gray-40 text-sm mt-1">{utcNow}</p>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-rh-gray-80 hover:bg-rh-gray-70 rounded-lg transition-colors text-sm"
              >
                <HelpIcon />
                Help
              </a>
              {currentUser && (
                <button
                  onClick={handleShowMyBookings}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                    showingMyBookings
                      ? "bg-rh-red-50 ring-2 ring-rh-red-30"
                      : "bg-rh-gray-80 hover:bg-rh-gray-70"
                  }`}
                >
                  <UserIcon className="w-4 h-4" />
                  My Bookings
                </button>
              )}
              <button
                onClick={() => { setLoading(true); fetchBookings(); }}
                className="flex items-center gap-2 px-4 py-2 bg-rh-gray-80 hover:bg-rh-gray-70 rounded-lg transition-colors text-sm"
              >
                <RefreshIcon />
                Refresh
              </button>
            </div>
          </div>

          {/* Resource selector (Ctrl+click to multi-select) */}
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            {gpuResources.map((r) => {
              const isSelected = selectedResources.includes(r.type);
              return (
                <div
                  key={r.type}
                  className={`p-3 rounded-lg cursor-pointer transition-all ${
                    isSelected
                      ? "bg-rh-red-50 ring-2 ring-rh-red-30"
                      : "bg-rh-gray-80 hover:bg-rh-gray-70"
                  }`}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      setSelectedResources((prev) =>
                        prev.includes(r.type)
                          ? prev.length > 1 ? prev.filter((t) => t !== r.type) : prev
                          : [...prev, r.type]
                      );
                    } else {
                      setSelectedResources([r.type]);
                    }
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <GPUIcon />
                    <span className="text-sm font-semibold">{r.name}</span>
                  </div>
                  <div className="text-xs text-rh-gray-30">
                    {r.count} units available per slot
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-rh-red-10 border border-rh-red-30 text-rh-red-60 px-4 py-3 rounded-lg flex items-center justify-between">
            <span className="text-sm">{error}</span>
            <button onClick={() => setError(null)} className="text-rh-red-50 hover:text-rh-red-60 font-bold">
              &times;
            </button>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* GPU Usage Overview */}
        <GpuUsagePanel
          bookings={bookings}
          resources={gpuResources}
          selectedDate={selectedDates[0] || todayStr()}
        />

        {/* Month/Year Calendar */}
        <div className="bg-white rounded-xl shadow-sm border border-rh-gray-20 p-5 mb-6">
          {/* Month/Year header with navigation */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => navigateMonth(-1)}
              disabled={!canGoBack}
              className="p-2 rounded-lg hover:bg-rh-gray-10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeftIcon />
            </button>
            <div className="text-center">
              <h2 className="text-xl font-rh-display font-bold text-rh-gray-90">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </h2>
              <p className="text-xs text-rh-gray-40 mt-0.5">
                Booking window: {bookingWindowDays} days from today
              </p>
            </div>
            <button
              onClick={() => navigateMonth(1)}
              disabled={!canGoForward}
              className="p-2 rounded-lg hover:bg-rh-gray-10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRightIcon />
            </button>
          </div>

          {/* Day of week headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAY_HEADERS.map((d) => (
              <div key={d} className="text-center text-xs font-semibold text-rh-gray-40 uppercase tracking-wider py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Empty cells before first day */}
            {Array.from({ length: monthStartOffset }, (_, i) => (
              <div key={`empty-${i}`} className="h-16" />
            ))}

            {/* Day cells */}
            {monthDates.map((date) => {
              const [, , dd] = date.split("-").map(Number);
              const dayNum = dd;
              const today = date === todayStr();
              const weekend = isWeekend(date);
              const bookable = isInBookingWindow(date, bookingWindowDays);
              const gpuUsage = getDateGpuUsage(date);
              const hasBookings = bookings.some((b) => b.date === date);
              const past = isPastDate(date);
              const clickable = bookable || (past && hasBookings);
              const isSelected = selectedDates.includes(date);

              return (
                <button
                  key={date}
                  onClick={(e) => clickable && handleCalendarClick(date, e)}
                  onContextMenu={(e) => clickable && !past && handleCalendarContextMenu(date, e)}
                  disabled={!clickable}
                  className={`relative h-16 flex flex-col items-center justify-center rounded-lg border transition-all ${
                    isSelected
                      ? "border-rh-red-50 bg-rh-red-10 ring-2 ring-rh-red-50/30"
                      : today
                      ? "border-rh-red-50 bg-rh-red-10/50"
                      : past && hasBookings
                      ? "border-rh-gray-20 bg-rh-gray-10/50 hover:bg-rh-gray-10 hover:border-rh-gray-30"
                      : bookable
                      ? weekend
                        ? "border-rh-gray-20 bg-rh-gray-10/30 hover:bg-rh-gray-10 hover:border-rh-gray-30"
                        : "border-rh-gray-20 bg-white hover:bg-rh-gray-10 hover:border-rh-gray-30"
                      : "border-transparent bg-rh-gray-10/20 opacity-40 cursor-not-allowed"
                  }`}
                >
                  {today && (
                    <span className="absolute top-0.5 right-1 text-[8px] font-bold text-rh-red-50">
                      TODAY
                    </span>
                  )}
                  <span className={`text-lg font-rh-display font-bold ${
                    isSelected
                      ? "text-rh-red-50"
                      : today
                      ? "text-rh-red-50"
                      : past && hasBookings
                      ? "text-rh-gray-50"
                      : bookable
                      ? weekend ? "text-rh-gray-40" : "text-rh-gray-90"
                      : "text-rh-gray-30"
                  }`}>
                    {dayNum}
                  </span>
                  {(bookable || (past && hasBookings)) && gpuUsage > 0 && (
                    <span className={`text-[9px] px-1.5 py-0 rounded-full mt-0.5 ${
                      gpuUsage >= totalGpuEquivalents
                        ? "bg-rh-red-50 text-white"
                        : "bg-rh-gray-80 text-white"
                    }`}>
                      {gpuUsage % 1 === 0 ? gpuUsage : gpuUsage.toFixed(1)}/{totalGpuEquivalents}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Today button */}
          {(viewMonth !== now.getMonth() || viewYear !== now.getFullYear()) && (
            <div className="mt-3 text-center">
              <button
                onClick={() => {
                  setViewMonth(now.getMonth());
                  setViewYear(now.getFullYear());
                  setSelectedDates([todayStr()]);
                }}
                className="text-sm text-rh-red-50 hover:text-rh-red-60 font-medium"
              >
                Back to today
              </button>
            </div>
          )}
        </div>

        {/* Legend + selection info */}
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-rh-gray-50">
            {selectedDates.length === 0
              ? "Click a date to view"
              : `${selectedDates.length} date${selectedDates.length > 1 ? "s" : ""} selected`}
            <span className="ml-1 text-rh-gray-30">(Ctrl+click to multi-select, Shift+click for range)</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-rh-gray-50">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-green-600 rounded" />
              <span>Available</span>
            </div>
            <div className="flex items-center gap-1.5">
              <UserIcon />
              <span>Booked</span>
            </div>
          </div>
        </div>

        {/* Booking Grids - one per selected resource */}
        {gridDates.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-rh-gray-20 p-12 text-center mb-8">
            <p className="text-rh-gray-40 text-lg">No dates selected</p>
            <p className="text-rh-gray-30 text-sm mt-1">Click a date in the calendar above to view bookings.</p>
          </div>
        ) : (
          selectedResourceObjects.map((currentResource) => (
          <div key={currentResource.type} className="bg-white rounded-xl shadow-sm border border-rh-gray-20 overflow-hidden animate-fade-in-up mb-6">
            <div className="px-4 py-3 bg-rh-gray-10 border-b border-rh-gray-20">
              <h3 className="text-base font-rh-display font-semibold text-rh-gray-90 flex items-center gap-2">
                <GPUIcon />
                {currentResource.name}
                <span className="text-sm font-normal text-rh-gray-50">
                  ({currentResource.count} units)
                </span>
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-rh-red-50">
                    <th className="px-4 py-3 text-left text-sm font-rh-display font-semibold text-rh-gray-70 bg-rh-gray-10 min-w-[180px] sticky left-0 z-10">
                      Date / Slot
                    </th>
                    {Array.from({ length: currentResource.count }, (_, i) => (
                      <th
                        key={i}
                        className="px-3 py-3 text-center text-sm font-rh-display font-semibold text-rh-gray-70 bg-rh-gray-10 min-w-[120px]"
                      >
                        Unit {i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gridDates.map((date) => {
                    const [dy, dm, dd2] = date.split("-").map(Number);
                    const dateObj = new Date(dy, dm - 1, dd2);
                    const today = date === todayStr();
                    const weekend = isWeekend(date);
                    const past = isPastDate(date);
                    const fullDisplay = dateObj.toLocaleDateString("en-GB", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    });

                    const dateBookingCount = bookings.filter(
                      (b) => b.resource === currentResource.type && b.date === date && b.slotType === SLOT_TYPE
                    ).length;

                    return [
                      /* Date header row */
                      <tr
                        key={`header-${currentResource.type}-${date}`}
                        ref={(el) => { dateRefs.current[date] = el; }}
                        className={`${
                          today
                            ? "bg-rh-red-50"
                            : past
                            ? "bg-rh-gray-50"
                            : weekend
                            ? "bg-rh-gray-40"
                            : "bg-rh-gray-80"
                        }`}
                      >
                        <td
                          colSpan={currentResource.count + 1}
                          className="px-4 py-2.5"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-white font-rh-display font-bold text-base">
                              {fullDisplay}
                            </span>
                            {today && (
                              <span className="bg-white text-rh-red-50 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                TODAY
                              </span>
                            )}
                            {past && (
                              <span className="bg-white/20 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                                HISTORY
                              </span>
                            )}
                            {!past && weekend && (
                              <span className="bg-white/20 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                                WEEKEND
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>,

                      /* Unit cells row */
                      <tr
                        key={`${currentResource.type}-${date}-full`}
                        className={`border-b border-rh-gray-30 transition-colors hover:bg-rh-gray-10/50 ${weekend ? "bg-rh-gray-10/30" : ""}`}
                      >
                        <td className={`px-4 py-3 sticky left-0 z-10 ${weekend ? "bg-rh-gray-10/80" : "bg-white"}`}>
                          <div className="flex items-center gap-1 text-xs text-rh-gray-40">
                            <GPUIcon />
                            <span className={`font-medium ${
                              currentResource.count - dateBookingCount === 0
                                ? "text-rh-red-50"
                                : "text-green-600"
                            }`}>
                              {currentResource.count - dateBookingCount}
                            </span>
                            <span>/ {currentResource.count} available</span>
                          </div>
                        </td>

                        {Array.from({ length: currentResource.count }, (_, unitIdx) => {
                          const booking = getBooking(currentResource.type, unitIdx, date, SLOT_TYPE);
                          const cellKey = `${currentResource.type}-${unitIdx}-${date}-${SLOT_TYPE}`;
                          const isReserving = reserving === cellKey;

                          return (
                            <td key={unitIdx} className={`px-2 py-3 text-center ${past ? "opacity-70" : ""}`}>
                              {booking ? (
                                <div className="relative group" title={booking.description || undefined}>
                                  <div className="text-sm font-medium text-rh-gray-80">
                                    {booking.user}
                                  </div>
                                  {booking.description && (
                                    <div className="text-[10px] text-rh-gray-40 truncate max-w-[100px]" title={booking.description}>
                                      {booking.description}
                                    </div>
                                  )}
                                  {(booking.startHour !== 0 || booking.endHour !== 24) && (
                                    <div className="text-[10px] text-rh-gray-40">
                                      {formatHour(booking.startHour)}—{booking.endHour === 24 ? "00:00" : formatHour(booking.endHour)} UTC
                                    </div>
                                  )}
                                  {past ? (
                                    <span className="text-[10px] text-rh-gray-40">
                                      {booking.source === "consumed" ? "⚡ consumed" : activeReservations[booking.user] ? `🐍 ${activeReservations[booking.user]}` : ""}
                                    </span>
                                  ) : booking.source === "consumed" ? (
                                    <div>
                                      <span className="text-[10px] text-blue-600 opacity-60">
                                        ⚡ consumed
                                      </span>
                                      <button
                                        onClick={() =>
                                          handleReserve(currentResource.type, unitIdx, date, SLOT_TYPE)
                                        }
                                        disabled={isReserving}
                                        className="block mx-auto mt-1 px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        {isReserving ? (
                                          <span className="flex items-center gap-1">
                                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            ...
                                          </span>
                                        ) : (
                                          "Override"
                                        )}
                                      </button>
                                    </div>
                                  ) : activeReservations[booking.user] ? (
                                    <div>
                                      <span className="text-[10px] text-green-600">
                                        🐍 {activeReservations[booking.user]}
                                      </span>
                                      {confirmCancel === booking.id ? (
                                        <div className="flex gap-1 mt-1 justify-center">
                                          <button
                                            onClick={() => handleCancel(booking.id)}
                                            className="text-xs px-2 py-0.5 bg-rh-red-50 text-white rounded hover:bg-rh-red-60 transition-colors"
                                          >
                                            Confirm
                                          </button>
                                          <button
                                            onClick={() => setConfirmCancel(null)}
                                            className="text-xs px-2 py-0.5 bg-rh-gray-20 text-rh-gray-60 rounded hover:bg-rh-gray-30 transition-colors"
                                          >
                                            No
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="flex gap-1 mt-1 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                          <button
                                            onClick={() => handleEditBooking(booking)}
                                            className="text-xs text-rh-gray-40 hover:text-blue-600"
                                          >
                                            Edit
                                          </button>
                                          <button
                                            onClick={() => setConfirmCancel(booking.id)}
                                            className="text-xs text-rh-gray-40 hover:text-rh-red-50"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  ) : confirmCancel === booking.id ? (
                                    <div className="flex gap-1 mt-1 justify-center">
                                      <button
                                        onClick={() => handleCancel(booking.id)}
                                        className="text-xs px-2 py-0.5 bg-rh-red-50 text-white rounded hover:bg-rh-red-60 transition-colors"
                                      >
                                        Confirm
                                      </button>
                                      <button
                                        onClick={() => setConfirmCancel(null)}
                                        className="text-xs px-2 py-0.5 bg-rh-gray-20 text-rh-gray-60 rounded hover:bg-rh-gray-30 transition-colors"
                                      >
                                        No
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex gap-1 mt-1 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        onClick={() => handleEditBooking(booking)}
                                        className="text-xs text-rh-gray-40 hover:text-blue-600"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => setConfirmCancel(booking.id)}
                                        className="text-xs text-rh-gray-40 hover:text-rh-red-50"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ) : past ? (
                                <span className="text-xs text-rh-gray-30">—</span>
                              ) : (
                                <button
                                  onClick={() =>
                                    handleReserve(currentResource.type, unitIdx, date, SLOT_TYPE)
                                  }
                                  disabled={isReserving}
                                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {isReserving ? (
                                    <span className="flex items-center gap-1">
                                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                      ...
                                    </span>
                                  ) : (
                                    "Reserve"
                                  )}
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>,
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </div>
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white rounded-lg shadow-xl border border-rh-gray-20 py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              setContextMenu(null);
              setShowBookingModal(true);
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-rh-gray-80 hover:bg-rh-red-10 hover:text-rh-red-50 transition-colors flex items-center gap-2"
          >
            <GPUIcon />
            Book GPU
          </button>
        </div>
      )}

      {/* Booking modal */}
      {showBookingModal && (selectedDates.length > 0 || editBooking) && (
        <BookingModal
          startDate={editBooking?.date || [...selectedDates].sort()[0]}
          endDate={editBooking?.date || [...selectedDates].sort()[selectedDates.length - 1]}
          bookings={bookings}
          editBooking={editBooking || undefined}
          gpuResources={gpuResources}
          onClose={() => { setShowBookingModal(false); setEditBooking(null); }}
          onSubmit={handleBulkBooking}
        />
      )}
    </div>
  );
}
