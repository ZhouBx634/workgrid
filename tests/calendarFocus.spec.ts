import { expect, test, type Page } from '@playwright/test'

const TASKS_KEY = 'workgrid.tasks.v2'

function task(id: string, hour: number | null, minutes = 0, duration = 60, dayOffset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hour ?? 0, minutes, 0, 0)
  return { id, title: id, color: 'blue', duration, start: hour === null ? null : date.toISOString(), createdAt: '2026-10-05T00:00:00.000Z', status: 'todo', completedAt: null, reminderMinutes: null, remindedAt: null, endReminder: false, endRemindedAt: null, tags: [], deletedAt: null }
}

async function setup(page: Page, tasks = [task('早课', 8, 30, 90), task('晚课', 19, 0, 140), task('原有日程', 10, 12, 56)]) {
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value)) }, { key: TASKS_KEY, value: tasks })
  await page.goto('/')
}

async function saved(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), TASKS_KEY)
}

async function settled(page: Page) {
  await expect(page.locator('.duration-timeline')).toHaveAttribute('aria-busy', 'false')
  expect(await page.locator('.duration-timeline').evaluate((element) => (element as HTMLElement).inert)).toBe(false)
}

async function range(page: Page, start: number, end: number) {
  await expect(page.locator('.duration-timeline')).toHaveAttribute('data-range-start', String(start))
  await expect(page.locator('.duration-timeline')).toHaveAttribute('data-range-end', String(end))
  await settled(page)
}

