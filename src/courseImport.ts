import ICAL from 'ical.js'
import { validateTaskList } from './backup.ts'
import type { CalendarImportSource, Task, TaskColor } from './types.ts'

export const MAX_ICS_BYTES = 2 * 1024 * 1024
const MAX_EVENTS = 5000
const COLORS: TaskColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'purple']

export interface CourseOccurrence {
  key: string
  calendarKey: string
  course: string
  start: string
  duration: number
  location: string
  teacher: string
  teachingClass: string
  color: TaskColor
}
export interface CourseCalendar {
  name: string
  events: CourseOccurrence[]
  warnings: string[]
  recurringThrough: string | null
}
export interface CourseChange { before: Task | null; after: Task }
export interface CourseImportResult {
  tasks: Task[]
  changes: CourseChange[]
  added: number
  updated: number
}
export type CourseAction = 'new' | 'unchanged' | 'update' | 'local-edit' | 'deleted'

async function digest(value: string) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
function colorFor(course: string): TaskColor {
  let hash = 0
  for (const char of course) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return COLORS[hash % COLORS.length]
}
function property(component: InstanceType<typeof ICAL.Component>, name: string) {
  return String(component.getFirstPropertyValue(name) ?? '')
}

/** Parse locally; no subscriptions, URLs, HTML, or attachments are executed. */
export async function parseCourseCalendar(text: string, now = new Date()): Promise<CourseCalendar> {
  if (new TextEncoder().encode(text).length > MAX_ICS_BYTES) throw new Error('课表超过 2MB，请导出较小的课表文件')
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!/^BEGIN:VCALENDAR\r?\n/i.test(trimmed) || !/\r?\nEND:VCALENDAR$/i.test(trimmed)) throw new Error('请选择完整的 ICS 日历文件')
  try {
    const calendar = new ICAL.Component(ICAL.parse(trimmed))
    if (calendar.name !== 'vcalendar') throw new Error('文件不是 ICS 日历')
    const components = calendar.getAllSubcomponents('vevent')
    if (!components.length) throw new Error('课表中没有课程事件')
    if (components.length > MAX_EVENTS) throw new Error('课表事件过多，最多支持 5000 节')
    // Common school exports omit VTIMEZONE for Shanghai. Supply its exact fixed offset.
    if (!calendar.getTimeZoneByID('Asia/Shanghai')) {
      calendar.addSubcomponent(ICAL.Component.fromString('BEGIN:VTIMEZONE\r\nTZID:Asia/Shanghai\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0800\r\nTZOFFSETTO:+0800\r\nEND:STANDARD\r\nEND:VTIMEZONE'))
    }
    const name = property(calendar, 'x-wr-calname').slice(0, 200) || '学校课表'
    const calendarKey = await digest(JSON.stringify([property(calendar, 'prodid'), name]))
    const warnings = new Set<string>()
    const events: CourseOccurrence[] = []
    const seen = new Set<string>()
    let visits = 0
    let recurring = false
    const horizon = new Date(now)
    horizon.setFullYear(horizon.getFullYear() + 1)
    horizon.setHours(0, 0, 0, 0)
    const masters = new Map<string, InstanceType<typeof ICAL.Component>>()
    const exceptionKeys = new Set<string>()
    for (const component of components) {
      if (!component.hasProperty('recurrence-id')) {
        const uid = property(component, 'uid')
        if (uid && masters.has(uid)) throw new Error('课表含重复课程编号，请重新导出')
        if (uid) masters.set(uid, component)
      }
      if (component.hasProperty('recurrence-id')) {
        const key = JSON.stringify([property(component, 'uid'), property(component, 'recurrence-id')])
        if (exceptionKeys.has(key)) throw new Error('课表含重复调课编号，请重新导出')
        exceptionKeys.add(key)
      }
      for (const field of ['dtstart', 'dtend', 'recurrence-id', 'exdate', 'rdate']) {
        for (const prop of component.getAllProperties(field)) {
          const tzid = prop.getParameter('tzid')
          if (tzid && tzid !== 'UTC' && !calendar.getTimeZoneByID(String(tzid))) throw new Error(`课表缺少时区定义：${String(tzid).slice(0, 100)}`)
          if (['date', 'date-time'].includes(prop.type)) {
            for (const raw of prop.toJSON().slice(3)) {
              const parts = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})Z?)?$/)
              if (!parts) throw new Error('课表中的日期格式无效')
              const [year, month, day, hour, minute, second] = parts.slice(1).map((value) => Number(value || 0))
              const check = new Date(0)
              check.setUTCFullYear(year, month - 1, day)
              if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) throw new Error('课表中的日期或时间不存在，请重新导出')
            }
          }
        }
      }
    }
    async function append(event: InstanceType<typeof ICAL.Event>, start: InstanceType<typeof ICAL.Time>, end: InstanceType<typeof ICAL.Time>, occurrenceKey: string) {
      if (property(event.component, 'status').toUpperCase() === 'CANCELLED') return
      if (start.isDate) { warnings.add('全天事件未导入；本次只导入有明确上课时间的课程'); return }
      const course = (event.summary || '').trim()
      if (!course || course.length > 60) throw new Error('有课程名称为空或超过 60 字，请检查课表')
      if (!start || !end) throw new Error('有课程缺少开始或结束时间')
      const startDate = start.toJSDate()
      const endDate = end.toJSDate()
      const duration = (endDate.getTime() - startDate.getTime()) / 60000
      if (!Number.isInteger(duration) || duration < 1 || duration > 720) throw new Error(`课程“${course}”时长无效；应为 1 至 720 整数分钟`)
      const location = (event.location || '').trim()
      const description = event.description || ''
      const teacher = description.match(/(?:^|\n)教师\s*[:：]\s*([^\n]*)/)?.[1]?.trim() || ''
      const teachingClass = description.match(/(?:^|\n)教学班\s*[:：]\s*([^\n]*)/)?.[1]?.trim() || ''
      if ([location, teacher, teachingClass].some((value) => value.length > 1000)) throw new Error('课程附加信息过长')
      if (seen.has(occurrenceKey)) throw new Error('课表含重复课程编号或发生时间，请重新导出')
      seen.add(occurrenceKey)
      events.push({ key: occurrenceKey, calendarKey, course, start: startDate.toISOString(), duration, location, teacher, teachingClass, color: colorFor(course) })
      if (events.length > MAX_EVENTS) throw new Error('课表展开后超过 5000 节，请缩小课表范围')
    }
    for (const component of components) {
      const event = new ICAL.Event(component)
      if (event.isRecurrenceException() && masters.has(event.uid)) continue
      if (property(component, 'status').toUpperCase() === 'CANCELLED') continue
      if (!component.hasProperty('dtstart') || (!component.hasProperty('dtend') && !component.hasProperty('duration'))) throw new Error('有课程缺少开始或结束时间')
      if ((event.uid || '').length > 512) throw new Error('课程编号过长')
      const uid = event.uid || `anonymous-${await digest(JSON.stringify([event.summary, event.startDate.toString(), event.location]))}`
      if (!event.uid) warnings.add('部分课程缺少编号；再次导入相同内容可去重，但调课后需手动核对')
      if (event.isRecurring()) {
        recurring = true
        if (event.startDate.toJSDate() >= horizon) throw new Error('重复课程起始日期超出未来一年，请稍后再导入')
        for (const rule of component.getAllProperties('rrule')) {
          const frequency = String((rule.getFirstValue() as InstanceType<typeof ICAL.Recur>).freq)
          if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(frequency)) throw new Error('暂不支持按小时、分钟或秒重复的课表')
        }
        // ICAL's RDATE-only iterator omits DTSTART unless it is explicitly in RDATE.
        // Add it to the recurrence set; the library still applies all EXDATE values.
        if (!component.hasProperty('rrule')) {
          const includesStart = component.getAllProperties('rdate').some((prop) => prop.getValues().some((value) => value instanceof ICAL.Time && value.compare(event.startDate) === 0))
          if (!includesStart) {
            const initial = component.addPropertyWithValue('rdate', event.startDate.clone())
            const tzid = component.getFirstProperty('dtstart')?.getParameter('tzid')
            if (tzid) initial.setParameter('tzid', tzid)
          }
        }
        const iterator = event.iterator()
        let occurrence = iterator.next()
        while (occurrence) {
          if (++visits > 20000) throw new Error('重复规则过于复杂或起始日期过早，请导出当前学期课表')
          if (occurrence.toJSDate() >= horizon) break
          const details = event.getOccurrenceDetails(occurrence)
          await append(details.item, details.startDate, details.endDate, JSON.stringify([uid, occurrence.toString()]))
          occurrence = iterator.next()
        }
      } else {
        await append(event, event.startDate, event.endDate, JSON.stringify([uid, event.isRecurrenceException() ? event.recurrenceId.toString() : null]))
      }
    }
    events.sort((a, b) => a.start.localeCompare(b.start))
    return { name, events, warnings: [...warnings], recurringThrough: recurring ? horizon.toISOString() : null }
  } catch (error) {
    if (error instanceof Error && !/^(ParserError|TypeError|RangeError)$/.test(error.name)) throw error
    throw new Error('无法解析课表，请从教务系统重新下载完整 ICS 文件')
  }
}

