import { expect, test, type Page } from '@playwright/test'

const KEY = 'workgrid.tasks.v2'
function task() {
  return { id: 'ordinary-course-overlap', title: '原有日程', color: 'purple', duration: 45, start: '2026-10-12T00:30:00.000Z', createdAt: '2026-10-01T00:00:00.000Z', status: 'todo', completedAt: null, reminderMinutes: 10, remindedAt: null, endReminder: true, endRemindedAt: null, tags: ['重要'], deletedAt: null }
}
function calendar(start = '20261012T083000', end = '20261012T100000', title = '测试课程', extra = '') {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//School Fixture//CN\r\nX-WR-CALNAME:测试课表\r\nBEGIN:VEVENT\r\nUID:fixture-lesson\r\nSUMMARY:${title}\r\nDTSTART;TZID=Asia/Shanghai:${start}\r\nDTEND;TZID=Asia/Shanghai:${end}\r\nLOCATION:教室甲\r\nDESCRIPTION:教师: 教师甲\\n教学班: 班级甲\r\n${extra}END:VEVENT\r\nEND:VCALENDAR`
}
async function setup(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-09T02:30:00.000Z'))
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value)) }, { key: KEY, value: [task()] })
  await page.goto('/')
}
async function open(page: Page, contents = calendar(), name = '课表.ics') {
  await page.getByRole('button', { name: '数据管理', exact: true }).click()
  await page.getByRole('menuitem', { name: '导入课表', exact: false }).click()
  await expect(page.getByRole('dialog', { name: '导入课表', exact: true })).toBeVisible()
  await page.locator('#course-file').setInputFiles({ name, mimeType: 'text/calendar', buffer: Buffer.from(contents) })
}
async function saved(page: Page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), KEY) }

test('ICS preview, overlaps, repeated import, persistence and undo preserve ordinary schedules', async ({ page }) => {
  await setup(page)
  const original = await saved(page)
  await open(page)
  await expect(page.locator('.course-preview')).toContainText('10/12 08:30')
  await expect(page.locator('.course-preview')).toContainText('90 分钟')
  await expect(page.locator('.course-preview')).toContainText('教室甲 · 教师甲')
  await expect(page.locator('.course-preview')).toContainText('与 1 项日程重叠')
  await expect(page.getByRole('radio', { name: /覆盖/ })).toHaveCount(0)
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await expect.poll(async () => (await saved(page)).length).toBe(2)
  expect((await saved(page))[0]).toEqual(original[0])
  await page.reload()
  await open(page)
  await expect(page.locator('.course-preview')).toContainText('已导入')
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeDisabled()
  expect((await saved(page)).length).toBe(2)
  await page.getByRole('button', { name: '关闭课表导入' }).click()
  // Simulate later ordinary changes, including a newly created task, then reload.
  await page.evaluate(key => {
    const values = JSON.parse(localStorage.getItem(key) ?? '[]')
    values[0].title = '原日程后来修改'
    values.push({ ...values[0], id: 'later-task', title: '导入后新增' })
    localStorage.setItem(key, JSON.stringify(values))
  }, KEY)
  await page.reload()
  await page.getByRole('button', { name: '数据管理', exact: true }).click()
  await page.getByRole('menuitem', { name: /撤销上次课表导入/ }).click()
  await expect.poll(async () => (await saved(page)).length).toBe(2)
  expect((await saved(page)).map((t: { title: string }) => t.title)).toEqual(['原日程后来修改', '导入后新增'])
})

test('updated courses require confirmation and leave other fields and schedules intact', async ({ page }) => {
  await setup(page)
  await open(page)
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await open(page, calendar('20261012T103000', '20261012T120000'))
  await expect(page.locator('.course-preview')).toContainText('课表有变化')
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeDisabled()
  await page.getByLabel('确认更新本节课').check()
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await expect.poll(async () => (await saved(page))[1].start).toBe('2026-10-12T02:30:00.000Z')
  expect((await saved(page))[0]).toEqual(task())
  await page.evaluate(key => {
    const values = JSON.parse(localStorage.getItem(key) ?? '[]')
    values[1].start = '2026-10-12T04:12:00.000Z'
    values[1].color = 'red'
    values[1].tags = ['自己改过']
    localStorage.setItem(key, JSON.stringify(values))
  }, KEY)
  await page.reload()
  await open(page, calendar('20261012T133000', '20261012T150000'))
  await expect(page.locator('.course-preview')).toContainText('已手动修改')
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeDisabled()
  await page.getByLabel('确认替换本节课的手动修改').check()
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await expect.poll(async () => (await saved(page))[1].start).toBe('2026-10-12T05:30:00.000Z')
  expect((await saved(page))[1].color).toBe('red')
  expect((await saved(page))[1].tags).toEqual(['自己改过'])
  expect((await saved(page))[0]).toEqual(task())
})

