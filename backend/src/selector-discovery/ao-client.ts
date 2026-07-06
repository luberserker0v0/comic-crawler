import { fetch } from 'undici';

export interface AoMessageResponse {
  messageId?: string;
  text?: string;
  parts?: unknown[];
}

export interface AoConversationStatus {
  id: string;
  status?: string;
  ready?: boolean;
  sessionId?: string;
  needsRestart?: boolean;
}

export class AoClient {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(baseUrl: string, options?: { requestTimeoutMs?: number }) {
    if (!baseUrl) {
      throw new Error('AO URL is required.');
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 15 * 60 * 1000;
  }

  async createConversation(id?: string): Promise<string> {
    const response = await this.request<{ id?: string; conversation?: { id?: string } }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify(id ? { id } : {}),
    });
    const conversationId = response.id ?? response.conversation?.id ?? id;
    if (!conversationId) {
      throw new Error('AO did not return a conversation id.');
    }
    return conversationId;
  }

  async uploadConfig(conversationId: string, config: Record<string, unknown>): Promise<void> {
    await this.request(`/api/conversations/${encodeURIComponent(conversationId)}/config`, {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async uploadAgentConfig(conversationId: string, content: string): Promise<void> {
    await this.request(`/api/conversations/${encodeURIComponent(conversationId)}/agent/config`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  async uploadAgent(conversationId: string, name: string, content: string): Promise<void> {
    await this.request(`/api/conversations/${encodeURIComponent(conversationId)}/agents`, {
      method: 'PUT',
      body: JSON.stringify({ name, content }),
    });
  }

  async uploadSkill(conversationId: string, name: string, zip: Buffer): Promise<void> {
    await this.request(`/api/conversations/${encodeURIComponent(conversationId)}/skills/upload?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: zip,
    });
  }

  async uploadFile(conversationId: string, path: string, content: string): Promise<void> {
    await this.request(`/api/conversations/${encodeURIComponent(conversationId)}/files`, {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    });
  }

  async readFile(conversationId: string, path: string): Promise<string> {
    const response = await this.request<{ content?: string }>(`/api/conversations/${encodeURIComponent(conversationId)}/files/read`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
    return response.content ?? '';
  }

  async start(conversationId: string): Promise<void> {
    await this.request(`/api/conversations/${encodeURIComponent(conversationId)}/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const status = await this.waitForReady(conversationId);
    if (!status.sessionId) {
      try {
        await this.createDefaultSession(conversationId);
      } catch (error) {
        const latest = await this.getConversationStatus(conversationId).catch(() => status);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`AO conversation is ready but has no sessionId. Failed to create a default session. Status: ${JSON.stringify(latest)}. Cause: ${message}`);
      }
    }
  }

  async createDefaultSession(conversationId: string): Promise<void> {
    await this.request(`/api/conversations/${encodeURIComponent(conversationId)}/sessions`, {
      method: 'POST',
      body: JSON.stringify({ title: 'selector-discovery' }),
    });
  }

  async getConversationStatus(conversationId: string): Promise<AoConversationStatus> {
    const response = await fetch(`${this.baseUrl}/api/conversations/${encodeURIComponent(conversationId)}`);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`AO GET /api/conversations/${conversationId} failed with HTTP ${response.status}: ${text}`);
    }
    return JSON.parse(text) as AoConversationStatus;
  }

  async getConversation(conversationId: string): Promise<AoConversationStatus> {
    return this.getConversationStatus(conversationId);
  }

  async waitForReady(conversationId: string, timeoutMs = 180_000): Promise<AoConversationStatus> {
    const startedAt = Date.now();
    let latest: AoConversationStatus | undefined;
    while (Date.now() - startedAt < timeoutMs) {
      latest = await this.getConversationStatus(conversationId);
      if (latest.ready === true) {
        return latest;
      }
      if (latest.status && !['starting', 'running', 'prepared'].includes(latest.status)) {
        throw new Error(`AO conversation ${conversationId} entered unexpected status "${latest.status}".`);
      }
      await sleep(1000);
    }
    throw new Error(`Timed out waiting for AO conversation ${conversationId} to become ready. Last status: ${JSON.stringify(latest)}`);
  }

  async message(conversationId: string, text: string, model: string, agent = 'selector-discovery'): Promise<AoMessageResponse> {
    const path = `/api/conversations/${encodeURIComponent(conversationId)}/message`;
    const body = JSON.stringify({ text, model, agent });
    let lastError: unknown;

    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        return await this.request<AoMessageResponse>(path, {
          method: 'POST',
          body,
        });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('SESSION_NOT_READY')) {
          throw error;
        }
        await sleep(2000);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.request(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'DELETE',
    });
  }

  private async request<T = unknown>(path: string, init: { method: string; body?: any; headers?: Record<string, string> }): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.body && !(init.body instanceof Buffer) ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
      } as any);
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`AO ${init.method} ${path} failed with HTTP ${response.status}: ${text}`);
      }
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`AO ${init.method} ${path} timed out after ${this.requestTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
