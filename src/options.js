import { DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT, normalizeBaseUrl } from './translate.js'
import { DEFAULT_HOTKEY, formatHotkey, hotkeyFromEvent } from './hotkey.js'

const PROVIDERS = [
  { name: 'OpenAI (ChatGPT)', baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL },
  { name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' },
  { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5.1' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', model: 'grok-4' },
  { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' }
]
const CUSTOM_PROVIDER = 'custom'
const IS_MAC = navigator.platform.startsWith('Mac')

const field = (id) => document.getElementById(id)
const autoTranslateInput = field('autoTranslate')
const hotkeyInput = field('hotkey')
const providerSelect = field('provider')
const baseUrlInput = field('baseUrl')
const modelInput = field('model')
const apiKeyInput = field('apiKey')
const promptInput = field('systemPrompt')
const status = field('status')

let hotkey = DEFAULT_HOTKEY

const showStatus = (text, isError = false) => {
  status.textContent = text
  status.classList.toggle('error', isError)
}

const showHotkey = () => {
  hotkeyInput.value = formatHotkey(hotkey, IS_MAC)
}

const fillProviders = () => {
  const options = PROVIDERS.map(({ name, baseUrl }) => new Option(name, baseUrl))
  providerSelect.append(...options, new Option('Другой (OpenAI-совместимый)', CUSTOM_PROVIDER))
}

const selectProviderFor = (baseUrl) => {
  const known = PROVIDERS.some((provider) => provider.baseUrl === baseUrl)
  providerSelect.value = known ? baseUrl : CUSTOM_PROVIDER
}

const showTab = (name) => {
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === name))
  })
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name
  })
}

const onProviderChange = () => {
  const provider = PROVIDERS.find(({ baseUrl }) => baseUrl === providerSelect.value)
  baseUrlInput.value = provider?.baseUrl ?? ''
  modelInput.value = provider?.model ?? ''
}

const onHotkeyKeydown = (event) => {
  if (event.code === 'Tab') return
  event.preventDefault()
  const pressed = hotkeyFromEvent(event)
  if (!pressed) return
  hotkey = pressed
  showHotkey()
}

const load = async () => {
  fillProviders()
  const synced = await chrome.storage.sync.get({ autoTranslate: true, hotkey: DEFAULT_HOTKEY })
  const local = await chrome.storage.local.get({
    apiKey: '',
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    systemPrompt: ''
  })
  hotkey = synced.hotkey
  autoTranslateInput.checked = synced.autoTranslate
  baseUrlInput.value = local.baseUrl
  modelInput.value = local.model
  apiKeyInput.value = local.apiKey
  promptInput.value = local.systemPrompt || DEFAULT_SYSTEM_PROMPT
  selectProviderFor(local.baseUrl)
  showHotkey()
}

const requestHostAccess = async (baseUrl) => {
  const granted = await chrome.permissions.request({ origins: [`${new URL(baseUrl).origin}/*`] })
  if (!granted) throw new Error('без разрешения на доступ к этому адресу перевод через модель работать не будет')
}

const save = async () => {
  const apiKey = apiKeyInput.value.trim()
  const model = modelInput.value.trim()
  const systemPrompt = promptInput.value.trim()
  const baseUrl = normalizeBaseUrl(baseUrlInput.value)
  if (apiKey && !model) throw new Error('укажите название модели')
  await chrome.storage.sync.set({
    autoTranslate: autoTranslateInput.checked,
    hotkey: { ...hotkey, label: formatHotkey(hotkey, IS_MAC) }
  })
  await chrome.storage.local.set({
    apiKey,
    baseUrl,
    model,
    systemPrompt: systemPrompt === DEFAULT_SYSTEM_PROMPT ? '' : systemPrompt
  })
  showStatus('Сохранено')
  if (apiKey) await requestHostAccess(baseUrl)
}

document.querySelectorAll('[data-tab]').forEach((tab) => {
  tab.addEventListener('click', () => showTab(tab.dataset.tab))
})
providerSelect.addEventListener('change', onProviderChange)
baseUrlInput.addEventListener('input', () => selectProviderFor(baseUrlInput.value.trim()))
hotkeyInput.addEventListener('keydown', onHotkeyKeydown)
field('resetPrompt').addEventListener('click', () => {
  promptInput.value = DEFAULT_SYSTEM_PROMPT
})
field('save').addEventListener('click', () => {
  save().catch((err) => showStatus(`Ошибка: ${err.message}`, true))
})

load().catch((err) => showStatus(`Ошибка: ${err.message}`, true))
