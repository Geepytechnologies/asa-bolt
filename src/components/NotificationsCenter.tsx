import { useState } from "react";
import { NotificationsPanel } from "./NotificationsPanel";
export function NotificationsCenter(props: { token: string; onSaved: () => Promise<void> }) {
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  return (
    <div>
      <div className="action-row" aria-label="Notification channel">
        <button
          className="button button-secondary"
          type="button"
          aria-pressed={channel === "email"}
          onClick={() => setChannel("email")}
        >
          Email
        </button>
        <button
          className="button button-secondary"
          type="button"
          aria-pressed={channel === "whatsapp"}
          onClick={() => setChannel("whatsapp")}
        >
          Optional WhatsApp
        </button>
      </div>
      <NotificationsPanel key={channel} {...props} channel={channel} />
    </div>
  );
}
