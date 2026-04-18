import type { A2AAgentCard, A2AEvent } from "./a2a-types";

const AGENT_PROXY = "/api/agent";

function generateId(): string {
  return crypto.randomUUID();
}

export async function fetchAgentCard(): Promise<A2AAgentCard | null> {
  try {
    const res = await fetch(`${AGENT_PROXY}/.well-known/agent.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function sendMessage(
  text: string,
  contextId?: string,
  taskId?: string,
): Promise<A2AEvent | null> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "message/send",
    params: {
      message: {
        role: "user",
        parts: [{ kind: "text", text }],
        messageId: generateId(),
        ...(contextId && { contextId }),
        ...(taskId && { taskId }),
      },
      ...(contextId && { configuration: { blocking: true } }),
    },
  };

  try {
    const res = await fetch(AGENT_PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result ?? null;
  } catch {
    return null;
  }
}

async function tryStreamMessage(
  body: Record<string, unknown>,
  onEvent: (event: A2AEvent) => void,
): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(AGENT_PROXY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ ...body, method: "message/stream" }),
    });
  } catch {
    return false;
  }

  if (!res.ok) return false;

  const contentType = res.headers.get("content-type") || "";

  // Check if the response indicates streaming is not supported
  if (!contentType.includes("text/event-stream")) {
    try {
      const data = await res.json();
      if (data.error) return false;
      const event = data.result ?? data;
      if (event.kind) onEvent(event as A2AEvent);
      return true;
    } catch {
      return false;
    }
  }

  const reader = res.body?.getReader();
  if (!reader) return false;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr) continue;

      try {
        const parsed = JSON.parse(jsonStr);
        const event = parsed.result ?? parsed;
        if (event.kind) onEvent(event as A2AEvent);
      } catch {
        // partial JSON chunk, skip
      }
    }
  }

  return true;
}

export async function streamMessage(
  text: string,
  onEvent: (event: A2AEvent) => void,
  onDone: () => void,
  onError: (err: string) => void,
  contextId?: string,
  taskId?: string,
): Promise<void> {
  const messageId = generateId();
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "message/send",
    params: {
      message: {
        role: "user",
        parts: [{ kind: "text", text }],
        messageId,
        ...(contextId && { contextId }),
        ...(taskId && { taskId }),
      },
    },
  };

  // Try streaming first; fall back to synchronous message/send
  const streamed = await tryStreamMessage(body, onEvent).catch(() => false);

  if (!streamed) {
    let res: Response;
    try {
      res = await fetch(AGENT_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      onError(`Connection failed: ${err}`);
      return;
    }

    if (!res.ok) {
      onError(`Agent returned HTTP ${res.status}`);
      return;
    }

    try {
      const data = await res.json();
      if (data.error) {
        onError(data.error.message || JSON.stringify(data.error));
        return;
      }
      const event = data.result ?? data;
      if (event.kind) onEvent(event as A2AEvent);
    } catch {
      onError("Failed to parse agent response");
      return;
    }
  }

  onDone();
}
