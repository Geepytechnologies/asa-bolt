interface MessageProps {
  tone: "error" | "success" | "info";
  children: React.ReactNode;
}

export function Message({ tone, children }: MessageProps) {
  return (
    <div className={`message message-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