function matchingTask(tasks: Task[], course: CourseOccurrence) {
  return tasks.find((task) => task.calendarImport?.calendarKey === course.calendarKey && task.calendarImport.eventKey === course.key)
}
function sourceFor(course: CourseOccurrence): CalendarImportSource {
  return { calendarKey: course.calendarKey, eventKey: course.key, course: course.course, location: course.location, teacher: course.teacher, teachingClass: course.teachingClass, originalTitle: course.course, originalStart: course.start, originalDuration: course.duration }
}
export function classifyCourse(tasks: Task[], course: CourseOccurrence): CourseAction {
  const old = matchingTask(tasks, course)
  if (!old) return 'new'
  if (old.deletedAt) return 'deleted'
  const source = old.calendarImport!
  const sourceSame = JSON.stringify(source) === JSON.stringify(sourceFor(course))
  if (sourceSame) return 'unchanged'
  if (old.title !== source.originalTitle || old.start !== source.originalStart || old.duration !== source.originalDuration || old.recurrence) return 'local-edit'
  return 'update'
}
export function courseOverlapCount(tasks: Task[], course: CourseOccurrence) {
  const same = matchingTask(tasks, course)
  const start = Date.parse(course.start)
  const end = start + course.duration * 60000
  return tasks.filter((task) => !task.deletedAt && task.id !== same?.id && task.start && Date.parse(task.start) < end && Date.parse(task.start) + task.duration * 60000 > start).length
}

