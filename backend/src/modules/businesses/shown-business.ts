/**
 * A listing linked from a road-guide or itinerary stop shows only while the listing itself
 * does: Batoma's admins, and moderation after a report, can hide one. The stop keeps its own
 * name and details; only the link to the hidden listing goes.
 */
export function withShownBusiness<S extends { businessId: string | null; business: ({ isActive: boolean } & object) | null }>(stop: S) {
  if (!stop.business) return { ...stop, business: null };
  const { isActive, ...business } = stop.business;
  return isActive ? { ...stop, business } : { ...stop, businessId: null, business: null };
}
