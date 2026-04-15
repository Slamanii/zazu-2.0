import { Item, CartItem, CartState, UserCartState } from '../types'

export type { CartItem, CartState, UserCartState }

export const userCartState = new Map<number, UserCartState>()

export function addItemToUserCart(userId: number, item: Item, qty: number) {
  if (qty <= 0) throw new Error("Quantity must be positive")

  let userState = userCartState.get(userId)

  if (!userState) {
    userState = { userId, cart: { items: [], total: 0 } }
    userCartState.set(userId, userState)
  }

  const existing = userState.cart.items.find(i => i.itemId === item.id)

  if (existing) {
    existing.qty += qty
  } else {
    userState.cart.items.push({
      itemId: item.id,
      name: item.name,
      price: item.price,
      qty
    })
  }

  userState.cart.total = userState.cart.items.reduce(
    (sum, i) => sum + i.price * i.qty,
    0
  )
}
