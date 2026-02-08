import { supabase } from '../db/supabase'
import { VendorState, Category } from '../shared/types'
import { localUserStore } from './localUserStore'



export let vendorState: VendorState | null = null


export  async function loadVendorState(vendorId: string) {
    
         const { data: vendor, error: vendorErr } = await supabase
            .from('vendor')
            .select('*')
            .eq('id', vendorId)
            .single()

            if (vendorErr) throw vendorErr


        const { data: categories, error } = await supabase
            .from('categories')
            .select(`
                id,
                name,
                item (
                    id,
                    name,
                    price,
                    stock,
                    image_url
            )
                `)
            .eq('vendor_id', vendorId)

           if (error) throw error

                vendorState = {
                    vendorId,
                    lat: vendor.lat,
                    lng: vendor.lng,
                    phone: vendor.phone,
                    acct_type: vendor.acct_type,
                    categories: categories as Category[],
                    lastUpdated: new Date()
                }
            
    }


    export async function buildPreflightPayload(userId: number) {
            
        
        const user = await localUserStore.getUser(userId)
                
            if (!user?.location) throw new Error("User location missing")

                if (!vendorState) throw new Error("Vendor state missing")

                const pickupPoint = {
                            lat: vendorState.lat,
                            lng: vendorState.lng
                        }
                const dropoffPoint = { lat: user.location.lat, lng: user.location.lng }

                const rideType = vendorState.acct_type || "default" //make into string

                return {
                    rider_id: userId,
                    pick_up: pickupPoint,
                    drop_off: dropoffPoint,
                    ride_type: rideType
                }
    }

