import { OwnerPage } from "./OwnerPage";

interface OwnerDashboardProps {
  onNavigate: (path: string) => void;
}

export function OwnerDashboard({ onNavigate }: OwnerDashboardProps) {
  return <OwnerPage onBack={() => onNavigate("/")} />;
}
