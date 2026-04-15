export type ChatwootWebhookPayload = {
  event?: string;
  id?: number | string;
  content?: string;
  private?: boolean;
  message_type?: string | number;
  sender?: {
    type?: string;
  };
  conversation?: {
    id?: number;
    display_id?: number;
    status?: string | number;
  };
};
