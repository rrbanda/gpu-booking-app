"""Mock provider for testing without a running Go backend."""

import uuid
from datetime import datetime, timezone
from typing import Any

from providers.base import BookingProvider

MOCK_RESOURCES = [
    {"name": "H200 Full GPU", "type": "nvidia.com/gpu", "count": 8, "share": 0.0625, "gpuEquivalent": 1.0},
    {"name": "MIG 3g.71gb", "type": "nvidia.com/mig-3g.71gb", "count": 8, "share": 0.03125, "gpuEquivalent": 0.5},
    {"name": "MIG 2g.35gb", "type": "nvidia.com/mig-2g.35gb", "count": 8, "share": 0.015625, "gpuEquivalent": 0.25},
    {"name": "MIG 1g.18gb", "type": "nvidia.com/mig-1g.18gb", "count": 16, "share": 0.0078125, "gpuEquivalent": 0.125},
]


class MockProvider(BookingProvider):
    """In-memory provider for testing."""

    def __init__(self):
        self.bookings: list[dict[str, Any]] = []

    async def get_config(self) -> dict[str, Any]:
        return {
            "resources": MOCK_RESOURCES,
            "bookingWindowDays": 30,
            "totalCpu": 316,
            "totalMemory": 3460,
        }

    async def list_bookings(self, user: str) -> dict[str, Any]:
        return {
            "bookings": self.bookings,
            "activeReservations": {},
            "currentUser": user,
        }

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
        for b in self.bookings:
            if b["resource"] == resource and b["slotIndex"] == slot_index and b["date"] == date:
                if b["source"] == "reserved":
                    return {"error": "slot_taken"}
                self.bookings.remove(b)
                break

        booking = {
            "id": str(uuid.uuid4()),
            "user": user,
            "email": f"{user}@example.com",
            "resource": resource,
            "slotIndex": slot_index,
            "date": date,
            "slotType": "full",
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "source": "reserved",
            "description": description,
            "startHour": start_hour,
            "endHour": end_hour,
        }
        self.bookings.append(booking)
        return booking

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
        created = []
        errors = []
        config = await self.get_config()
        res_map = {r["type"]: r["count"] for r in config["resources"]}

        from datetime import timedelta

        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d")
        current = start
        while current <= end:
            date_str = current.strftime("%Y-%m-%d")
            for res_type, count in resources.items():
                max_units = res_map.get(res_type, 0)
                if max_units == 0:
                    errors.append(f"Unknown resource: {res_type}")
                    continue
                placed = 0
                for idx in range(max_units):
                    if placed >= count:
                        break
                    result = await self.create_booking(
                        user, res_type, idx, date_str, description, start_hour, end_hour
                    )
                    if "error" not in result:
                        created.append(result)
                        placed += 1
            current += timedelta(days=1)

        if not created and errors:
            return {"error": "no_slots_available", "details": errors}
        return {"bookings": created, "errors": errors}

    async def cancel_booking(self, user: str, booking_id: str) -> dict[str, Any]:
        for b in self.bookings:
            if b["id"] == booking_id:
                if b["source"] == "consumed":
                    return {"error": "forbidden", "detail": "consumed_booking"}
                if b["user"] != user:
                    return {"error": "forbidden"}
                self.bookings.remove(b)
                return {"status": "deleted"}
        return {"error": "not_found"}
