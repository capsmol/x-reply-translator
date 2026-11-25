const autoTranslateInput = document.getElementById('autoTranslate')
const apiKeyInput = document.getElementById('apiKey')
const status = document.getElementById('status')

const load = async () => {
  const { autoTranslate } = await chrome.storage.sync.get({ autoTranslate: true })
  const { apiKey } = await chrome.storage.local.get({ apiKey: '' })
  autoTranslateInput.checked = autoTranslate
  apiKeyInput.value = apiKey
}

const save = async () => {
  await chrome.storage.sync.set({ autoTranslate: autoTranslateInput.checked })
  await chrome.storage.local.set({ apiKey: apiKeyInput.value.trim() })
  status.textContent = 'Сохранено'
}

document.getElementById('save').addEventListener('click', () => {
  save().catch((err) => {
    status.textContent = `Ошибка: ${err.message}`
  })
})

load()
