import { Focus, Minus, Plus, RotateCcw } from 'lucide-react'
import { MAX_ZOOM, MIN_ZOOM, type CalendarZoom as Zoom } from '../calendarZoom'

export default function CalendarZoom({ zoom, rangeLabel, empty, disabled, onStep, onChange }: {
  zoom: Zoom; rangeLabel: string; empty: boolean; disabled: boolean; onStep: (direction: -1 | 1) => void; onChange: (zoom: Zoom) => void
}) {
  return <div className="calendar-zoom" role="group" aria-label="日历时间轴缩放">
    <span className="zoom-label">时间轴</span>
    <button type="button" className="zoom-icon" aria-label="缩小日历" title="缩小日历" disabled={disabled || zoom === MIN_ZOOM} onClick={() => onStep(-1)}><Minus size={15} /></button>
    <output aria-label="日历缩放比例" aria-live="polite">{zoom === 'fit' ? '全天' : zoom === 'focus' ? '聚焦' : `${zoom}%`}</output>
    <button type="button" className="zoom-icon" aria-label="放大日历" title="放大日历" disabled={disabled || zoom === MAX_ZOOM} onClick={() => onStep(1)}><Plus size={15} /></button>
    <button type="button" className={zoom === 'fit' ? 'is-active' : ''} aria-pressed={zoom === 'fit'} disabled={disabled} onClick={() => onChange('fit')}>全天总览</button>
    <button type="button" className={`zoom-focus${zoom === 'focus' ? ' is-active' : ''}`} aria-pressed={zoom === 'focus'} disabled={disabled} onClick={() => onChange('focus')}><Focus size={14} />聚焦日程</button>
    {zoom === 'focus' && <small className="zoom-range" role="status">{empty ? '暂无日程 · 显示全天' : rangeLabel}</small>}
    <button type="button" className="zoom-reset" aria-label="恢复默认缩放" title="恢复默认缩放" disabled={disabled || zoom === 100} onClick={() => onChange(100)}><RotateCcw size={13} /><span>默认</span></button>
  </div>
}
