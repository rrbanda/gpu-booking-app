"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

const API_URL = process.env.API_URL || "http://0.0.0.0:8080";

export interface GPUResource {
  name: string;
  type: string;
  count: number;
  share: number;
  gpuEquivalent: number;
}

export interface BookingConfig {
  resources: GPUResource[];
  bookingWindowDays: number;
  totalCpu: number;
  totalMemory: number;
}

export interface Booking {
  id: string;
  user: string;
  email: string;
  resource: string;
  slotIndex: number;
  date: string;
  slotType: string;
  createdAt: string;
  source: string;
  description: string;
  startHour: number;
  endHour: number;
}

interface BookingResult {
  success: true;
  data: Booking;
}

interface BookingError {
  success: false;
  error: string;
}

interface BookingsListResult {
  success: true;
  data: Booking[];
  activeReservations: Record<string, string>;
  currentUser: string;
}

interface AdminData {
  bookings: Booking[];
  config: BookingConfig;
  totalSlots: number;
  reservationSyncEnabled: boolean;
}

interface AdminResult {
  success: true;
  data: AdminData;
}

interface AdminError {
  success: false;
  error: string;
}

async function getForwardedHeaders(): Promise<Record<string, string>> {
  const hdrs = await headers();
  const forwarded: Record<string, string> = {};
  const user = hdrs.get("x-forwarded-user");
  const email = hdrs.get("x-forwarded-email");
  if (user) forwarded["X-Forwarded-User"] = user;
  if (email) forwarded["X-Forwarded-Email"] = email;
  return forwarded;
}

export async function getBookings(): Promise<BookingsListResult | BookingError> {
  try {
    const fwd = await getForwardedHeaders();
    const res = await fetch(`${API_URL}/api/bookings`, {
      headers: fwd,
      cache: "no-store",
    });
    if (!res.ok) {
      return { success: false, error: "Failed to fetch bookings" };
    }
    const data = await res.json();
    return {
      success: true,
      data: data.bookings || [],
      activeReservations: data.activeReservations || {},
      currentUser: data.currentUser || "",
    };
  } catch {
    return { success: false, error: "Failed to connect to booking service" };
  }
}

export async function createBooking(
  resource: string,
  slotIndex: number,
  date: string,
  slotType: string
): Promise<BookingResult | BookingError> {
  try {
    const fwd = await getForwardedHeaders();
    const res = await fetch(`${API_URL}/api/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...fwd },
      body: JSON.stringify({ resource, slotIndex, date, slotType }),
    });

    if (!res.ok) {
      try {
        const body = await res.json();
        if (body.error === "slot_taken") {
          return { success: false, error: "slot_taken" };
        }
      } catch {
        // not JSON
      }
      return { success: false, error: "Failed to create booking" };
    }

    const data = await res.json();
    return { success: true, data };
  } catch {
    return { success: false, error: "Failed to connect to booking service" };
  }
}

export interface BulkBookingResult {
  success: true;
  data: { bookings: Booking[]; errors: string[] };
}

export async function createBulkBooking(
  resources: Record<string, number>,
  startDate: string,
  endDate: string,
  description: string,
  startHour: number,
  endHour: number
): Promise<BulkBookingResult | BookingError> {
  try {
    const fwd = await getForwardedHeaders();
    const res = await fetch(`${API_URL}/api/bookings/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...fwd },
      body: JSON.stringify({ resources, startDate, endDate, description, startHour, endHour }),
    });

    if (!res.ok) {
      try {
        const body = await res.json();
        if (body.error === "no_slots_available") {
          return { success: false, error: `No slots available: ${(body.details || []).join("; ")}` };
        }
        return { success: false, error: body.error || "Failed to create bookings" };
      } catch {
        return { success: false, error: "Failed to create bookings" };
      }
    }

    const data = await res.json();
    return { success: true, data };
  } catch {
    return { success: false, error: "Failed to connect to booking service" };
  }
}

