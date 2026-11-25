const TWEET_TEXT = '[data-testid="tweetText"]'
const EDITOR = '[data-testid^="tweetTextarea_"][contenteditable="true"]'
const FOCAL_TWEET_TEXT = `article[tabindex="-1"] ${TWEET_TEXT}`
const NATIVE_LANG = 'ru'
const SCAN_DELAY_MS = 200
const SELECTION_SYNC_MS = 50
const RETRY_COOLDOWN_MS = 30000
const CYRILLIC = /[а-яё]/i
const DEFAULT_HOTKEY = {
  code: 'KeyT',
  ctrl: false,
  alt: true,
  shift: false,
  meta: false,
  label: navigator.platform.startsWith('Mac') ? '⌥T' : 'Alt+T'
}

const tweetCache = new Map()
const watchedText = new WeakMap()
let autoTranslate = true
let hotkey = DEFAULT_HOTKEY
let scanScheduled = false

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const readText = (node) => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeName === 'IMG') return node.alt
  return [...node.childNodes].map(readText).join('')
}

const request = async (message) => {
  const response = await chrome.runtime.sendMessage(message)
  if (!response?.ok) throw new Error(response?.error ?? 'нет ответа от расширения')
  return response
}

const element = (tag, className, text = '') => {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

const translateTweet = (text) => {
  if (tweetCache.has(text)) return tweetCache.get(text)
  const pending = request({ type: 'tweet', text }).catch((err) => {
    setTimeout(() => tweetCache.delete(text), RETRY_COOLDOWN_MS)
    throw err
  })
  tweetCache.set(text, pending)
  return pending
}

const removeTranslation = (tweetEl) => {
  const sibling = tweetEl.nextElementSibling
  if (sibling?.classList.contains('xrt-translation')) sibling.remove()
}

const insertTranslation = (tweetEl, text, box) => {
  if (watchedText.get(tweetEl) !== text) return
  removeTranslation(tweetEl)
  tweetEl.insertAdjacentElement('afterend', box)
}

const showTweetTranslation = async (tweetEl) => {
  const text = watchedText.get(tweetEl)
  try {
    const { text: translated, sourceLang } = await translateTweet(text)
    if (sourceLang === NATIVE_LANG || translated.trim() === text) return
    insertTranslation(tweetEl, text, element('div', 'xrt-translation', translated))
  } catch (err) {
    insertTranslation(tweetEl, text, element('div', 'xrt-translation xrt-error', `Перевод не удался: ${err.message}`))
  }
}

const visibility = new IntersectionObserver(
  (entries) => {
    entries
      .filter((entry) => entry.isIntersecting)
      .forEach((entry) => {
        visibility.unobserve(entry.target)
        showTweetTranslation(entry.target)
      })
  },
  { rootMargin: '300px' }
)

const watchTweet = (tweetEl) => {
  if (tweetEl.lang?.startsWith(NATIVE_LANG)) return
  const text = readText(tweetEl).trim()
  if (!text || watchedText.get(tweetEl) === text) return
  watchedText.set(tweetEl, text)
  removeTranslation(tweetEl)
  visibility.unobserve(tweetEl)
  visibility.observe(tweetEl)
}

const findReplyContext = (editor) => {
  const dialog = editor.closest('[role="dialog"]')
  const tweetEl = dialog ? dialog.querySelector(TWEET_TEXT) : document.querySelector(FOCAL_TWEET_TEXT)
  return tweetEl ? readText(tweetEl).trim() : ''
}

const squash = (text) => text.replace(/\s+/g, '')

const pasteOverSelection = (editor, text) => {
  const clipboardData = new DataTransfer()
  clipboardData.setData('text/plain', text)
  editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
}

const selectAll = async (editor) => {
  editor.focus()
  window.getSelection().selectAllChildren(editor)
  await wait(SELECTION_SYNC_MS)
}

const replaceEditorText = async (editor, text) => {
  const before = squash(editor.innerText)
  if (before === squash(text)) return
  await selectAll(editor)
  pasteOverSelection(editor, text)
  await wait(SELECTION_SYNC_MS)
  if (squash(editor.innerText) !== before) return
  await selectAll(editor)
  document.execCommand('insertText', false, text)
  await wait(SELECTION_SYNC_MS)
  if (squash(editor.innerText) === before) throw new Error(`X не принял текст. Скопируйте вручную: ${text}`)
}

const barAnchor = (editor) =>
  editor.closest('[data-testid$="RichTextInputContainer"]') ?? editor.closest('.DraftEditor-root') ?? editor

const findBar = (editor) => {
  const sibling = barAnchor(editor).nextElementSibling
  return sibling?.classList.contains('xrt-bar') ? sibling : null
}

const setStatus = (bar, text) => {
  bar.querySelector('.xrt-status').textContent = text
}

const showOriginal = (bar, draft) => {
  bar.querySelector('.xrt-original-text').textContent = draft
  bar.querySelector('.xrt-original').hidden = !draft
}

const translateDraft = async (editor) => {
  const bar = ensureBar(editor)
  const draft = editor.innerText.trim()
  if (!draft || bar.dataset.busy) return
  bar.dataset.busy = '1'
  setStatus(bar, 'Перевожу…')
  try {
    const { text } = await request({ type: 'reply', text: draft, context: findReplyContext(editor) })
    if (editor.innerText.trim() !== draft) throw new Error('текст изменился, пока шёл перевод — нажмите ещё раз')
    await replaceEditorText(editor, text)
    if (CYRILLIC.test(draft)) showOriginal(bar, draft)
    setStatus(bar, '')
  } catch (err) {
    setStatus(bar, `Ошибка: ${err.message}`)
  } finally {
    delete bar.dataset.busy
  }
}

const restoreDraft = async (editor, bar) => {
  if (bar.dataset.busy) return
  bar.dataset.busy = '1'
  try {
    await replaceEditorText(editor, bar.querySelector('.xrt-original-text').textContent)
    showOriginal(bar, '')
  } catch (err) {
    setStatus(bar, `Ошибка: ${err.message}`)
  } finally {
    delete bar.dataset.busy
  }
}

const translateLabel = () => `RU → EN · ${hotkey.label}`

const createBar = (editor) => {
  const bar = element('div', 'xrt-bar')
  const translateButton = element('button', 'xrt-button xrt-translate', translateLabel())
  const restoreButton = element('button', 'xrt-button xrt-restore', 'Вернуть русский')
  const original = element('div', 'xrt-original')
  translateButton.type = 'button'
  restoreButton.type = 'button'
  original.hidden = true
  original.append(element('span', 'xrt-original-text'), restoreButton)
  bar.append(translateButton, element('span', 'xrt-status'), original)
  bar.addEventListener('mousedown', (event) => event.preventDefault())
  translateButton.addEventListener('click', () => translateDraft(editor))
  restoreButton.addEventListener('click', () => restoreDraft(editor, bar))
  return bar
}

function ensureBar(editor) {
  const existing = findBar(editor)
  if (existing) return existing
  const bar = createBar(editor)
  barAnchor(editor).insertAdjacentElement('afterend', bar)
  return bar
}

const syncBar = (editor) => {
  const bar = ensureBar(editor)
  const translateButton = bar.querySelector('.xrt-translate')
  if (translateButton.textContent !== translateLabel()) translateButton.textContent = translateLabel()
  if (!bar.dataset.busy && !editor.innerText.trim()) showOriginal(bar, '')
}

const scan = () => {
  scanScheduled = false
  document.querySelectorAll(EDITOR).forEach(syncBar)
  if (autoTranslate) document.querySelectorAll(TWEET_TEXT).forEach(watchTweet)
}

const scheduleScan = () => {
  if (scanScheduled) return
  scanScheduled = true
  setTimeout(scan, SCAN_DELAY_MS)
}

const matchesHotkey = (event) =>
  event.code === hotkey.code &&
  event.ctrlKey === hotkey.ctrl &&
  event.altKey === hotkey.alt &&
  event.shiftKey === hotkey.shift &&
  event.metaKey === hotkey.meta

const onKeydown = (event) => {
  if (!matchesHotkey(event)) return
  const editor = event.target.closest?.(EDITOR)
  if (!editor) return
  event.preventDefault()
  event.stopPropagation()
  translateDraft(editor)
}

const start = async () => {
  const settings = await chrome.storage.sync.get({ autoTranslate: true, hotkey: DEFAULT_HOTKEY })
  autoTranslate = settings.autoTranslate
  hotkey = settings.hotkey
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoTranslate) autoTranslate = changes.autoTranslate.newValue
    if (changes.hotkey) hotkey = changes.hotkey.newValue ?? DEFAULT_HOTKEY
    scheduleScan()
  })
  document.addEventListener('keydown', onKeydown, true)
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true })
  scan()
}

start().catch((err) => console.error('X Reply Translator:', err))
