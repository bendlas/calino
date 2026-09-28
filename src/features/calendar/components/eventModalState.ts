import { format, parseISO } from 'date-fns'
import { pad2, addMinutesToTimeStr, toEventInstant } from '@/lib/datetime'
export { addMinutesToTimeStr }
import { extractOriginalEventId } from '@/lib/events'
import { isUUID } from '@/lib/uuid'
import { makeDefaultReminders } from '@/lib/notifications'
import type {
  CalendarEvent,
  CalendarAttachment,
  CalendarAttendee,
  CalendarOrganizer,
  RecurrenceRule,
  Reminder,
} from '@/types'

export interface InitialFormState {
  title: string
  description: string
  location: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  isAllDay: boolean
  calendarId: string
  recurring: boolean
  recurrence: RecurrenceRule['frequency']
  interval: number
  byWeekday: number[]
  byMonthDay: number[]
  byMonth: number[]
  // R2.4 — Per-BYDAY ordinals (parallel to byWeekday). e.g. for "second
  // Tuesday", byWeekday=[2] and byDayOrdinals=[2]. Distinct from
  // rule.bySetPos, which is reserved for the standalone BYSETPOS rule part.
  byDayOrdinals: number[]
  endCondition: 'never' | 'on' | 'after'
  endOnDate: string
  endAfterCount: number
  travelDuration: number | undefined
  reminders: Reminder[]
  transparency: 'opaque' | 'transparent'
  categories: string[]
  attachments: CalendarAttachment[]
  relatedTo: string[]
  attendees: CalendarAttendee[]
  organizer: CalendarOrganizer | undefined
}

export type InitialFormStateWithMeta = InitialFormState & {
  isRecurringInstance: boolean
  originalEventId: string | null
}

export function makeDefaultState(
  overrides: Partial<InitialFormStateWithMeta> = {}
): InitialFormStateWithMeta {
  const today = format(new Date(), 'yyyy-MM-dd')
  return {
    title: '',
    description: '',
    location: '',
    startDate: today,
    startTime: '09:00',
    endDate: today,
    endTime: '10:00',
    isAllDay: false,
    calendarId: '',
    recurring: false,
    recurrence: 'weekly',
    interval: 1,
    byWeekday: [],
    byMonthDay: [],
    byMonth: [],
    byDayOrdinals: [],
    endCondition: 'never',
    endOnDate: today,
    endAfterCount: 10,
    travelDuration: undefined,
    reminders: [],
    transparency: 'opaque',
    categories: [],
    attachments: [],
    relatedTo: [],
    attendees: [],
    organizer: undefined,
    isRecurringInstance: false,
    originalEventId: null,
    ...overrides,
  }
}

/**
 * The calendar a brand-new event lands on.
 *
 * Read-only calendars are skipped even when one is flagged default or happens
 * to sit first. The modal's Create button validates the chosen calendar
 * against a writable-only list, so defaulting to a read-only calendar leaves
 * Create permanently disabled while the picker cheerfully displays the
 * calendar it just chose — a dead form with nothing on screen explaining why.
 *
 * If every calendar is read-only there is no good answer; fall back to the
 * old pick so `calendarId` still resolves and the read-only notice renders,
 * rather than returning nothing and blaming an empty selection.
 */
function pickDefaultCalendar<T extends { id: string; isDefault: boolean; readOnly?: boolean }>(
  calendars: T[]
): T | undefined {
  const writable = calendars.filter((calendar) => !calendar.readOnly)
  return (
    writable.find((calendar) => calendar.isDefault) ??
    writable[0] ??
    calendars.find((calendar) => calendar.isDefault) ??
    calendars[0]
  )
}

/**
 * Has the wall-clock `HH:mm` already passed today? Used to decide whether the
 * preferred default start time is still usable for a click on today, or should
 * be rounded forward to avoid creating an event in the past.
 */
function isTimeInPast(hhmm: string): boolean {
  const [hours, minutes] = hhmm.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return false
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes() > hours * 60 + minutes
}

