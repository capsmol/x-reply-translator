const MODIFIERS = ['ctrl', 'alt', 'shift', 'meta']
const MAC_NAMES = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
const PC_NAMES = { ctrl: 'Ctrl+', alt: 'Alt+', shift: 'Shift+', meta: 'Win+' }
const MODIFIER_CODE = /^(Alt|Control|Shift|Meta|OS)(Left|Right)?$/

export const DEFAULT_HOTKEY = { code: 'KeyT', ctrl: false, alt: true, shift: false, meta: false }

export const formatHotkey = (hotkey, isMac) => {
  const names = isMac ? MAC_NAMES : PC_NAMES
  const prefix = MODIFIERS.filter((modifier) => hotkey[modifier])
    .map((modifier) => names[modifier])
    .join('')
  return prefix + hotkey.code.replace(/^(Key|Digit)/, '')
}

export const hotkeyFromEvent = (event) => {
  if (MODIFIER_CODE.test(event.code)) return null
  if (!event.altKey && !event.ctrlKey && !event.metaKey) return null
  return {
    code: event.code,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey
  }
}
