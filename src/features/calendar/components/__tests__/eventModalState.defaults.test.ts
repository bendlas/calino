import { describe, it, expect } from 'vitest'
import { getInitialFormState } from '../eventModalState'

/**
 * The "Default Start Time" and "All-day by Default" settings seed a brand-new
 * event's form. Both may be baked into `calino.config.json` by a self-hosted
 * deployment and overridden per browser in Settings.
 *
 * Argument order: isModalOpen, selectedEventId, selectedDate, selectedEndDate,
 * events, calendars, allCategories, defaultDuration, defaultReminderMinutes,
 * defaultStartTime, defaultAllDay.
 *
 * A far-future date is used so the "clicked today" smart-rounding cannot
 * interfere with the assertions.
 */
const calendars = [{ id: 'cal1', isDefault: true }]
const future = '2099-06-15'

describe('default start time and all-day settings', () => {
  it('uses the configured start time for a new timed event', () => {
    const state = getInitialFormState(
      true,
      null,
      future,
      null,
      [],
      calendars,
      [],
      60,
      15,
      '18:00',
      false
    )
    expect(state.isAllDay).toBe(false)
    expect(state.startTime).toBe('18:00')
    expect(state.endTime).toBe('19:00')
  })

  it('keeps 09:00 when no start time is configured', () => {
    const state = getInitialFormState(true, null, future, null, [], calendars, [])
    expect(state.startTime).toBe('09:00')
    expect(state.endTime).toBe('10:00')
  })

  it('seeds an all-day event for a day click when all-day is the default', () => {
    const state = getInitialFormState(
      true,
      null,
      future,
      null,
      [],
      calendars,
      [],
      60,
      15,
      '18:00',
      true
    )
    expect(state.isAllDay).toBe(true)
    expect(state.startDate).toBe(future)
    expect(state.endDate).toBe(future)
  })

  it('still honors an explicitly clicked time slot when all-day is the default', () => {
    const state = getInitialFormState(
      true,
      null,
      `${future}T14:30`,
      null,
      [],
      calendars,
      [],
      60,
      15,
      '18:00',
      true
    )
    expect(state.isAllDay).toBe(false)
    expect(state.startTime).toBe('14:30')
    expect(state.endTime).toBe('15:30')
  })

  it('applies the defaults to the closed-modal seed too', () => {
    const state = getInitialFormState(
      false,
      null,
      null,
      null,
      [],
      calendars,
      [],
      60,
      15,
      '18:00',
      true
    )
    expect(state.startTime).toBe('18:00')
    expect(state.endTime).toBe('19:00')
    expect(state.isAllDay).toBe(true)
  })
})