export async function cancelBooking(id: string): Promise<BookingResult | BookingError> {
  try {
    const fwd = await getForwardedHeaders();
    const res = await fetch(`${API_URL}/api/bookings?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: fwd,
    });

    if (!res.ok) {
      return { success: false, error: "Failed to cancel booking" };
    }

    const data = await res.json();
    return { success: true, data };
  } catch {
    return { success: false, error: "Failed to connect to booking service" };
  }
}

export async function loginAdmin(
  password: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const res = await fetch(`${API_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      return { success: false, error: "Invalid password" };
    }

    const data = await res.json();
    const cookieStore = await cookies();
    cookieStore.set("booking-admin-session", data.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24,
    });

    return { success: true };
  } catch {
    return { success: false, error: "Failed to connect to server" };
  }
}

export async function logoutAdmin(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("booking-admin-session");
  redirect("/admin/login");
}

export async function adminDeleteBooking(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("booking-admin-session")?.value || "";
    const res = await fetch(
      `${API_URL}/api/admin?id=${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (res.status === 401) {
      return { success: false, error: "unauthorized" };
    }
    if (!res.ok) {
      return { success: false, error: "Failed to delete booking" };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Failed to connect to booking service" };
  }
}

export async function adminDeleteAllBookings(): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("booking-admin-session")?.value || "";
    const res = await fetch(`${API_URL}/api/admin`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      return { success: false, error: "unauthorized" };
    }
    if (!res.ok) {
      return { success: false, error: "Failed to delete all bookings" };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Failed to connect to booking service" };
  }
}

export async function adminToggleReservationSync(
  enabled: boolean
): Promise<{ success: true; enabled: boolean } | { success: false; error: string }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("booking-admin-session")?.value || "";
    const res = await fetch(`${API_URL}/api/admin/reservations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enabled }),
    });
    if (res.status === 401) {
      return { success: false, error: "unauthorized" };
    }
    if (!res.ok) {
      return { success: false, error: "Failed to toggle reservation sync" };
    }
    const data = await res.json();
    return { success: true, enabled: data.reservationSyncEnabled };
  } catch {
    return { success: false, error: "Failed to connect to booking service" };
  }
}

export async function adminExportDatabase(): Promise<
  { success: true; data: string; filename: string } | { success: false; error: string }
> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("booking-admin-session")?.value || "";
    const res = await fetch(`${API_URL}/api/admin/database/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      return { success: false, error: "unauthorized" };
    }
    if (!res.ok) {
      return { success: false, error: "Failed to export database" };
    }
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const disposition = res.headers.get("Content-Disposition") || "";
    const filenameMatch = disposition.match(/filename=(.+)/);
    const filename = filenameMatch ? filenameMatch[1] : "bookings.db";
    return { success: true, data: base64, filename };
  } catch {
    return { success: false, error: "Failed to connect to booking service" };
  }
}

export async function adminImportDatabase(
  formData: FormData
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("booking-admin-session")?.value || "";
    const res = await fetch(`${API_URL}/api/admin/database/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (res.status === 401) {
      return { success: false, error: "unauthorized" };
    }
    if (!res.ok) {
      try {
        const body = await res.json();
        return { success: false, error: body.error || "Failed to import database" };
      } catch {
        return { success: false, error: "Failed to import database" };
      }
    }
    return { success: true };
  } catch {
    return { success: false, error: "Failed to connect to booking service" };
  }
}

export async function getAdminData(): Promise<AdminResult | AdminError> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("booking-admin-session")?.value || "";
    const res = await fetch(`${API_URL}/api/admin`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 401) {
      return { success: false, error: "unauthorized" };
    }
    if (!res.ok) {
      return { success: false, error: "Failed to fetch admin data" };
    }
    const data = await res.json();
    return { success: true, data };
  } catch {
    return { success: false, error: "Failed to connect to booking service" };
  }
}
