import { supabase } from "../../db/supabase.js"
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

    await supabase
      .from('payments')
      .update({ status: 'success' })
      .eq('order_id', orderId)
      .eq('paystack_ref', event.data.reference)

    await supabase.from('orders')
        .update({ status: 'paid' })
        .eq('id', orderId)
  }

  res.sendStatus(200)
})

paystackRouter.get("/return", async (req, res) => {

  const { reference } = req.query // remember this is orderId


  if (!reference) {
    return res.status(400).send("Missing reference")
  }

  const { data: payment, error } = await supabase
    .from('payments')
    .select('zazu_sub_name')
    .eq('id', reference)
    .single()

  if (error || !payment) {
    console.error("Order not found:", error)
    return res.status(404).send("Order not found")
  }

  const telegramLink = `https://t.me/${payment.zazu_sub_name}?start=paid_${reference}`

  res.redirect(telegramLink)
})
