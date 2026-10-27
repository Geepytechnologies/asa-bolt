import type { Booking } from "../../shared/contracts";
import { agreedFareAmount } from "../../shared/booking-pricing";
import { formatNaira } from "../format";

export function FareDetails({ booking }: { booking: Booking }) {
  const agreed = agreedFareAmount(booking);
  return (
    <>
      <div>
        <dt>Quoted fare</dt>
        <dd>{formatNaira(booking.fare.amountKobo)}</dd>
      </div>
      {booking.offer && (
        <>
          <div>
            <dt>Proposed fare</dt>
            <dd>
              {formatNaira(booking.offer.roundedAmountKobo)}
              <small className="offer-entered">
                Entered ₦{booking.offer.amountNaira}; rounded up in ₦50 steps.
              </small>
            </dd>
          </div>
          {booking.offer.note && (
            <div>
              <dt>Offer note</dt>
              <dd>{booking.offer.note}</dd>
            </div>
          )}
        </>
      )}
      {agreed !== undefined && (
        <div>
          <dt>Agreed fare</dt>
          <dd>{formatNaira(agreed)}</dd>
        </div>
      )}
    </>
  );
}
