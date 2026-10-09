export type CalendarZoom = number | 'fit'

export const DEFAULT_SLOT_HEIGHT = 22
export const ZOOM_STORAGE_KEY = 'workgrid.calendarZoom.v1'
export const MIN_ZOOM = 25
export const MAX_ZOOM = 150

export function parseCalendarZoom(value: string | null): CalendarZoom {
  if (value === 'fit') return 'fit'
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
  const percentage = zoom === 'fit' ? slotHeight / DEFAULT_SLOT_HEIGHT * 100 : zoom
  const next = direction === 1 ? (Math.floor(percentage / 25) + 1) * 25 : (Math.ceil(percentage / 25) - 1) * 25
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))
}
