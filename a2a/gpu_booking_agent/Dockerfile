FROM python:3.13-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY . .
RUN uv sync --frozen --no-dev


FROM python:3.13-slim

RUN groupadd -g 1001 appuser && useradd -u 1001 -g 1001 -m appuser

COPY --from=builder --chown=1001:1001 /app /app
WORKDIR /app

ENV PATH="/app/.venv/bin:$PATH"
ENV PORT=8001
ENV HOST=0.0.0.0

EXPOSE 8001

USER 1001

CMD ["python", "-m", "gpu_booking_agent.agent"]
