import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReplyPrompt,
  parseGoogleResponse,
  translateGoogle,
  normalizeBaseUrl,
  translateReplyWithLLM
} from '../src/translate.js'

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
})

const recordingFetch = (response) => {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    return response
  }
  return { calls, fetchFn }
}

test('parseGoogleResponse joins segments and reports source language', () => {
  const data = [[['Привет. ', 'Hello. '], ['Как дела?', 'How are you?']], null, 'en']
  assert.deepEqual(parseGoogleResponse(data), { text: 'Привет. Как дела?', sourceLang: 'en' })
})

test('parseGoogleResponse rejects unexpected payloads', () => {
  assert.throws(() => parseGoogleResponse({ error: 'nope' }))
  assert.throws(() => parseGoogleResponse(null))
})

test('translateGoogle posts the text and target language', async () => {
  const { calls, fetchFn } = recordingFetch(jsonResponse([[['Привет', 'Hello']], null, 'en']))
  const result = await translateGoogle('Hello', 'ru', fetchFn)
  assert.equal(result.text, 'Привет')
  assert.match(calls[0].url, /tl=ru/)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.body.get('q'), 'Hello')
})

test('translateGoogle throws on HTTP errors', async () => {
  const { fetchFn } = recordingFetch(jsonResponse({}, 429))
  await assert.rejects(translateGoogle('Hello', 'ru', fetchFn), /429/)
})

test('buildReplyPrompt includes the tweet only when there is context', () => {
  assert.match(buildReplyPrompt('Согласен', 'Ship fast'), /<tweet>\nShip fast\n<\/tweet>/)
  assert.doesNotMatch(buildReplyPrompt('Согласен', ''), /<tweet>/)
  assert.match(buildReplyPrompt('Согласен', ''), /<draft>\nСогласен\n<\/draft>/)
})

const completion = (content, finish_reason = 'stop') => jsonResponse({ choices: [{ message: { content }, finish_reason }] })

const llmArgs = {
  text: 'Согласен',
  context: 'Ship fast',
  apiKey: 'key-1',
  baseUrl: 'https://api.openai.com/v1',
  model: 'model-1',
  systemPrompt: 'Translate it'
}

test('normalizeBaseUrl trims and requires https', () => {
  assert.equal(normalizeBaseUrl(' https://api.example.com/v1/ '), 'https://api.example.com/v1')
  assert.throws(() => normalizeBaseUrl('http://api.example.com/v1'))
  assert.throws(() => normalizeBaseUrl('api.example.com'))
  assert.throws(() => normalizeBaseUrl(''))
})

test('translateReplyWithLLM calls the chosen endpoint with the key, model and prompt', async () => {
  const { calls, fetchFn } = recordingFetch(completion(' Totally agree. '))
  const result = await translateReplyWithLLM(llmArgs, fetchFn)
  assert.deepEqual(result, { text: 'Totally agree.' })
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(calls[0].init.headers.authorization, 'Bearer key-1')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.model, 'model-1')
  assert.deepEqual(body.messages[0], { role: 'system', content: 'Translate it' })
  assert.match(body.messages[1].content, /Согласен/)
  assert.match(body.messages[1].content, /Ship fast/)
})

test('translateReplyWithLLM adds the browser-access header only for Anthropic', async () => {
  const header = 'anthropic-dangerous-direct-browser-access'
  const anthropic = recordingFetch(completion('ok'))
  await translateReplyWithLLM({ ...llmArgs, baseUrl: 'https://api.anthropic.com/v1' }, anthropic.fetchFn)
  assert.equal(anthropic.calls[0].init.headers[header], 'true')
  const openai = recordingFetch(completion('ok'))
  await translateReplyWithLLM(llmArgs, openai.fetchFn)
  assert.equal(header in openai.calls[0].init.headers, false)
})

test('translateReplyWithLLM surfaces API error messages in any common shape', async () => {
  const failWith = (body) => translateReplyWithLLM(llmArgs, recordingFetch(jsonResponse(body, 401)).fetchFn)
  await assert.rejects(failWith({ error: { message: 'Incorrect API key provided' } }), /api\.openai\.com: Incorrect API key/)
  await assert.rejects(failWith({ error: 'bad key' }), /bad key/)
  await assert.rejects(failWith({ message: 'no access' }), /no access/)
  await assert.rejects(failWith({ detail: 'Invalid API Key' }), /Invalid API Key/)
  await assert.rejects(failWith([{ error: { message: 'Please pass a valid API key' } }]), /valid API key/)
  await assert.rejects(failWith({}), /HTTP 401/)
})

test('translateReplyWithLLM rejects empty and truncated replies', async () => {
  await assert.rejects(translateReplyWithLLM(llmArgs, recordingFetch(completion('')).fetchFn))
  await assert.rejects(translateReplyWithLLM(llmArgs, recordingFetch(completion('Totally', 'length')).fetchFn), /обрезан/)
  await assert.rejects(translateReplyWithLLM(llmArgs, recordingFetch(jsonResponse({ choices: [] })).fetchFn))
})
