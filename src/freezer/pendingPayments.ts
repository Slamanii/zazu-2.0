// Maps orderId -> { chatId, userId }
export const pendingPayments = new Map<string, { chatId: number; userId: number }>();
