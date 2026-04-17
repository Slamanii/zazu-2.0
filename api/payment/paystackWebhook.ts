import { updatePaymentStatus, updateOrderStatus, getPaymentByReference } from "../../db/queries"
import crypto from "crypto"
import express from 'express'

const paystackRouter = express.Router()

paystackRouter.post('/webhook', async (req, res) => {

  const secret = process.env.PAYSTACK_SECRET_KEY!

  const hash = crypto
    .createHmac('sha512', secret)
    .update(JSON.stringify(req.body))
    .digest('hex')

  if (hash !== req.headers['x-paystack-signature']) {
    return res.sendStatus(401)
  }

  const event = req.body

  if (event.event === 'charge.success') {

    const orderId = event.data.reference

    await updatePaymentStatus(orderId, event.data.reference, 'success')
    await updateOrderStatus(orderId, 'paid')
  }

  res.sendStatus(200)
})

paystackRouter.get("/return", async (req, res) => {

  const { reference } = req.query // remember this is orderId


  if (!reference) {
    return res.status(400).send("Missing reference")
  }

  let payment: { zazu_sub_name: string }
  try {
    payment = await getPaymentByReference(reference as string)
  } catch (error) {
    console.error("Order not found:", error)
    return res.status(404).send("Order not found")
  }

  const telegramLink = `https://t.me/${payment.zazu_sub_name}?start=paid_${reference}`

  res.redirect(telegramLink)
})
