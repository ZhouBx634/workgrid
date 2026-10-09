import { expect, test } from '@playwright/test'

test('Node fixtures and browser dates share the configured calendar timezone', async ({ page }) => {
  const instant = '2026-10-09T00:12:00.000Z'
  const localDate = new Date(instant)
  const expected = { hour: 8, minute: 12, day: 9, offset: -480 }

  expect(process.env.TZ).toBe('Asia/Shanghai')
  expect({ hour: localDate.getHours(), minute: localDate.getMinutes(), day: localDate.getDate(), offset: localDate.getTimezoneOffset() }).toEqual(expected)
  expect(await page.evaluate((value) => {
    const date = new Date(value)
    return { hour: date.getHours(), minute: date.getMinutes(), day: date.getDate(), offset: date.getTimezoneOffset() }
  }, instant)).toEqual(expected)
})
