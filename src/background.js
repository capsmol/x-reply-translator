import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  translateGoogle,
  translateReplyWithLLM
} from './translate.js'

const LLM_DEFAULTS = { apiKey: '', baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, systemPrompt: '' }

chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })

const translateReply = async ({ text, context }) => {
  const settings = await chrome.storage.local.get(LLM_DEFAULTS)
  if (!settings.apiKey) return translateGoogle(text, 'en')
  return translateReplyWithLLM({
    ...settings,
    text,
    context,
    systemPrompt: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT
  })
}

const handlers = {
  tweet: ({ text }) => translateGoogle(text, 'ru'),
  reply: translateReply
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type]
  if (!handler || typeof message.text !== 'string') return false
  handler(message).then(
    (result) => sendResponse({ ok: true, ...result }),
    (err) => sendResponse({ ok: false, error: err.message })
  )
  return true
})
