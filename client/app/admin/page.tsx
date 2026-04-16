"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { getAdminData, logoutAdmin, adminDeleteBooking, adminDeleteAllBookings, adminToggleReservationSync } from "../actions";
import type { Booking, BookingConfig } from "../actions";

type SortField = "id" | "user" | "resource" | "slotIndex" | "date" | "slotType" | "createdAt";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <svg className={`w-3 h-3 inline-block ml-1 ${active ? "text-rh-red-50" : "text-rh-gray-30"}`} viewBox="0 0 10 14" fill="currentColor">
      <path d={dir === "asc" || !active ? "M5 0L10 6H0L5 0Z" : ""} opacity={!active || dir === "asc" ? 1 : 0.3} />
      <path d={dir === "desc" || !active ? "M5 14L0 8H10L5 14Z" : ""} opacity={!active || dir === "desc" ? 1 : 0.3} />
    </svg>
  );
}

export default function AdminPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [reservationSync, setReservationSync] = useState(true);
  const [togglingSync, setTogglingSync] = useState(false);
  const [utcNow, setUtcNow] = useState("");

  // Filter
  const [filter, setFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<"all" | "reserved" | "consumed">("all");

  // Sort
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const fetchData = useCallback(async () => {
    const result = await getAdminData();
    if (result.success) {
      setBookings(result.data.bookings || []);
      setConfig(result.data.config);
      setReservationSync(result.data.reservationSyncEnabled);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

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

  const handleDelete = async (id: string) => {
    setDeleting(id);
    setError(null);
    const result = await adminDeleteBooking(id);
    if (result.success) {
      setConfirmDelete(null);
      await fetchData();
    } else {
      setError(result.error);
    }
    setDeleting(null);
  };

  const handleDeleteAll = async () => {
    setDeletingAll(true);
    setError(null);
    const result = await adminDeleteAllBookings();
    if (result.success) {
      setConfirmDeleteAll(false);
      await fetchData();
    } else {
      setError(result.error);
    }
    setDeletingAll(false);
  };

  const handleToggleReservationSync = async () => {
    setTogglingSync(true);
    setError(null);
    const result = await adminToggleReservationSync(!reservationSync);
    if (result.success) {
      setReservationSync(result.enabled);
    } else {
      setError(result.error);
    }
    setTogglingSync(false);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const slotLabel = (s: string) =>
    s === "am" ? "Morning" : s === "pm" ? "Afternoon" : "Full Day";

  const filteredAndSorted = useMemo(() => {
    const q = filter.toLowerCase().trim();

    let result = bookings;
    if (sourceFilter !== "all") {
      result = result.filter((b) => b.source === sourceFilter);
    }
    if (resourceFilter) {
      result = result.filter((b) => b.resource === resourceFilter);
    }
    if (q) {
      result = result.filter((b) =>
        b.id.toLowerCase().includes(q) ||
        b.user.toLowerCase().includes(q) ||
        b.resource.toLowerCase().includes(q) ||
        b.date.includes(q) ||
        slotLabel(b.slotType).toLowerCase().includes(q) ||
        b.email.toLowerCase().includes(q) ||
        (b.description || "").toLowerCase().includes(q)
      );
    }

    return [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "id":
          cmp = a.id.localeCompare(b.id);
          break;
        case "user":
          cmp = a.user.localeCompare(b.user);
          break;
        case "resource":
          cmp = a.resource.localeCompare(b.resource);
          break;
        case "slotIndex":
          cmp = a.slotIndex - b.slotIndex;
          break;
        case "date":
          cmp = a.date.localeCompare(b.date);
          break;
        case "slotType":
          cmp = a.slotType.localeCompare(b.slotType);
          break;
        case "createdAt":
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [bookings, filter, resourceFilter, sourceFilter, sortField, sortDir]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-rh-red-50 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const thClass = "px-4 py-3 text-left text-xs font-semibold text-rh-gray-50 uppercase cursor-pointer select-none hover:text-rh-gray-70 transition-colors";

  return (
    <div className="min-h-screen bg-rh-gray-10">
      <header className="bg-rh-gray-95 text-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-rh-display font-bold">GPU Booking Admin</h1>
          <p className="font-mono text-rh-gray-40 text-sm mt-0.5">{utcNow}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggleReservationSync}
            disabled={togglingSync}
            className={`text-sm px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 ${
              reservationSync
                ? "bg-green-700 hover:bg-green-600 text-white"
                : "bg-rh-red-50 hover:bg-rh-red-60 text-white"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${reservationSync ? "bg-green-300" : "bg-rh-red-30"}`} />
            Reservations {reservationSync ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            className="text-sm px-4 py-2 bg-rh-gray-70 hover:bg-rh-gray-60 rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <form action={logoutAdmin}>
            <button
              type="submit"
              className="text-sm px-4 py-2 bg-rh-gray-70 hover:bg-rh-gray-60 rounded-lg transition-colors"
            >
              Logout
            </button>
          </form>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 bg-rh-red-10 border border-rh-red-30 text-rh-red-60 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-rh-red-50 hover:text-rh-red-60 font-bold">
              &times;
            </button>
          </div>
        )}

        {/* Summary tiles */}
        {config && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {config.resources.map((r) => {
              const booked = bookings.filter((b) => b.resource === r.type).length;
              const isActive = resourceFilter === r.type;
              return (
                <button
                  key={r.type}
                  onClick={() => setResourceFilter(isActive ? null : r.type)}
                  className={`text-left rounded-xl shadow-sm border p-4 transition-all ${
                    isActive
                      ? "bg-rh-red-50 border-rh-red-60 text-white ring-2 ring-rh-red-30"
                      : "bg-white border-rh-gray-20 hover:border-rh-red-30 hover:shadow-md"
                  }`}
                >
                  <div className={`text-sm ${isActive ? "text-white/80" : "text-rh-gray-50"}`}>{r.name}</div>
                  <div className="text-2xl font-rh-display font-bold mt-1">{booked}</div>
                  <div className={`text-xs mt-1 ${isActive ? "text-white/60" : "text-rh-gray-40"}`}>
                    of {r.count} units &middot; active bookings
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Source filter */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-rh-gray-50 mr-1">Source:</span>
          {(["all", "reserved", "consumed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                sourceFilter === s
                  ? s === "reserved"
                    ? "bg-rh-gray-80 text-white"
                    : s === "consumed"
                    ? "bg-blue-600 text-white"
                    : "bg-rh-red-50 text-white"
                  : "bg-white border border-rh-gray-20 text-rh-gray-60 hover:border-rh-gray-40"
              }`}
            >
              {s === "all" ? "All" : s === "reserved" ? "Reserved" : "Consumed"}
              <span className="ml-1.5 text-xs opacity-70">
                {s === "all"
                  ? bookings.length
                  : bookings.filter((b) => b.source === s).length}
              </span>
            </button>
          ))}
        </div>

        {/* Bookings table */}
        <div className="bg-white rounded-xl shadow-sm border border-rh-gray-20 overflow-hidden">
          <div className="px-6 py-4 border-b border-rh-gray-20 flex items-center justify-between gap-4">
            <h2 className="text-lg font-rh-display font-semibold shrink-0">All Bookings</h2>
            <div className="flex items-center gap-3 flex-1 justify-end">
              <div className="relative max-w-sm flex-1">
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by user, date, resource..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-rh-gray-20 rounded-lg focus:outline-none focus:border-rh-red-50 focus:ring-1 focus:ring-rh-red-50 transition-colors"
                />
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-rh-gray-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                {filter && (
                  <button
                    onClick={() => setFilter("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-rh-gray-40 hover:text-rh-gray-60"
                  >
                    &times;
                  </button>
                )}
              </div>
              <span className="text-sm text-rh-gray-50 shrink-0">
                {filteredAndSorted.length}{filter || resourceFilter || sourceFilter !== "all" ? ` of ${bookings.length}` : ""} bookings
              </span>
              {bookings.length > 0 && (
                confirmDeleteAll ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={handleDeleteAll}
                      disabled={deletingAll}
                      className="text-xs px-3 py-1.5 bg-rh-red-50 text-white rounded-lg hover:bg-rh-red-60 transition-colors disabled:opacity-50"
                    >
                      {deletingAll ? "Deleting..." : `Delete all ${bookings.length}?`}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteAll(false)}
                      className="text-xs px-3 py-1.5 bg-rh-gray-20 text-rh-gray-60 rounded-lg hover:bg-rh-gray-30 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteAll(true)}
                    className="text-xs px-3 py-1.5 bg-rh-red-10 text-rh-red-50 rounded-lg hover:bg-rh-red-20 hover:text-rh-red-60 transition-colors shrink-0"
                  >
                    Delete All
                  </button>
                )
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-rh-gray-20 bg-rh-gray-10">
                  <th className={thClass} onClick={() => handleSort("id")}>
                    ID <SortIcon active={sortField === "id"} dir={sortDir} />
                  </th>
                  <th className={thClass} onClick={() => handleSort("user")}>
                    User <SortIcon active={sortField === "user"} dir={sortDir} />
                  </th>
                  <th className={thClass} onClick={() => handleSort("resource")}>
                    Resource <SortIcon active={sortField === "resource"} dir={sortDir} />
                  </th>
                  <th className={thClass} onClick={() => handleSort("slotIndex")}>
                    Unit <SortIcon active={sortField === "slotIndex"} dir={sortDir} />
                  </th>
                  <th className={thClass} onClick={() => handleSort("date")}>
                    Date <SortIcon active={sortField === "date"} dir={sortDir} />
                  </th>
                  <th className={thClass} onClick={() => handleSort("slotType")}>
                    Slot <SortIcon active={sortField === "slotType"} dir={sortDir} />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-rh-gray-50 uppercase">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-rh-gray-50 uppercase">Hours (UTC)</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-rh-gray-50 uppercase">Description</th>
                  <th className={thClass} onClick={() => handleSort("createdAt")}>
                    Created <SortIcon active={sortField === "createdAt"} dir={sortDir} />
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-rh-gray-50 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-rh-gray-40">
                      {filter ? "No bookings match your filter" : "No bookings yet"}
                    </td>
                  </tr>
                ) : (
                  filteredAndSorted.map((b) => (
                    <tr key={b.id} className="border-b border-rh-gray-20 hover:bg-rh-gray-10/50">
                      <td className="px-4 py-3 text-sm font-mono text-rh-gray-60">{b.id}</td>
                      <td className="px-4 py-3 text-sm font-medium">{b.user}</td>
                      <td className="px-4 py-3 text-sm">{b.resource}</td>
                      <td className="px-4 py-3 text-sm">{b.slotIndex + 1}</td>
                      <td className="px-4 py-3 text-sm">{b.date}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          b.slotType === "full"
                            ? "bg-blue-100 text-blue-700"
                            : b.slotType === "am"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-orange-100 text-orange-700"
                        }`}>
                          {slotLabel(b.slotType)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          b.source === "consumed"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-rh-gray-10 text-rh-gray-60 border border-rh-gray-20"
                        }`}>
                          {b.source === "consumed" ? "consumed" : "reserved"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-rh-gray-50">
                        {b.startHour === 0 && b.endHour === 24
                          ? "Full Day"
                          : `${String(b.startHour ?? 0).padStart(2, "0")}:00–${String(b.endHour ?? 24).padStart(2, "0")}:00`}
                      </td>
                      <td className="px-4 py-3 text-sm text-rh-gray-50 max-w-[200px] truncate" title={b.description || ""}>
                        {b.description || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-rh-gray-50">
                        {new Date(b.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {confirmDelete === b.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleDelete(b.id)}
                              disabled={deleting === b.id}
                              className="text-xs px-3 py-1.5 bg-rh-red-50 text-white rounded-lg hover:bg-rh-red-60 transition-colors disabled:opacity-50"
                            >
                              {deleting === b.id ? "Deleting..." : "Confirm"}
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-xs px-3 py-1.5 bg-rh-gray-20 text-rh-gray-60 rounded-lg hover:bg-rh-gray-30 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(b.id)}
                            className="text-xs px-3 py-1.5 bg-rh-red-10 text-rh-red-50 rounded-lg hover:bg-rh-red-20 hover:text-rh-red-60 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
