"""Pydantic models for GPU booking tool request/response validation."""

from pydantic import BaseModel, Field


class GPUResource(BaseModel):
    name: str
    type: str
    count: int
    share: float
    gpu_equivalent: float = Field(alias="gpuEquivalent")

    model_config = {"populate_by_name": True}


class BookingConfig(BaseModel):
    resources: list[GPUResource]
    booking_window_days: int = Field(alias="bookingWindowDays")
    total_cpu: int = Field(alias="totalCpu")
    total_memory: int = Field(alias="totalMemory")

    model_config = {"populate_by_name": True}


class Booking(BaseModel):
    id: str
    user: str
    email: str = ""
    resource: str
    slot_index: int = Field(alias="slotIndex")
    date: str
    slot_type: str = Field(alias="slotType")
    created_at: str = Field(alias="createdAt")
    source: str
    description: str = ""
    start_hour: int = Field(0, alias="startHour")
    end_hour: int = Field(24, alias="endHour")

    model_config = {"populate_by_name": True}


class ActiveReservation(BaseModel):
    user: str
    namespace: str = ""
    resource: str
    count: int
    gpu_equivalent: float = Field(0.0, alias="gpuEquivalent")


class BookingsListResponse(BaseModel):
    bookings: list[Booking] = []
    active_reservations: list[ActiveReservation] = Field(
        default_factory=list, alias="activeReservations"
    )
    current_user: str = Field("", alias="currentUser")

    model_config = {"populate_by_name": True}


class BulkBookResponse(BaseModel):
    created: list[Booking] = []
    failed: list[dict] = []
    message: str = ""


class ToolError(BaseModel):
    error: str
    detail: str | dict = ""
