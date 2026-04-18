"""HTTP provider that calls the Go booking backend API with retry logic."""

import logging
from typing import Any

import httpx

from providers.base import BookingProvider

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_BACKOFF = 0.5


class BackendError(Exception):
    """Structured error from the Go backend."""

    def __init__(self, status: int, code: str, detail: str):
        self.status = status
        self.code = code
        self.detail = detail
        super().__init__(f"{code}: {detail} (HTTP {status})")


def _safe_json(resp: httpx.Response) -> dict[str, Any]:
    """Parse response body as JSON, handling plain-text error bodies."""
    ct = resp.headers.get("content-type", "")
    if "application/json" in ct:
        return resp.json()
    return {"error": resp.text.strip() or f"HTTP {resp.status_code}"}


class HTTPProvider(BookingProvider):
    """Calls the real Go backend at BOOKING_API_URL with retries."""

    def __init__(self, base_url: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        transport = httpx.AsyncHTTPTransport(retries=MAX_RETRIES)
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=timeout,
            transport=transport,
        )

    def _headers(self, user: str) -> dict[str, str]:
        return {
            "X-Forwarded-User": user,
            "Content-Type": "application/json",
        }

    async def _request(
        self,
        method: str,
        path: str,
        *,
        user: str | None = None,
        json: dict | None = None,
        params: dict | None = None,
        expected_errors: tuple[int, ...] = (),
    ) -> dict[str, Any]:
        """Unified request method with structured error handling."""
        headers = self._headers(user) if user else {}
        try:
            resp = await self.client.request(
                method, path, headers=headers, json=json, params=params
            )
        except httpx.ConnectError as exc:
            logger.error("Connection to backend failed: %s", exc)
            return {"error": "backend_unreachable", "detail": str(exc)}
        except httpx.TimeoutException as exc:
            logger.error("Backend request timed out: %s", exc)
            return {"error": "backend_timeout", "detail": str(exc)}

        if resp.status_code in expected_errors:
            body = _safe_json(resp)
            code = {409: "conflict", 403: "forbidden", 404: "not_found"}.get(
                resp.status_code, f"http_{resp.status_code}"
            )
            return {"error": code, "detail": body if isinstance(body, dict) else body}

        if resp.status_code >= 400:
            body = _safe_json(resp)
            logger.warning(
                "Backend returned %d for %s %s: %s",
                resp.status_code, method, path, body,
            )
            return {"error": f"http_{resp.status_code}", "detail": body}

        return _safe_json(resp)

    async def get_config(self) -> dict[str, Any]:
        return await self._request("GET", "/api/config")

    async def list_bookings(self, user: str) -> dict[str, Any]:
        return await self._request("GET", "/api/bookings", user=user)

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
        return await self._request(
            "POST", "/api/bookings",
            user=user, json=payload, expected_errors=(409,),
        )

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
        return await self._request(
            "POST", "/api/bookings/bulk",
            user=user, json=payload, expected_errors=(409,),
        )

    async def cancel_booking(self, user: str, booking_id: str) -> dict[str, Any]:
        return await self._request(
            "DELETE", "/api/bookings",
            user=user, params={"id": booking_id}, expected_errors=(403, 404),
        )
