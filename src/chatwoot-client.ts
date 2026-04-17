type ToggleStatus = "open" | "resolved" | "pending" | "snoozed";
type Priority = "urgent" | "high" | "medium" | "low" | null;
type MessageType = "incoming" | "outgoing";

export type ChatwootContact = {
  id: number;
  email: string | null;
  name: string | null;
};

export type CreatedConversation = {
  id: number;
  displayId: number;
};

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
    status: ToggleStatus
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

  async createConversation(params: {
    inboxId: number;
    contactId: number;
    sourceId: string;
    status?: ToggleStatus;
  }): Promise<CreatedConversation> {
    const body = await this.request<{
      id?: number;
      display_id?: number;
    }>(`/conversations`, {
      method: "POST",
      body: JSON.stringify({
        inbox_id: params.inboxId,
        contact_id: params.contactId,
        source_id: params.sourceId,
        status: params.status ?? "open"
      })
    });

    if (typeof body?.id !== "number" || typeof body?.display_id !== "number") {
      throw new Error(
        `Chatwoot createConversation returned unexpected body: ${JSON.stringify(body)}`
      );
    }

    return { id: body.id, displayId: body.display_id };
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
