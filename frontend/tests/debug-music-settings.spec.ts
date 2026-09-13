import { expect, test } from '@playwright/test'
import { mockSavedApi } from './saved-api'

test('debug music controls autosave composition defaults', async ({ page }) => {
  let saves = 0
  let settings = {
    prompt: 'Warm piano and guitar',
    negative_prompt: 'vocals, noise',
    seconds: 15,
    strength: 0.8,
    steps: 8,
    cfg: 2,
    seed: 42,
    repeat: true,
    input_mix: 0.15,
    match_input: false,
    use_default: false,
    default_file: 'default_sound.wav',
  }
  await mockSavedApi(page)
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { chat_model: 'test-model' } }),
  )
  await page.route('**/engine/api/compositions', (route) =>
    route.fulfill({ json: [] }),
  )
  await page.route('**/engine/api/assets', (route) =>
    route.fulfill({ json: ['default_sound.wav', 'perfect.wav'] }),
  )
  await page.route('**/engine/api/settings', (route) => {
    if (route.request().method() === 'POST') {
      settings = route.request().postDataJSON()
      saves++
    }
    return route.fulfill({ json: settings })
  })

  await page.goto('/debug')
  const strength = page.getByRole('slider', { name: /Transformation strength/ })
  await expect(strength).toHaveValue('0.8')
  await strength.press('ArrowLeft')

  await expect(page.locator('.debug-settings-status')).toHaveText('Saved for the next composition.')
  expect(saves).toBe(1)
  expect(settings.strength).toBe(0.75)

  await page.reload()
  await expect(strength).toHaveValue('0.75')

  const useDefault = page.getByRole('checkbox', { name: 'Use default audio instead of generating' })
  const defaultFile = page.getByRole('combobox', { name: 'Default audio file' })
  await expect(defaultFile).toBeDisabled()
  await useDefault.check()
  await expect(defaultFile).toBeEnabled()
  await expect.poll(() => saves).toBe(2)
  await defaultFile.selectOption('perfect.wav')
  await expect.poll(() => saves).toBe(3)
  expect(settings).toMatchObject({ use_default: true, default_file: 'perfect.wav' })

  await page.getByRole('button', { name: 'Reset to defaults' }).click()
  await expect(strength).toHaveValue('0.8')
  await expect(page.getByRole('spinbutton', { name: 'Seed' })).toHaveValue('145081676')
  await expect(page.locator('.debug-settings-status')).toHaveText('Saved for the next composition.')
  expect(saves).toBe(4)
  expect(settings).toMatchObject({
    strength: 0.8,
    steps: 8,
    seed: 145081676,
    repeat: false,
    input_mix: 0.95,
    match_input: true,
    use_default: false,
    default_file: 'default_sound.wav',
  })
})
