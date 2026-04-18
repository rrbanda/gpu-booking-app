"""HTTP provider that calls the Go booking backend API."""

import httpx
from typing import Any

from providers.base import BookingProvider


class HTTPProvider(BookingProvider):
    """Calls the real Go backend at BOOKING_API_URL."""

    def __init__(self, base_url: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _headers(self, user: str) -> dict[str, str]:
        return {
            "X-Forwarded-User": user,
            "Content-Type": "application/json",
        }

    async def get_config(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(f"{self.base_url}/api/config")
            resp.raise_for_status()
            return resp.json()

    async def list_bookings(self, user: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                f"{self.base_url}/api/bookings",
                headers=self._headers(user),
            )
            resp.raise_for_status()
            return resp.json()

    async def create_booking(
        self,
        user: str,
        resource: str,
        slot_index: int,
        date: str,
        description: str = "",
        start_hour: int = 0,
        end_hour: int = 24,
    ) -> dict[str, Any]:
        payload = {
            "resource": resource,
            "slotIndex": slot_index,
            "date": date,
            "slotType": "full",
            "description": description,
            "startHour": start_hour,
            "endHour": end_hour,
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/bookings",
                json=payload,
                headers=self._headers(user),
            )
            if resp.status_code == 409:
                return {"error": "slot_taken", "detail": resp.json()}
            resp.raise_for_status()
            return resp.json()

    async def bulk_book(
        self,
        user: str,
        resources: dict[str, int],
        start_date: str,
        end_date: str,
        description: str = "",
        start_hour: int = 0,
        end_hour: int = 24,
    ) -> dict[str, Any]:
        payload = {
            "resources": resources,
            "startDate": start_date,
            "endDate": end_date,
            "description": description,
            "startHour": start_hour,
            "endHour": end_hour,
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/bookings/bulk",
                json=payload,
                headers=self._headers(user),
            )
            if resp.status_code == 409:
                return {"error": "no_slots_available", "detail": resp.json()}
            resp.raise_for_status()
            return resp.json()

    async def cancel_booking(self, user: str, booking_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.delete(
                f"{self.base_url}/api/bookings",
                params={"id": booking_id},
                headers=self._headers(user),
            )
            if resp.status_code == 403:
                return {"error": "forbidden", "detail": resp.json()}
            if resp.status_code == 404:
                return {"error": "not_found"}
            resp.raise_for_status()
            return resp.json()