/** Recompute against current tasks at commit time; never replace the entire list from a stale preview. */
export function applyCourseImport(tasks: Task[], courses: CourseOccurrence[], updateKeys = new Set<string>()): CourseImportResult {
  const changes: CourseChange[] = []
  const working = [...tasks]
  let added = 0
  let updated = 0
  for (const course of courses) {
    const action = classifyCourse(working, course)
    const old = matchingTask(working, course)
    if (action === 'unchanged' || action === 'deleted' || (action !== 'new' && !updateKeys.has(course.key))) continue
    const calendarImport = sourceFor(course)
    const after: Task = old ? {
      ...old, title: course.course, start: course.start, duration: course.duration, calendarImport,
      remindedAt: old.start !== course.start ? null : old.remindedAt,
      endRemindedAt: old.start !== course.start || old.duration !== course.duration ? null : old.endRemindedAt,
    } : {
      id: globalThis.crypto.randomUUID(), title: course.course, color: course.color, duration: course.duration,
      start: course.start, createdAt: new Date().toISOString(), status: 'todo', completedAt: null,
      reminderMinutes: null, remindedAt: null, endReminder: false, endRemindedAt: null,
      tags: ['课表'], deletedAt: null, calendarImport,
    }
    changes.push({ before: old ?? null, after })
    if (old) { working[working.indexOf(old)] = after; updated++ }
    else { working.push(after); added++ }
  }
  return { tasks: working, changes, added, updated }
}

/** Skip later edits rather than overwrite them when undoing an import. */
export function undoCourseImport(tasks: Task[], changes: CourseChange[]) {
  let skipped = 0
  let reverted = 0
  const byId = new Map(changes.map((change) => [change.after.id, change]))
  const next = tasks.flatMap((task) => {
    const change = byId.get(task.id)
    if (!change) return [task]
    if (JSON.stringify(validateTaskList([task])[0]) !== JSON.stringify(validateTaskList([change.after])[0])) { skipped++; return [task] }
    reverted++
    return change.before ? [change.before] : []
  })
  return { tasks: next, skipped, reverted }
}