test('focus enlarges 08:00–22:00 across week, day and today without altering tasks', async ({ page }, testInfo) => {
  await setup(page)
  const before = await saved(page)
  const oldHeight = await page.locator('.calendar-event', { hasText: '早课' }).evaluate((element) => Number.parseFloat((element as HTMLElement).style.height))
  await page.getByRole('button', { name: '聚焦日程' }).click()
  for (const view of ['周', '日', '今日']) {
    await page.getByRole('button', { name: view, exact: true }).click()
    await range(page, 480, 1320)
    await expect(page.getByRole('button', { name: '聚焦日程' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('08:00–22:00', { exact: true })).toBeVisible()
    await expect.poll(() => page.locator('.calendar-surface').evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
    const event = page.locator('.calendar-event', { hasText: '原有日程' })
    await expect(event).toHaveAttribute('aria-label', /10:12 至 11:08/)
    const layout = await event.evaluate((element) => ({ top: Number.parseFloat((element as HTMLElement).style.top), height: Number.parseFloat((element as HTMLElement).style.height) }))
    const slotHeight = await page.locator('.duration-timeline').evaluate((element) => Number.parseFloat((element as HTMLElement).style.getPropertyValue('--slot-height')))
    expect(layout.top).toBeCloseTo((10 * 60 + 12 - 480) / 15 * slotHeight)
    expect(layout.height).toBeCloseTo(56 / 15 * slotHeight)
    expect(await saved(page)).toEqual(before)
  }
  await page.getByRole('button', { name: '全天总览' }).click()
  await range(page, 0, 1440)
  const overviewHeight = await page.locator('.calendar-event', { hasText: '早课' }).evaluate((element) => Number.parseFloat((element as HTMLElement).style.height))
  await page.getByRole('button', { name: '聚焦日程' }).click()
  await settled(page)
  expect(await page.locator('.calendar-event', { hasText: '早课' }).evaluate((element) => Number.parseFloat((element as HTMLElement).style.height))).toBeGreaterThan(overviewHeight)
  expect(oldHeight).toBeGreaterThan(0)
  await page.locator('.calendar-panel').screenshot({ path: testInfo.outputPath('focused-calendar.png') })
  await page.reload()
  await range(page, 480, 1320)
  await expect(page.getByLabel('日历缩放比例')).toHaveText('聚焦')
  expect(await saved(page)).toEqual(before)
  await page.getByRole('button', { name: '恢复默认缩放' }).click()
  await range(page, 0, 1440)
})

test('focus responds to visible filters, dates and new edits and excludes backlog and trash', async ({ page }) => {
  await setup(page, [task('早课', 8, 30, 90), task('晚课', 19, 0, 140), task('明天早课', 6, 0, 120, 1), task('未安排', null), { ...task('已删除', 1), deletedAt: '2026-10-05T00:00:00Z' }])
  await page.getByRole('button', { name: '日', exact: true }).click()
  await page.getByRole('button', { name: '聚焦日程' }).click()
  await range(page, 480, 1320)
  await page.getByLabel('搜索工作').fill('早课')
  await range(page, 420, 660)
  await page.getByLabel('搜索工作').fill('')
  await range(page, 480, 1320)
  await page.getByRole('button', { name: '下一周期' }).click()
  await range(page, 300, 540)
  await page.getByRole('button', { name: '下一周期' }).click()
  await range(page, 0, 1440)
  await expect(page.getByText('暂无日程 · 显示全天')).toBeVisible()
  await page.locator('.today-button').click()
  await range(page, 480, 1320)
  await page.locator('.calendar-event', { hasText: '晚课' }).click()
  const dialog = page.getByRole('dialog', { name: '编辑工作方块' })
  const date = task('新时间', 22).start!
  const local = new Date(new Date(date).getTime() - new Date(date).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  await dialog.getByLabel('开始时间').fill(local)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await range(page, 480, 1440)
})

for (const fixture of [
  { name: 'empty view', tasks: [], start: 0, end: 1440 },
  { name: 'midnight start', tasks: [task('午夜', 0, 0, 1)], start: 0, end: 240 },
  { name: 'overnight end', tasks: [task('跨午夜', 23, 59, 120)], start: 1200, end: 1440 },
]) {
  test(`focus handles ${fixture.name} and fits after viewport resize`, async ({ page }) => {
    await setup(page, fixture.tasks)
    const before = await saved(page)
    await page.getByRole('button', { name: '聚焦日程' }).click()
    await range(page, fixture.start, fixture.end)
    const viewport = page.viewportSize()!
    await page.setViewportSize({ width: viewport.width, height: viewport.height - 150 })
    await settled(page)
    await expect.poll(() => page.locator('.calendar-surface').evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const element of await page.locator('.calendar-zoom button').all()) {
      const bounds = await element.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
    }
    expect(await saved(page)).toEqual(before)
  })
}

test('focus transition really animates, locks only the timeline, then restores exact geometry', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await setup(page)
  await page.getByRole('button', { name: '全天总览' }).click()
  const state = await page.evaluate(async () => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.calendar-zoom button')).find((element) => element.textContent?.includes('聚焦日程'))!
    button.click()
    await new Promise(requestAnimationFrame)
    const timeline = document.querySelector<HTMLElement>('.duration-timeline')!
    const track = document.querySelector<HTMLElement>('.day-track')!
    return { inert: timeline.inert, busy: timeline.getAttribute('aria-busy'), animations: track.getAnimations().length, zoomControlsEnabled: !button.disabled }
  })
  expect(state).toEqual({ inert: true, busy: 'true', animations: 1, zoomControlsEnabled: true })
  await settled(page)
  expect(await page.locator('.day-track').first().evaluate((element) => getComputedStyle(element).transform)).toBe('none')
  await page.locator('.calendar-event', { hasText: '原有日程' }).click()
  await expect(page.getByRole('dialog', { name: '编辑工作方块' })).toBeVisible()
})

test('reduced-motion preference skips zoom animation and rapid mode switching leaves no lock', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await setup(page)
  await page.getByRole('button', { name: '聚焦日程' }).click()
  await range(page, 480, 1320)
  expect(await page.locator('.day-track').first().evaluate((element) => element.getAnimations().length)).toBe(0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  for (const name of ['全天总览', '聚焦日程', '恢复默认缩放', '聚焦日程', '全天总览']) await page.getByRole('button', { name, exact: true }).click()
  await range(page, 0, 1440)
  expect(await page.locator('.day-track').first().evaluate((element) => element.getAnimations().length)).toBe(0)
})

test('tap scheduling in focus uses its non-midnight time origin', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile tap scheduling')
  await setup(page, [task('早课', 8, 30, 90), task('晚课', 19, 0, 140), task('点选任务', null)])
  await page.getByRole('button', { name: '聚焦日程' }).click()
  await range(page, 480, 1320)
  await page.locator('.task-card', { hasText: '点选任务' }).tap()
  await page.locator('.day-track').first().locator('.drop-slot').nth(10).tap()
  await expect.poll(async () => new Date((await saved(page)).find((item: { id: string }) => item.id === '点选任务').start).toTimeString().slice(0, 5)).toBe('10:30')
})

test('focus range stays fixed during resize and adapts only after release', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Resize handle is desktop-only')
  await setup(page, [task('调整任务', 9)])
  await page.getByRole('button', { name: '聚焦日程' }).click()
  await range(page, 420, 660)
  const original = await saved(page)
  const slotHeight = await page.locator('.duration-timeline').evaluate((element) => Number.parseFloat((element as HTMLElement).style.getPropertyValue('--slot-height')))
  const handle = page.getByRole('button', { name: '调整时长' })
  const startY = await handle.evaluate((element, height) => {
    const y = element.getBoundingClientRect().y + 2
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', clientY: y }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientY: y + height * 4 }))
    return y
  }, slotHeight)
  await range(page, 420, 660)
  expect(await saved(page)).toEqual(original)
  await handle.evaluate((element, y) => {
    window.dispatchEvent(new PointerEvent('pointerup', { clientY: y }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }, startY + slotHeight * 4)
  await range(page, 480, 720)
  expect((await saved(page))[0].duration).toBe(120)
  expect((await saved(page))[0].start).toBe(original[0].start)
  await expect(page.getByRole('dialog', { name: '编辑工作方块' })).toHaveCount(0)
})
