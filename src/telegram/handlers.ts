import { Buffer } from 'buffer'
import { supabase } from "../db/supabase.js"
import TelegramBot, { CallbackQuery } from "node-telegram-bot-api"
import { localUserStore } from "../freezer/localUserStore.js"
import { sendLocationToZazuMain, ZAZU_MAIN_BOT } from "./zazu_main_client"
import { showMenuButton } from "./keyboard.js"
import { preflightResults } from './zazu_token_acct'
import { vendorState } from '../freezer/vendorState'
import { VendorState } from "../shared/types.js"
import {  userCartState, CartState } from "../freezer/userCartStore"
import axios from "axios"

function findItemById(state: VendorState, id: string) {
  return state.categories
    .flatMap(c => c.item)
    .find(i => i.id === id)
}

export async function handleSetLocation(bot: TelegramBot, chatId: number, query: CallbackQuery) {
    const userId = query.from.id

    const user = await localUserStore.getUser(userId)

    if (user?.location) {
        await bot.sendMessage(
            chatId,
            `Your current location is:\n${user.location.lat}, ${user.location.lng}`
        )
        return 
    }

    await bot.sendMessage(chatId, "share your location", {
        reply_markup: {
            keyboard: [[{ text: "Share Location", request_location: true}]],
            one_time_keyboard: true,
            resize_keyboard: true
        }
    })
}



export async function saveLocationFlow(bot: TelegramBot, chatId: number, userId: number, lat: number, lng: number) {

  await localUserStore.setLocation(userId, { lat, lng })

  await sendLocationToZazuMain({ telegramId: userId, lat, lng })

  await bot.sendMessage(chatId, "Location saved!", showMenuButton)
}


export async function handleShowMenu(bot: TelegramBot, chatId: number) {

  if (!vendorState) {
    return bot.sendMessage(chatId, "Menu loading...")
  }

  const keyboard = vendorState.categories.map(cat => ([
    { text: cat.name, callback_data: `OPEN_CATEGORY:${cat.id}` }
  ]))

  await bot.sendMessage(chatId, "Menu:", {
    reply_markup: { inline_keyboard: keyboard }
  })
}

export async function handleOpenCategory(bot: TelegramBot, chatId: number, categoryId: string) {

    if (!vendorState) {
        return bot.sendMessage(chatId, 'Menu loading')
    }

    const category = vendorState.categories.find(
        c => c.id === categoryId
    )

    if (!category) {
        return bot.sendMessage(chatId, 'category not found')
    }

    const keyboard = category.item.map(item => ([
        {
            text: `${item.name} ₦${item.price}`,
            callback_data: `ADD_TO_CART:${item.id}`
        }
    ]))

    keyboard.push([
        { text: 'Back', callback_data: "SHOW_MENU"}
    ])

    await bot.sendMessage(chatId, 'Select items', {
        reply_markup: {
            inline_keyboard: keyboard
        }
    })
}



export async function handleSelectItem(bot: TelegramBot, chatId: number, userId: number, itemId: string) {

    if (!vendorState)  return 
    
    const item = findItemById(vendorState, itemId)

    if (!item) return 

    if (item.stock <= 5) {
        return bot.sendMessage(chatId, "Out of Stock")
    }

    let state = userCartState.get(chatId)

                if (!state) {
                state = {
                    userId,
                    cart: {
                    items: [],
                    total: 0
                    }
                }
                userCartState.set(chatId, state)
                }

   

                state.pendingItem = item


    await bot.sendMessage(chatId, `How many ${item.name}?`, {
        reply_markup: {
            keyboard: [
                [{ text: "1" }, { text: "2" }, { text: "3" }, { text: "4" }],
                [{ text: "5" }, { text: "10" }],
                [{ text: "Cancel" }]
           ],
            
           resize_keyboard: true,
           one_time_keyboard: true
        }
    })
}



export async function sendCartSummary(
  bot: TelegramBot,
  chatId: number,
  userId: number
) {

  let state = userCartState.get(chatId)

  if (!state) return

  const cart = state.cart

  let text = "🛒 Cart:\n\n"
  let keyboard: any[] = []

  for (const c of cart.items) {

    text += `${c.name} x${c.qty} = ₦${c.price * c.qty}\n`

    keyboard.push([
      { text: "➖", callback_data: `DECREASE:${c.itemId}` },
      { text: "➕", callback_data: `INCREASE:${c.itemId}` },
      { text: "❌ Remove", callback_data: `REMOVE:${c.itemId}` }
    ])
  }

  text += `\nTotal: ₦${cart.total}`

  keyboard.push([
    { text: "Checkout", callback_data: "CHECKOUT" }
  ])

  await bot.sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: keyboard
    }
  })
}

export async function handleRemoveItem(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  itemId: string
) {

  const state = userCartState.get(chatId)
  if (!state) return

  state.cart.items = state.cart.items.filter(
    i => i.itemId !== itemId
  )

  state.cart.total = state.cart.items.reduce(
    (sum, i) => sum + i.price * i.qty,
    0
  )

  await sendCartSummary(bot, chatId, userId)
}

export async function handleIncreaseQty(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  itemId: string
) {

  const state = userCartState.get(chatId)
  if (!state) return

  const item = state.cart.items.find(i => i.itemId === itemId)
  if (!item) return

  item.qty += 1

  state.cart.total += item.price

  await sendCartSummary(bot, chatId, userId)
}

