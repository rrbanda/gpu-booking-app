"""Abstract base class for GPU booking providers."""

from abc import ABC, abstractmethod
from typing import Any


class BookingProvider(ABC):
    """Interface for interacting with the GPU booking backend."""

    @abstractmethod
    async def get_config(self) -> dict[str, Any]:
        """Fetch GPU resource configuration from the backend."""
        ...

    @abstractmethod
    async def list_bookings(self, user: str) -> dict[str, Any]:
        """List all bookings. Returns bookings, activeReservations, and currentUser."""
        ...

    @abstractmethod
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
        """Create a single booking."""
        ...

    @abstractmethod
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
        """Create bookings across multiple resources and dates."""
        ...

    @abstractmethod
    async def cancel_booking(self, user: str, booking_id: str) -> dict[str, Any]:
        """Cancel a booking by ID."""
        ...
