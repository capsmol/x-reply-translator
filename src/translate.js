const GOOGLE_URL = 'https://translate.googleapis.com/translate_a/single'
const EXTRA_HEADERS = {
  'api.anthropic.com': { 'anthropic-dangerous-direct-browser-access': 'true' }
}

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_MODEL = 'gpt-5.1'
export const DEFAULT_SYSTEM_PROMPT = [
  'You turn a draft reply written in Russian into natural, casual English for posting on X (Twitter).',
  'Keep the meaning, tone and approximate length. It must read like a native speaker wrote it, not like a translation.',
  'Keep @mentions, hashtags, URLs and emoji unchanged. Do not add hashtags, emoji or facts that are not in the draft.',
  'If the draft is already in English, only fix mistakes and awkward phrasing.',
  'Output only the final reply text, with no quotes and no commentary.'
].join('\n')

export const parseGoogleResponse = (data) => {
  if (!Array.isArray(data?.[0])) throw new Error('Неожиданный ответ Google Translate')
  return {
    text: data[0].map((segment) => segment?.[0] ?? '').join(''),
    sourceLang: data[2] ?? null
  }
}

export const translateGoogle = async (text, target, fetchFn = fetch) => {
  const query = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: target, dt: 't' })
  const res = await fetchFn(`${GOOGLE_URL}?${query}`, {
    method: 'POST',
    body: new URLSearchParams({ q: text })
  })
  if (!res.ok) throw new Error(`Google Translate: HTTP ${res.status}`)
  return parseGoogleResponse(await res.json())
}

export const buildReplyPrompt = (draft, context) => {
  const draftPart = `Draft reply to rewrite in English:\n<draft>\n${draft}\n</draft>`
  if (!context) return draftPart
  return `Tweet being replied to (context only, do not translate it):\n<tweet>\n${context}\n</tweet>\n\n${draftPart}`
}

export const normalizeBaseUrl = (value) => {
  const trimmed = value.trim().replace(/\/+$/, '')
  const url = URL.canParse(trimmed) ? new URL(trimmed) : null
  if (url?.protocol !== 'https:') throw new Error('адрес API должен начинаться с https://')
  return trimmed
}

const readApiError = async (res) => {
  const parsed = await res.json().catch(() => null)
  const body = Array.isArray(parsed) ? parsed[0] : parsed
  const error = body?.error
  const message = typeof error === 'string' ? error : (error?.message ?? body?.message ?? body?.detail)
  return typeof message === 'string' ? message : `HTTP ${res.status}`
}

export const translateReplyWithLLM = async (
  { text, context, apiKey, baseUrl, model, systemPrompt },
  fetchFn = fetch
) => {
  const { hostname } = new URL(baseUrl)
  const res = await fetchFn(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...EXTRA_HEADERS[hostname]
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildReplyPrompt(text, context) }
      ]
    })
  })
  if (!res.ok) throw new Error(`${hostname}: ${await readApiError(res)}`)
  const choice = (await res.json()).choices?.[0]
  if (choice?.finish_reason === 'length') throw new Error(`${hostname}: ответ слишком длинный и был обрезан`)
  const reply = (choice?.message?.content ?? '').trim()
  if (!reply) throw new Error(`${hostname}: модель вернула пустой ответ`)
  return { text: reply }
}
