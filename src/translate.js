const GOOGLE_URL = 'https://translate.googleapis.com/translate_a/single'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL = 'gpt-5.1'
const OPENAI_MAX_TOKENS = 1024
const REPLY_SYSTEM_PROMPT = [
  'You turn a draft reply written in Russian into natural, casual English for posting on X (Twitter).',
  'Keep the meaning, tone and approximate length. It must read like a native speaker wrote it, not like a translation.',
  'Keep @mentions, hashtags, URLs and emoji unchanged. Do not add hashtags, emoji or facts that are not in the draft.',
  'If the draft is already in English, only fix mistakes and awkward phrasing.',
  'Output only the final reply text, with no quotes and no commentary.'
].join(' ')

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

const readOpenAIError = async (res) => {
  const body = await res.json().catch(() => null)
  return body?.error?.message ?? `HTTP ${res.status}`
}

export const translateReplyWithOpenAI = async ({ text, context, apiKey }, fetchFn = fetch) => {
  const res = await fetchFn(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_completion_tokens: OPENAI_MAX_TOKENS,
      messages: [
        { role: 'system', content: REPLY_SYSTEM_PROMPT },
        { role: 'user', content: buildReplyPrompt(text, context) }
      ]
    })
  })
  if (!res.ok) throw new Error(`OpenAI: ${await readOpenAIError(res)}`)
  const choice = (await res.json()).choices?.[0]
  if (choice?.finish_reason === 'length') throw new Error('OpenAI: ответ слишком длинный и был обрезан')
  const reply = (choice?.message?.content ?? '').trim()
  if (!reply) throw new Error('OpenAI вернул пустой ответ')
  return { text: reply }
}
