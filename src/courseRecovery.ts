import { validateTaskList } from './backup.ts'
import type { CourseChange } from './courseImport.ts'

const KEY = 'workgrid.course-import-recovery.v1'

export function saveCourseRecovery(changes: CourseChange[]) {
  localStorage.setItem(KEY, JSON.stringify(changes))
}
export function loadCourseRecovery(): CourseChange[] | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const changes = JSON.parse(raw) as CourseChange[]
    if (!Array.isArray(changes) || changes.length === 0) return null
    const after = validateTaskList(changes.map((change) => change.after))
    return changes.map((change, index) => {
      const before = change.before === null ? null : validateTaskList([change.before])[0]
      if (!after[index].calendarImport || (before && before.id !== after[index].id)) throw new Error('恢复记录无效')
      return { before, after: after[index] }
    })
  } catch { return null }
}
export function clearCourseRecovery() { localStorage.removeItem(KEY) }
