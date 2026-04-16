type ToggleStatus = "open" | "resolved" | "pending" | "snoozed";
type Priority = "urgent" | "high" | "medium" | "low" | null;

export class ChatwootClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accountId: number,
    private readonly apiToken: string
  ) {}

  async sendMessage(
    conversationId: number,
    content: string,
    options?: { private?: boolean }
  ): Promise<void> {
    await this.request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content,
        message_type: "outgoing",
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

  private async request(path: string, init: RequestInit): Promise<void> {
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
      const body = await response.text();
      throw new Error(
        `Chatwoot API request failed (${response.status} ${response.statusText}): ${body}`
      );
    }
  }
}
