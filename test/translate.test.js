import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReplyPrompt,
  parseGoogleResponse,
  translateGoogle,
  translateReplyWithOpenAI
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

test('translateReplyWithOpenAI sends the key and returns the reply', async () => {
  const { calls, fetchFn } = recordingFetch(completion(' Totally agree. '))
  const result = await translateReplyWithOpenAI({ text: 'Согласен', context: 'Ship fast', apiKey: 'key-1' }, fetchFn)
  assert.deepEqual(result, { text: 'Totally agree.' })
  assert.equal(calls[0].init.headers.authorization, 'Bearer key-1')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.messages[0].role, 'system')
  assert.match(body.messages[1].content, /Согласен/)
  assert.match(body.messages[1].content, /Ship fast/)
})

test('translateReplyWithOpenAI surfaces API error messages', async () => {
  const { fetchFn } = recordingFetch(jsonResponse({ error: { message: 'Incorrect API key provided' } }, 401))
  await assert.rejects(
    translateReplyWithOpenAI({ text: 'Согласен', context: '', apiKey: 'bad' }, fetchFn),
    /Incorrect API key/
  )
})

test('translateReplyWithOpenAI rejects empty and truncated replies', async () => {
  const args = { text: 'Согласен', context: '', apiKey: 'k' }
  await assert.rejects(translateReplyWithOpenAI(args, recordingFetch(completion('')).fetchFn))
  await assert.rejects(translateReplyWithOpenAI(args, recordingFetch(completion('Totally', 'length')).fetchFn), /обрезан/)
  await assert.rejects(translateReplyWithOpenAI(args, recordingFetch(jsonResponse({ choices: [] })).fetchFn))
})