export async function handleDecreaseQty(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  itemId: string
) {

  const state = userCartState.get(chatId)
  if (!state) return

  const item = state.cart.items.find(i => i.itemId === itemId)
  if (!item) return

  item.qty -= 1

  if (item.qty <= 0) {
    state.cart.items = state.cart.items.filter(i => i.itemId !== itemId)
  }

  state.cart.total = state.cart.items.reduce(
    (sum, i) => sum + i.price * i.qty,
    0
  )

  await sendCartSummary(bot, chatId, userId)
}


export async function handlePlaceOrder(bot: TelegramBot, chatId: number, query: CallbackQuery) {
    await bot.sendMessage(chatId, "please enter your delivery address:")

    
}


export async function constructOrder({ userId, vendorId, cart, deliveryPrice }: {
  userId: number,
  vendorId: string,
  cart: CartState //check this 
  deliveryPrice: number
  
}) {

  const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0)
  const total = subtotal + deliveryPrice
  
   const { data: orderdb, error } = await supabase
    .from('orders')
    .insert({
      user_id: userId,
      vendor_id: vendorId,
      subtotal,
      delivery_fee: deliveryPrice,
      total,
      status: 'pending',       
    })
    .select('*')
    .single()

  if (error || !orderdb) {
    throw new Error("Failed to create order: " + error?.message)
  }

  const { data: paymentsdb, error: payError } = await supabase
    .from('payments')
    .insert({
      order_id: orderdb.Id,
      paystack_ref: "",
      amount: total,
      status: 'pending',       
    })
    .select('*')
    .single()

  if (payError || !paymentsdb) {
    throw new Error("Failed to create order: " + payError?.message)
  }

  const order = orderdb

  return order
}

export async function handleCheckout(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  vendorId: string
) {
  const cart = userCartState.get(chatId)?.cart
  if (!cart || cart.items.length === 0) {
    await bot.sendMessage(chatId, "Your cart is empty 🛒")
    return
  }

  const preflight = preflightResults.get(userId)
  if (!preflight || !preflight.canServe) {
    await bot.sendMessage(chatId, "Cannot construct order: no delivery available 😔")
    return
  }

  // Construct order using preflight data
  const order = await constructOrder({
    userId,
    vendorId,
    cart,
    deliveryPrice: preflight.estimatedPrice,
  })

  // Send Pay button
  await bot.sendMessage(chatId, ` Order ready! Total: ₦${order.total}\nPay now:`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Pay: PAYSTACK", callback_data: `PAYSTACK:${order.id}` }],
        [{ text: "Pay: SOLPAY", callback_data: `SOLPAY:${order.id}` }]
      ]
    }
  })
}

export async function handlePayStart(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  email: string,
  vendorId: string,
  orderId: string,
  method: "sol" | "paystack"
) {

 
  const payload = {
    orderId,
    userId,
    email,
    vendorId,
    method
  }

  const encoded = Buffer
    .from(JSON.stringify(payload))
    .toString("base64")

    const deepLink = `https://t.me/${ZAZU_MAIN_BOT}?start=pay_${encoded}`

    await bot.sendMessage(
      chatId,
      `Redirecting to payment...\n${deepLink}`
    )
}

export async function callASAP(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  riderId: string,
  dropoffPoint: any,
  pickupPoint: any,
  rideType: string,
  paymentMethod: string,
  userPhoneNumber: string | undefined,
  vendorPhoneNumber: string,
  orderId: string,
) {

 let state = userCartState.get(chatId)

                if (!state) {
                state = {
                    userId,
                    cart: {
                    items: [],
                    total: 0
                    }
                }
                userCartState.set(chatId, state)
                }

    const { data: orderData, error } = await supabase
            .from("orders")
            .select("*")
            .eq("id", orderId)
        
   if (error || !orderData) {
    throw new Error("Order not found: " + error?.message)
  }

    try {


      const itemDetails = state.cart.items.map(item => ({
      name: item.name,
      price: item.price,
      dimensions: [4.0, 4.0, 4.0], // default for vendor
      quantity: item.qty,
      weight: 3.0 // default or calculated
    }))

  const payload = {
    riderId,
    pickupPoint,
    dropoffPoint,
    rideType,
    paymentMethod,
    itemsDetails: itemDetails,
    orderId,
    userId,
    userPhoneNumber,
    vendorPhoneNumber,
  }

  

  const response = await axios.post("http://localhost:4000/ride-request", payload);

    const rideData = response.data;

    if (!rideData.success) {
      await bot.sendMessage(chatId, "Could not create ride request 😔");
      return null;
    }

    const orderPayload = await orderComingThrough(rideData, orderData);

    return orderPayload;


  } catch (err: any) {
    console.error("Error sending ride request to Zazu-Main:", err.message);
    await bot.sendMessage(chatId, "Error contacting delivery system 😔");
    return null;
  }
   
}

 async function orderComingThrough(rideDetails: any, orderDetails: any) {
  const pickupCode = Math.floor(100000 + Math.random() * 900000);

  return {
    eta: rideDetails.estimated_arrival,
    timeInMin: rideDetails.estimated_time_min,
    status: rideDetails.validation_status,
    driverInfo: rideDetails.driver_assigned,
    pickupCode,
    orderDetails
  };
}
