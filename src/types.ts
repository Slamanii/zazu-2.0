// ── User ────────────────────────────────────────────────

export interface userLocation {
  lat: number
  lng: number
}

export interface localUser {
  telegramId: number
  phone?: string
  email?: string
  location?: userLocation
  mainUserref?: string
}

export interface MainUser {
  id: string
  telegramId: number
  phone?: string
  email?: string
  wallet?: number
  location?: userLocation
}

// ── Vendor ───────────────────────────────────────────────

export interface Item {
  id: number
  name: string
  price: number
  stock: number
  image_url?: string
  weight_kg?: number | null
  length_cm?: number | null
  width_cm?: number | null
  height_cm?: number | null
  size_estimated?: boolean | null
}

export interface Category {
  id: number
  name: string
  item: Item[]
}

export interface VendorState {
  vendorId: number
  categories: Category[]
  lat: number
  lng: number
  phone: string
  acct_type: string
  lastUpdated: Date
}

// ── Cart ─────────────────────────────────────────────────

export interface CartItem {
  itemId: number
  name: string
  price: number
  qty: number
  weight_kg?: number | null
  length_cm?: number | null
  width_cm?: number | null
  height_cm?: number | null
}

export interface CartState {
  items: CartItem[]
  total: number
}

export interface UserCartState {
  userId: number
  vendorId: number
  cart: CartState
  pendingItem?: Item
  cartMessageId?: number
}
