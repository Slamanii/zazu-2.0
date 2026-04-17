import { Item } from '../types'

interface UiState {
  pendingItem?: Item
  cartMessageId?: number
  vendorId?: number
}

const uiStateMap = new Map<number, UiState>()

export function getUiState(chatId: number): UiState {
  let s = uiStateMap.get(chatId)
  if (!s) {
    s = {}
    uiStateMap.set(chatId, s)
  }
  return s
}

export function clearUiState(chatId: number) {
  uiStateMap.delete(chatId)
}
