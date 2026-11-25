import { translateGoogle, translateReplyWithOpenAI } from './translate.js'

chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })

const translateReply = async ({ text, context }) => {
  const { apiKey } = await chrome.storage.local.get('apiKey')
  if (!apiKey) return translateGoogle(text, 'en')
  return translateReplyWithOpenAI({ text, context, apiKey })
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
