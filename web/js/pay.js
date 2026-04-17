Telegram.WebApp.ready();
// Telegram.WebApp.expand();

const params = new URLSearchParams(window.location.search);
const amount = params.get("amount");
const orderId = params.get("order_id");
const email = params.get("email");
const chatId = params.get("chat_id");
const userId = params.get("user_id");

document.getElementById("amount-text").textContent =
  `₦${Number(amount).toLocaleString()}`;
document.getElementById("order-text").textContent = `Order #${orderId}`;

const btn = document.getElementById("pay-btn");
const statusEl = document.getElementById("status");

let accessCode = null;

// Initialise transaction on the server to get the access_code
fetch("/pay", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email,
    amount,
    order_id: orderId,
    chat_id: chatId,
    user_id: userId,
  }),
})
  .then((r) => r.json())
  .then((data) => {
    if (data.access_code) {
      accessCode = data.access_code;
      btn.disabled = false;
    } else {
      statusEl.textContent = "Failed to initialise payment.";
    }
  })
  .catch(() => {
    statusEl.textContent = "Network error.";
  });

btn.addEventListener("click", () => {
  if (!accessCode) return;
  btn.disabled = true;
  statusEl.textContent = "Opening payment...";

  const popup = new PaystackPop();
  popup.resumeTransaction(accessCode, {
    onSuccess: function (transaction) {
      statusEl.textContent = "Payment received! You can close this.";
      Telegram.WebApp.sendData(
        JSON.stringify({
          event: "payment_success",
          reference: transaction.reference,
          order_id: orderId,
        }),
      );
    },
    onCancel: function () {
      statusEl.textContent = "Payment cancelled.";
      btn.disabled = false;
    },
  });
});