test('past courses are excluded by default and course selection and colors work', async ({ page }) => {
  await setup(page)
  await open(page, calendar('20260928T083000', '20260928T100000'))
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeDisabled()
  await page.getByLabel('课表导入范围').selectOption('all')
  await expect(page.locator('.course-preview')).toContainText('09/28 08:30')
  await page.getByLabel('测试课程', { exact: true }).uncheck()
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeDisabled()
  await page.getByLabel('测试课程', { exact: true }).check()
  await page.getByLabel('测试课程颜色').selectOption('green')
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await expect.poll(async () => (await saved(page)).length).toBe(2)
  expect((await saved(page))[1].color).toBe('green')
})

test('malicious titles remain text and mobile dialog stays within viewport', async ({ page }) => {
  await setup(page)
  let alerts = 0
  page.on('dialog', async dialog => { alerts++; await dialog.dismiss() })
  await open(page, calendar('20261012T083000', '20261012T100000', '<img src=x onerror=alert(1)>'))
  await expect(page.locator('.course-preview')).toContainText('<img src=x onerror=alert(1)>')
  await expect(page.locator('.course-import-dialog img')).toHaveCount(0)
  const box = await page.locator('.course-import-dialog').boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  expect(alerts).toBe(0)
})

test('invalid ICS and cancelled preview cannot modify any schedules', async ({ page }) => {
  await setup(page)
  const original = await saved(page)
  await open(page, 'BEGIN:VCALENDAR\r\n', 'broken.ics')
  await expect(page.getByRole('alert')).toContainText('完整')
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeDisabled()
  expect(await saved(page)).toEqual(original)
  await page.locator('#course-file').setInputFiles({ name: '课表.ics', mimeType: 'text/calendar', buffer: Buffer.from(calendar()) })
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeEnabled()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect(await saved(page)).toEqual(original)
})

test('storage failure aborts import without changing original data', async ({ page }) => {
  await setup(page)
  const original = await saved(page)
  await open(page)
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeEnabled()
  await page.evaluate(() => {
    const native = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'workgrid.tasks.v2') throw new DOMException('test quota', 'QuotaExceededError')
      return native.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await expect(page.locator('.toast')).toContainText('课表导入未完成')
  expect(await saved(page)).toEqual(original)
  expect(await page.evaluate(() => localStorage.getItem('workgrid.course-import-recovery.v1'))).toBeNull()
})

test('full semester preview handles 174 lessons and twelve courses on desktop and mobile', async ({ page }, testInfo) => {
  await setup(page)
  const start = new Date('2026-10-12T00:30:00Z')
  const blocks = Array.from({ length: 174 }, (_, index) => {
    const date = new Date(start.getTime() + Math.floor(index / 12) * 7 * 86400000).toISOString().slice(0, 10).replaceAll('-', '')
    return `BEGIN:VEVENT\r\nUID:synthetic-${index}\r\nSUMMARY:课程${index % 12 + 1}\r\nDTSTART;TZID=Asia/Shanghai:${date}T083000\r\nDTEND;TZID=Asia/Shanghai:${date}T100000\r\nLOCATION:教室甲\r\nDESCRIPTION:教师: 教师甲\r\nEND:VEVENT`
  })
  await open(page, `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Large School Fixture//CN\r\n${blocks.join('\r\n')}\r\nEND:VCALENDAR`)
  await expect(page.locator('.course-import-controls')).toContainText('12 门 · 174 节')
  await expect(page.locator('.course-selector input:checked')).toHaveCount(12)
  await expect(page.locator('.course-preview-row')).toHaveCount(174)
  const bounds = await page.locator('.course-import-dialog').boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  const courseLabel = await page.locator('.course-selector label').first().boundingBox()
  expect(courseLabel!.width).toBeGreaterThan(100)
  await page.screenshot({ path: testInfo.outputPath('course-import-preview.png') })
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await expect.poll(async () => (await saved(page)).length).toBe(175)
  expect((await saved(page))[0]).toEqual(task())
})
