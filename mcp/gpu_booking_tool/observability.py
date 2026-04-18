"""OpenTelemetry setup for the GPU Booking MCP Tool."""

import logging
import os

logger = logging.getLogger(__name__)

OTEL_ENDPOINT = os.getenv(
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "http://otel-collector.kagenti-system.svc.cluster.local:4317",
)
SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "gpu-booking-tool")


def setup_otel() -> None:
    """Configure OpenTelemetry tracing with OTLP exporter."""
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        resource = Resource.create({"service.name": SERVICE_NAME})
        provider = TracerProvider(resource=resource)
        exporter = OTLPSpanExporter(endpoint=OTEL_ENDPOINT, insecure=True)
        provider.add_span_processor(BatchSpanExporter(exporter))
        trace.set_tracer_provider(provider)

        HTTPXClientInstrumentor().instrument()

        logger.info("OTEL tracing enabled, exporting to %s", OTEL_ENDPOINT)
    except ImportError:
        logger.warning(
            "OpenTelemetry packages not installed; tracing disabled. "
            "Install opentelemetry-sdk, opentelemetry-exporter-otlp-proto-grpc, "
            "and opentelemetry-instrumentation-httpx to enable."
        )
    except Exception:
        logger.exception("Failed to initialize OTEL tracing")


def get_tracer(name: str = SERVICE_NAME):
    """Get a tracer instance, falling back to a no-op tracer."""
    try:
        from opentelemetry import trace
        return trace.get_tracer(name)
    except ImportError:
        return None