export function getInitialFormState(
  isModalOpen: boolean,
  selectedEventId: string | null,
  selectedDate: string | null,
  selectedEndDate: string | null,
  events: CalendarEvent[],
  calendars: { id: string; isDefault: boolean; readOnly?: boolean }[],
  allCategories: { id: string; name: string }[],
  defaultDuration: number = 60,
  defaultReminderMinutes: number | null = null,
  defaultStartTime: string = '09:00',
  defaultAllDay: boolean = false
): InitialFormStateWithMeta {
  const defaultEndTime = addMinutesToTimeStr(defaultStartTime, defaultDuration)
  const defaultReminders = makeDefaultReminders(defaultReminderMinutes)

  // Early return when modal is closed — skip all computation
  if (!isModalOpen) {
    const defaultCalendar = pickDefaultCalendar(calendars)
    return makeDefaultState({
      calendarId: defaultCalendar?.id || '',
      startTime: defaultStartTime,
      endTime: defaultEndTime,
      isAllDay: defaultAllDay,
      reminders: defaultReminders,
    })
  }

  const defaultCalendar = pickDefaultCalendar(calendars)

  const isEditing = selectedEventId !== null

  let existingEvent: CalendarEvent | undefined
  let isRecurringInstance = false
  let originalEventId: string | null = null

  if (isEditing && selectedEventId) {
    existingEvent = events.find((e) => e.id === selectedEventId)

    if (existingEvent?.recurrenceId) {
      isRecurringInstance = true
      originalEventId =
        existingEvent.recurrenceMasterId ||
        existingEvent.uid ||
        extractOriginalEventId(selectedEventId)
    }

    if (!existingEvent) {
      const originalId = extractOriginalEventId(selectedEventId)
      if (originalId) {
        existingEvent = events.find((e) => e.id === originalId)
        if (existingEvent) {
          isRecurringInstance = true
          originalEventId = originalId
        }
      }
    }
  }

  if (isModalOpen) {
    if (existingEvent) {
      // Convert category IDs to names
      const categoryNames: string[] = []
      if (existingEvent.categories) {
        for (const catIdOrName of existingEvent.categories) {
          if (isUUID(catIdOrName)) {
            const cat = allCategories.find((c) => c.id === catIdOrName)
            if (cat) categoryNames.push(cat.name)
          } else {
            categoryNames.push(catIdOrName)
          }
        }
      }
      const rule = existingEvent.recurrence
      // R2.4 — Read per-BYDAY ordinals from byDayOrdinals. Fall back to
      // legacy bySetPos when byDayOrdinals is missing (events persisted
      // before the R2.4 deconflation stored per-BYDAY ordinals in
      // bySetPos when byWeekday was present).
      const ordinals: number[] | undefined =
        rule?.byDayOrdinals && rule.byDayOrdinals.length > 0
          ? rule.byDayOrdinals.filter((p) => p !== 0)
          : rule?.bySetPos && rule.byWeekday && rule.byWeekday.length > 0
            ? rule.bySetPos.filter((p) => p !== 0)
            : undefined
      const endOnDate = rule?.endDate
        ? format(parseISO(rule.endDate), 'yyyy-MM-dd')
        : format(toEventInstant(existingEvent.start, existingEvent.timezone), 'yyyy-MM-dd')
      const endCondition: 'never' | 'on' | 'after' = rule?.endDate
        ? 'on'
        : rule?.count
          ? 'after'
          : 'never'
      return {
        title: existingEvent.title,
        description: existingEvent.description || '',
        location: existingEvent.location || '',
        // TZID events store naive wall clocks in the event zone — the modal
        // must show them as the device would see the instant (Phase 2 C2).
        startDate: format(
          toEventInstant(existingEvent.start, existingEvent.timezone),
          'yyyy-MM-dd'
        ),
        startTime: format(toEventInstant(existingEvent.start, existingEvent.timezone), 'HH:mm'),
        endDate: format(toEventInstant(existingEvent.end, existingEvent.timezone), 'yyyy-MM-dd'),
        endTime: format(toEventInstant(existingEvent.end, existingEvent.timezone), 'HH:mm'),
        isAllDay: existingEvent.isAllDay,
        calendarId: existingEvent.calendarId,
        recurring: !!rule,
        recurrence: rule?.frequency || 'weekly',
        interval: rule?.interval ?? 1,
        byWeekday: rule?.byWeekday ?? [],
        byMonthDay: rule?.byMonthDay ?? [],
        byMonth: rule?.byMonth ?? [],
        byDayOrdinals: ordinals && ordinals.length > 0 ? ordinals : [],
        endCondition,
        endOnDate,
        endAfterCount: rule?.count ?? 10,
        travelDuration: existingEvent.travelDuration,
        reminders: existingEvent.reminders || [],
        transparency: existingEvent.transparency || 'opaque',
        categories: categoryNames,
        attachments: existingEvent.attachments || [],
        relatedTo: existingEvent.relatedTo || [],
        attendees: existingEvent.attendees || [],
        organizer: existingEvent.organizer,
        isRecurringInstance,
        originalEventId,
      }
    }

    if (selectedDate) {
      const hasTime = selectedDate.includes('T')
      const dateStr = hasTime ? selectedDate.split('T')[0] : selectedDate

      let startTimeVal = defaultStartTime
      let endTimeVal = defaultEndTime

      if (hasTime) {
        const time = selectedDate.split('T')[1]?.substring(0, 5) || defaultStartTime
        startTimeVal = time
        endTimeVal = addMinutesToTimeStr(time, defaultDuration)
      } else {
        // No specific time. The preferred start time is used as-is, except when
        // clicking *today* and that time has already passed — then round up to
        // the next hour so the new event isn't born in the past.
        const todayStr = format(new Date(), 'yyyy-MM-dd')
        if (dateStr === todayStr && isTimeInPast(defaultStartTime)) {
          const now = new Date()
          let hours = now.getHours()
          const mins = now.getMinutes()
          if (mins > 0) hours += 1 // round up to next hour
          hours += 1 // start one hour out
          hours = hours % 24
          startTimeVal = `${pad2(hours)}:00`
          endTimeVal = addMinutesToTimeStr(startTimeVal, defaultDuration)
        }
      }

      if (selectedEndDate && selectedEndDate.includes('T')) {
        const endTime = selectedEndDate.split('T')[1]
        const endDatePart = selectedEndDate.split('T')[0]
        endTimeVal = endTime
        if (endDatePart !== dateStr) {
          return makeDefaultState({
            calendarId: defaultCalendar?.id || '',
            startDate: dateStr,
            startTime: startTimeVal,
            endDate: endDatePart,
            endTime: endTimeVal,
            endOnDate: dateStr,
            reminders: defaultReminders,
          })
        }
      }

      // Month-view drag-to-create seeds an *all-day range*: a date-only (no
      // time) end date. A single-day click passes no endDate at all, so it
      // keeps the default timed event below. Here we mark the seeded event
      // all-day and span the inclusive end date — see the store's all-day
      // convention (end stored as `endDateT00:00:00`, rendered inclusive).
      if (selectedEndDate && !selectedEndDate.includes('T')) {
        return makeDefaultState({
          calendarId: defaultCalendar?.id || '',
          startDate: dateStr,
          startTime: '00:00',
          endDate: selectedEndDate,
          endTime: '23:59',
          isAllDay: true,
          endOnDate: dateStr,
          reminders: defaultReminders,
        })
      }

      // A day click with all-day seeding on becomes a single all-day event.
      // A click that carried an explicit time (`hasTime`) stays timed.
      if (defaultAllDay && !hasTime) {
        return makeDefaultState({
          calendarId: defaultCalendar?.id || '',
          startDate: dateStr,
          startTime: '00:00',
          endDate: dateStr,
          endTime: '23:59',
          isAllDay: true,
          endOnDate: dateStr,
          reminders: defaultReminders,
        })
      }

      return makeDefaultState({
        calendarId: defaultCalendar?.id || '',
        startDate: dateStr,
        startTime: startTimeVal,
        endDate: dateStr,
        endTime: endTimeVal,
        endOnDate: dateStr,
        reminders: defaultReminders,
      })
    }
  }

  return makeDefaultState({
    calendarId: defaultCalendar?.id || '',
    startTime: defaultStartTime,
    endTime: defaultEndTime,
    isAllDay: defaultAllDay,
    reminders: defaultReminders,
  })
}
