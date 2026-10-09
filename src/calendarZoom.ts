export type CalendarZoom = number | 'fit' | 'focus'
export interface TimeRange { start: number; end: number }

export const DEFAULT_SLOT_HEIGHT = 22
export const ZOOM_STORAGE_KEY = 'workgrid.calendarZoom.v1'
export const MIN_ZOOM = 25
export const MAX_ZOOM = 150

export function parseCalendarZoom(value: string | null): CalendarZoom {
  if (value === 'fit' || value === 'focus') return value
  const percentage = Number(value)
  return percentage >= MIN_ZOOM && percentage <= MAX_ZOOM && percentage % 25 === 0 ? percentage : 100
}

export function loadCalendarZoom(): CalendarZoom {
  try { return parseCalendarZoom(localStorage.getItem(ZOOM_STORAGE_KEY)) }
  catch { return 100 }
}

export function fitSlotHeight(surfaceHeight: number, headerHeight = 56, reservedHeight = 16) {
  return Math.max(1, (surfaceHeight - headerHeight - reservedHeight) / 96)
}

export function stepCalendarZoom(zoom: CalendarZoom, slotHeight: number, direction: -1 | 1) {
  const percentage = typeof zoom === 'number' ? zoom : slotHeight / DEFAULT_SLOT_HEIGHT * 100
  const next = direction === 1 ? (Math.floor(percentage / 25) + 1) * 25 : (Math.ceil(percentage / 25) - 1) * 25
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))
}

export function focusedTimeRange(tasks: Array<{ start: string | null; duration: number; deletedAt?: string | null }>): TimeRange {
  const intervals = tasks.filter((task) => task.start && !task.deletedAt).map((task) => {
    const date = new Date(task.start!)
    const start = date.getHours() * 60 + date.getMinutes()
    return { start, end: Math.min(1440, start + task.duration) }
  }).filter((item) => Number.isFinite(item.start) && item.end > item.start)
  if (!intervals.length) return { start: 0, end: 1440 }
  let start = Math.max(0, Math.floor((Math.min(...intervals.map((item) => item.start)) - 30) / 60) * 60)
  let end = Math.min(1440, Math.ceil((Math.max(...intervals.map((item) => item.end)) + 30) / 60) * 60)
  // A short task should not become an enormous block; retain at least four hours of context.
  if (end - start < 240) {
    start = Math.max(0, Math.floor((start + end - 240) / 120) * 60)
    end = Math.min(1440, start + 240)
    start = Math.max(0, end - 240)
  }
  return { start, end }
}

export function timeRangeLabel(range: TimeRange) {
  const label = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  return `${label(range.start)}–${label(range.end)}`
}
