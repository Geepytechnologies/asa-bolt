import { CustomerStatus } from "./CustomerStatus";

interface StatusPageProps {
  token: string;
  onNavigate: (path: string) => void;
}

export function StatusPage({ token, onNavigate }: StatusPageProps) {
  return <CustomerStatus token={token} onBack={() => onNavigate("/")} />;
}
