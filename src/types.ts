export type ChatwootWebhookPayload = {
  event?: string;
  id?: number | string;
  content?: string;
  private?: boolean;
  message_type?: string | number;
  sender?: {
    id?: number;
    type?: string;
    email?: string | null;
    name?: string | null;
  };
  conversation?: {
    id?: number;
    display_id?: number;
    status?: string | number;
    contact_inbox?: {
      contact_id?: number;
    };
  };
};
