"""OpenTelemetry setup for the GPU Booking ADK Agent."""

import logging
import os

logger = logging.getLogger(__name__)

OTEL_ENDPOINT = os.getenv(
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "http://otel-collector.kagenti-system.svc.cluster.local:4317",
)
SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "gpu-booking-agent")


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

        resource = Resource.create({"service.name": SERVICE_NAME})
        provider = TracerProvider(resource=resource)
        exporter = OTLPSpanExporter(endpoint=OTEL_ENDPOINT, insecure=True)
        provider.add_span_processor(BatchSpanExporter(exporter))
        trace.set_tracer_provider(provider)

        logger.info("OTEL tracing enabled, exporting to %s", OTEL_ENDPOINT)
    except ImportError:
        logger.warning(
            "OpenTelemetry packages not installed; tracing disabled."
        )
    except Exception:
        logger.exception("Failed to initialize OTEL tracing")
