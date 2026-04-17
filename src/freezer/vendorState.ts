import { getVendorById, getCategoriesWithItems } from "../db/queries";
import { VendorState } from "../types";
import { localUserStore } from "./localUserStore";

export const vendorStore = new Map<number, VendorState>();

export function getVendorState(vendorId: number): VendorState | undefined {
  return vendorStore.get(vendorId);
}

export async function loadVendorState(vendorId: number): Promise<VendorState> {
  const vendor = await getVendorById(vendorId);
  const categories = await getCategoriesWithItems(vendorId);

  const state: VendorState = {
    vendorId,
    lat: vendor.lat,
    lng: vendor.lng,
    phone: vendor.phone,
    acct_type: vendor.acct_type,
    categories,
    lastUpdated: new Date(),
  };

  vendorStore.set(vendorId, state);
  return state;
}

export async function buildPreflightPayload(vendorId: number, userId: number) {
  const vendorState = getVendorState(vendorId);
  const user = await localUserStore.getUser(userId);

  if (!user?.location) throw new Error("User location missing");
  if (!vendorState) throw new Error("Vendor state missing");

  return {
    rider_id: userId,
    pick_up: { lat: vendorState.lat, lng: vendorState.lng },
    drop_off: { lat: user.location.lat, lng: user.location.lng },
    ride_type: vendorState.acct_type || "default",
  };
}
