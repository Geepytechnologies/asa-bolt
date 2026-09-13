import { CustomerPage } from "./CustomerPage";

interface BookingPageProps {
  onNavigate: (path: string) => void;
}

export function BookingPage({ onNavigate }: BookingPageProps) {
  return (
    <CustomerPage
      onViewStatus={(token) => onNavigate(token === "owner" ? "/owner" : `/status/${token}`)}
    />
  );
}
