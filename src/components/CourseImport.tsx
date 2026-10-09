import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CalendarDays, FileUp, RotateCcw, X } from 'lucide-react'
import { classifyCourse, courseOverlapCount, MAX_ICS_BYTES, parseCourseCalendar, type CourseCalendar, type CourseOccurrence } from '../courseImport'
import type { Task, TaskColor } from '../types'

interface Props {
  tasks: Task[]
  canUndo: boolean
  onApply: (courses: CourseOccurrence[], updateKeys: Set<string>, reviewedTasks: string) => boolean
  onUndo: () => void
  onClose: () => void
}
const COLOR_OPTIONS: Array<[TaskColor, string]> = [['red', '红'], ['orange', '橙'], ['yellow', '黄'], ['green', '绿'], ['blue', '蓝'], ['indigo', '靛'], ['purple', '紫']]
const ACTION_LABELS = { new: '新增', unchanged: '已导入 · 保留本机', update: '课表有变化', 'local-edit': '已手动修改 · 默认保留', deleted: '已删除 · 跳过' }
function time(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
}

export default function CourseImport({ tasks, canUndo, onApply, onUndo, onClose }: Props) {
  const [calendar, setCalendar] = useState<CourseCalendar | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [range, setRange] = useState('future')
  const [selectedCourses, setSelectedCourses] = useState(new Set<string>())
  const [colors, setColors] = useState<Record<string, TaskColor>>({})
  const [updates, setUpdates] = useState(new Set<string>())
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
  // Any external/local changes invalidate previously checked update approvals.
  useEffect(() => { setUpdates(new Set()) }, [tasks])
  useEffect(() => {
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [onClose])

  const courses = useMemo(() => [...new Set(calendar?.events.map((event) => event.course))], [calendar])
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const visible = (calendar?.events ?? []).filter((event) => (range === 'all' || Date.parse(event.start) >= today.getTime()) && selectedCourses.has(event.course))
  const additions = visible.filter((event) => classifyCourse(tasks, event) === 'new')
  const approved = visible.filter((event) => updates.has(event.key) && ['update', 'local-edit'].includes(classifyCourse(tasks, event)))
  const overlaps = additions.concat(approved).filter((event) => courseOverlapCount(tasks, event) > 0).length

  async function readFile(file: File | undefined) {
    const ticket = ++request.current
    setCalendar(null); setError(''); setUpdates(new Set()); setReading(false)
    if (!file) return
    setFileName(file.name)
    if (!file.name.toLowerCase().endsWith('.ics')) { setError('请选择教务系统下载的 .ics 文件'); return }
    if (file.size > MAX_ICS_BYTES) { setError('课表超过 2MB，请导出较小的课表文件'); return }
    setReading(true)
    try {
      const result = await parseCourseCalendar(await file.text())
      if (ticket !== request.current) return
      setCalendar(result)
      setSelectedCourses(new Set(result.events.map((event) => event.course)))
      setColors(Object.fromEntries(result.events.map((event) => [event.course, event.color])))
    } catch (caught) {
      if (ticket === request.current) setError(caught instanceof Error ? caught.message : '读取失败，请重新选择课表')
    } finally { if (ticket === request.current) setReading(false) }
  }
  function apply() {
    const mapped = visible.map((event) => ({ ...event, color: colors[event.course] ?? event.color }))
    if (onApply(mapped, updates, JSON.stringify(tasks))) onClose()
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="data-dialog course-import-dialog" role="dialog" aria-modal="true" aria-labelledby="course-import-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="dialog-heading"><div className="dialog-title"><span className="dialog-icon"><CalendarDays size={18} /></span><div><h2 id="course-import-title">导入课表</h2><p>选择教务系统下载的 ICS 文件</p></div></div><button className="icon-button" aria-label="关闭课表导入" onClick={onClose}><X size={18} /></button></div>
      <p className="privacy-note">文件在本机解析。原有日程保持不变，课表更新需确认。已登录时，导入的课程会随日程同步到你的账户。</p>
      <div className="file-picker course-file-picker"><FileUp size={22} /><div><strong>{fileName || '选择课表文件'}</strong><span>教务系统 → 订阅到日历 → 浏览器打开链接下载文件</span></div><label className="secondary-button" htmlFor="course-file">选择文件</label><input id="course-file" className="sr-only" type="file" accept=".ics,text/calendar" disabled={reading} onChange={(event) => { readFile(event.target.files?.[0]); event.target.value = '' }} /></div>
      {reading && <p role="status">正在解析课表…</p>}
      {error && <div className="error-message" role="alert"><AlertTriangle size={17} />{error}</div>}
      {calendar && <>
        <div className="course-import-controls"><strong>{calendar.name} · {courses.length} 门 · {calendar.events.length} 节</strong><label>导入范围<select aria-label="课表导入范围" value={range} onChange={(event) => { setRange(event.target.value); setUpdates(new Set()) }}><option value="future">今天及以后</option><option value="all">文件中的全部日期</option></select></label></div>
        {calendar.warnings.map((warning) => <p className="privacy-note" key={warning}>{warning}</p>)}
        {calendar.recurringThrough && <p className="privacy-note">重复课程展开至 {time(calendar.recurringThrough)}，按文件中的规则生成。</p>}
        <div className="course-selector" aria-label="选择课程">{courses.map((course) => <div key={course}><label><input type="checkbox" checked={selectedCourses.has(course)} onChange={(event) => setSelectedCourses((previous) => { const next = new Set(previous); event.target.checked ? next.add(course) : next.delete(course); return next })} />{course}</label><select aria-label={`${course}颜色`} value={colors[course]} onChange={(event) => setColors((previous) => ({ ...previous, [course]: event.target.value as TaskColor }))}>{COLOR_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>)}</div>
        <div className="course-preview" aria-label="课表预览">{visible.length === 0 ? <p>当前范围没有选中的课程，可以选择全部日期或勾选课程。</p> : visible.map((event) => {
          const action = classifyCourse(tasks, event)
          const overlap = courseOverlapCount(tasks, event)
          const old = tasks.find((task) => task.calendarImport?.calendarKey === event.calendarKey && task.calendarImport.eventKey === event.key)
          return <article className="course-preview-row" key={event.key}>
            <div><strong>{event.course}</strong><small>{time(event.start)} — {new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.parse(event.start) + event.duration * 60000))} · {event.duration} 分钟</small><small>{[event.location, event.teacher].filter(Boolean).join(' · ')}</small><small>{event.teachingClass}</small></div>
            <div className="course-row-action"><span>{ACTION_LABELS[action]}</span>{overlap > 0 && <small>与 {overlap} 项日程重叠，仅提示</small>}{(action === 'update' || action === 'local-edit') && <><small>本机：{old?.title} · {old?.start ? time(old.start) : '待安排'} · {old?.duration} 分钟</small><label><input type="checkbox" checked={updates.has(event.key)} onChange={(change) => setUpdates((previous) => { const next = new Set(previous); change.target.checked ? next.add(event.key) : next.delete(event.key); return next })} />{action === 'local-edit' ? '确认替换本节课的手动修改' : '确认更新本节课'}</label></>}</div>
          </article>
        })}</div>
        <p className="privacy-note">将新增 {additions.length} 节，更新 {approved.length} 节，其余跳过。{overlaps > 0 ? `${overlaps} 节与已有日程重叠，双方时间均保留。` : ''}本文件未列出的旧课程不会被删除。</p>
      </>}
      <div className="dialog-actions course-import-actions">{canUndo && <button className="text-button" type="button" onClick={() => { onUndo(); onClose() }}><RotateCcw size={14} />撤销上次课表导入</button>}<button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="button" disabled={reading || !calendar || additions.length + approved.length === 0} onClick={apply}>确认导入课表</button></div>
    </section>
  </div>
}
