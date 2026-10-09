export function parseDurationInput(value: string) {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null
  const duration = Number(normalized)
  return Number.isInteger(duration) && duration >= 1 && duration <= 720 ? duration : null
}

export function dropDateFromPosition(day: Date, pointerY: number, trackTop: number, slotHeight: number, slotMinutes = 15, startMinutes = 0, endMinutes = 1440) {
  const slotCount = (endMinutes - startMinutes) / slotMinutes
  const relativeY = Math.max(0, Math.min(slotCount * slotHeight - 0.000001, pointerY - trackTop))
  const slotIndex = Math.floor(relativeY / slotHeight)
  const result = new Date(day)
  result.setHours(0, startMinutes + slotIndex * slotMinutes, 0, 0)
  return result
}
