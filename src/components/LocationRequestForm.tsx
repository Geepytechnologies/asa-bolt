import { useCallback, useState } from "react";
import { submitLocationRequest } from "../api";
import { Message } from "./Message";

export function LocationRequestForm() {
  const [form, setForm] = useState({
    requesterName: "",
    phone: "",
    locationName: "",
    landmark: "",
    mapsUrl: "",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }, []);
  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError("");
      setMessage("");
      try {
        await submitLocationRequest(form);
        setMessage("Thanks — the owner will review this location.");
        setForm({ requesterName: "", phone: "", locationName: "", landmark: "", mapsUrl: "" });
      } catch {
        setError("Please check the fields and try again.");
      }
    },
    [form],
  );
  return (
    <form className="stack-form" onSubmit={handleSubmit}>
      {message && <Message tone="success">{message}</Message>}
      {error && <Message tone="error">{error}</Message>}
      <label>
        Your name
        <input name="requesterName" value={form.requesterName} onChange={handleChange} required />
      </label>
      <label>
        Phone number
        <input
          name="phone"
          type="tel"
          value={form.phone}
          onChange={handleChange}
          placeholder="0801 234 5678"
          required
        />
      </label>
      <label>
        Location name
        <input name="locationName" value={form.locationName} onChange={handleChange} required />
      </label>
      <label>
        Nearby landmark
        <input name="landmark" value={form.landmark} onChange={handleChange} required />
      </label>
      <label>
        Google Maps link <span className="muted">(optional)</span>
        <input
          name="mapsUrl"
          type="url"
          value={form.mapsUrl}
          onChange={handleChange}
          placeholder="https://maps.google.com/..."
        />
      </label>
      <button className="button button-secondary" type="submit">
        Request this location
      </button>
    </form>
  );
}
