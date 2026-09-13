import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { mockSavedApi } from './saved-api'

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations).toEqual([])
}

async function expectFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(page.viewportSize()!.width)
  const overflow = await page.locator('dialog[open]').evaluateAll((dialogs) =>
    dialogs.some((dialog) => dialog.scrollWidth > dialog.clientWidth + 1),
  )
  expect(overflow).toBe(false)
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ok' } }))
  await page.route('**/engine/api/compositions', (route) => route.fulfill({ json: [] }))
  await mockSavedApi(page, { name: 'Alex', birth_year: '1950', mood: 'Calm', music_preferences: 'Piano' })
})

for (const width of [320, 390, 800, 1440]) {
  test(`home, help, profile and songs are accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Sound Flux, music room' }).locator('.brand-blob')).toBeVisible()
    await expect(page.getByText('Saved on this device.', { exact: true })).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('Voice ready')
    await expect(page.locator('.connection-status')).toHaveCount(0)
    await expect(page.locator('.companion-link span')).toBeVisible()
    await expectFits(page)
    await expectAccessible(page)

    // Every visible button has a large target, including secondary actions.
    const smallButtons = await page.getByRole('button').evaluateAll((buttons) =>
      buttons.filter((button) => {
        const rect = button.getBoundingClientRect()
        return rect.width > 0 && (rect.height < 48 || rect.width < 48)
      }).map((button) => button.textContent),
    )
    expect(smallButtons).toEqual([])

    await page.getByRole('button', { name: 'How it works' }).click()
    await expectFits(page)
    await expectAccessible(page)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('button', { name: 'How it works' })).toBeFocused()

    await page.getByRole('button', { name: 'For companions' }).click()
    await expectFits(page)
    await expectAccessible(page)
    await page.getByRole('button', { name: 'Delete history', exact: true }).click()
    await expectAccessible(page)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await page.locator('summary').click()
    await expect(page.getByText('Conversations are saved on this device.')).toBeVisible()
    await expectAccessible(page)
    await page.getByRole('link', { name: 'Your songs' }).click()
    await expect(page.getByRole('main')).toBeFocused()
    await expect(page.getByRole('heading', { name: 'No songs yet' })).toBeVisible()
    await expectFits(page)
    await expectAccessible(page)
  })
}

test('keyboard controls, reduced motion and 200 percent text remain usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 640, height: 900 })
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to music room' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  const bright = page.getByRole('button', { name: 'Bright' })
  await bright.focus()
  await page.keyboard.press('Space')
  await expect(bright).toHaveAttribute('aria-pressed', 'true')
  expect(await bright.evaluate((button) => getComputedStyle(button).outlineWidth)).toBe('4px')
  const volume = page.getByRole('slider', { name: 'Volume', exact: true })
  await volume.focus()
  await page.keyboard.press('ArrowRight')
  await expect(volume).toHaveAttribute('aria-valuetext', '50 percent')
  await page.getByRole('button', { name: 'Read answers aloud' }).click()
  await expect(page.getByRole('button', { name: 'Read answers aloud' })).toHaveAttribute('aria-pressed', 'false')
  expect(await page.locator('.vinyl').evaluate((vinyl) => getComputedStyle(vinyl).animationName)).toBe('none')

  await page.addStyleTag({ content: 'html { font-size: 200%; }' })
  await expectFits(page)
  await page.getByRole('button', { name: 'For companions' }).click()
  await expectFits(page)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'How it works' }).click()
  await expectFits(page)
})

test('offline music remains usable without a voice status badge', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ status: 503 }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Start music', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause music', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Saved on this device.' })).toBeVisible()
  await expect(page.locator('.session-footer')).toHaveCount(0)
  expect(await page.locator('.floating-session-controls').evaluate((controls) => getComputedStyle(controls).position)).toBe('fixed')
  for (const instrument of ['Piano', 'Guitar', 'Glockenspiel', 'Drum']) {
    await page.getByRole('button', { name: `Play ${instrument}`, exact: true }).click()
  }
  await page.getByRole('button', { name: 'Stop music immediately' }).click()
  await expect(page.getByRole('button', { name: 'Start music', exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('Voice ready')
})
