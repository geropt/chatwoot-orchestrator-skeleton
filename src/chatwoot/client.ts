import type {
  ChatwootContact,
  ConversationStatus,
  MessageType,
  Priority
} from "./types.js";

export class ChatwootClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accountId: number,
    private readonly apiToken: string
  ) {}

  async sendMessage(
    conversationId: number,
    content: string,
    options?: { private?: boolean; messageType?: MessageType }
  ): Promise<void> {
    await this.request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content,
        message_type: options?.messageType ?? "outgoing",
        private: options?.private ?? false
      })
    });
  }

  async sendPrivateNote(conversationId: number, content: string): Promise<void> {
    await this.sendMessage(conversationId, content, { private: true });
  }

  async toggleStatus(
    conversationId: number,
    status: ConversationStatus
  ): Promise<void> {
    await this.request(`/conversations/${conversationId}/toggle_status`, {
      method: "POST",
      body: JSON.stringify({ status })
    });
  }

  async togglePriority(
    conversationId: number,
    priority: Priority
  ): Promise<void> {
    await this.request(`/conversations/${conversationId}/toggle_priority`, {
      method: "POST",
      body: JSON.stringify({ priority })
    });
  }

  async getContact(contactId: number): Promise<ChatwootContact> {
    const body = await this.request<{
      payload?: { id?: number; email?: string | null; name?: string | null };
    }>(`/contacts/${contactId}`, { method: "GET" });
    const payload = body?.payload ?? {};
    return {
      id: typeof payload.id === "number" ? payload.id : contactId,
      email:
        typeof payload.email === "string" && payload.email.trim()
          ? payload.email.trim()
          : null,
      name:
        typeof payload.name === "string" && payload.name.trim()
          ? payload.name.trim()
          : null
    };
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit
  ): Promise<T | null> {
    const url = `${this.baseUrl}/api/v1/accounts/${this.accountId}${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        api_access_token: this.apiToken,
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Chatwoot API request failed (${response.status} ${response.statusText}): ${text}`
      );
    }

    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
}
