import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_HOTKEY, formatHotkey, hotkeyFromEvent } from '../src/hotkey.js'

const keyEvent = (code, modifiers = {}) => ({
  code,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  ...modifiers
})

test('formatHotkey uses symbols on Mac and names elsewhere', () => {
  assert.equal(formatHotkey(DEFAULT_HOTKEY, true), '⌥T')
  assert.equal(formatHotkey(DEFAULT_HOTKEY, false), 'Alt+T')
  const combo = { code: 'Digit1', ctrl: true, alt: false, shift: true, meta: true }
  assert.equal(formatHotkey(combo, true), '⌃⇧⌘1')
  assert.equal(formatHotkey(combo, false), 'Ctrl+Shift+Win+1')
  assert.equal(formatHotkey({ ...DEFAULT_HOTKEY, code: 'Enter' }, false), 'Alt+Enter')
})

test('hotkeyFromEvent captures the key with its modifiers', () => {
  assert.deepEqual(hotkeyFromEvent(keyEvent('KeyE', { ctrlKey: true, shiftKey: true })), {
    code: 'KeyE',
    ctrl: true,
    alt: false,
    shift: true,
    meta: false
  })
})

test('hotkeyFromEvent ignores bare modifiers and keys without Ctrl, Alt or Cmd', () => {
  assert.equal(hotkeyFromEvent(keyEvent('AltLeft', { altKey: true })), null)
  assert.equal(hotkeyFromEvent(keyEvent('MetaRight', { metaKey: true })), null)
  assert.equal(hotkeyFromEvent(keyEvent('KeyT')), null)
  assert.equal(hotkeyFromEvent(keyEvent('KeyT', { shiftKey: true })), null)
})
