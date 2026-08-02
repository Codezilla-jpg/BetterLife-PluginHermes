import { host, STATUSBAR_AREAS, useQuery, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx } from 'react/jsx-runtime'

const ID = 'statusline-workspaces'
const NAME = 'Hermes Statusline'
const VERSION = '0.2.0'
const USAGE_POLL_MS = 5 * 60_000
const CONTEXT_POLL_MS = 60_000
const CLOCK_POLL_MS = 60_000
const CHIP_CLASS =
  'inline-flex h-full items-center px-1.5 text-[0.6875rem] text-(--ui-text-tertiary)'

const finite = value =>
  value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)

const clampPercent = value => {
  const number = finite(value)
  return number === null ? null : Math.max(0, Math.min(100, number))
}

const percent = value => {
  const number = clampPercent(value)
  return number === null ? '—' : `${Math.round(number)}%`
}

const count = value =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(finite(value) ?? 0)

const localTime = date => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)

function usageStatusItem(payload) {
  const available = payload?.available === true
  const remaining = payload?.total_spendable_display ?? payload?.subscription_remaining_display
  const plan = payload?.plan_name || 'Nous'
  const details = []

  if (available && payload?.plan_bar) {
    const bar = payload.plan_bar
    details.push(`${plan}: ${bar.remaining_display} / ${bar.total_display} · ${percent(bar.pct_used)} used`)
  }
  if (available && payload?.topup_bar) {
    details.push(`Top-up: ${payload.topup_bar.remaining_display} available`)
  }
  if (available && payload?.renews_display) {
    details.push(`Renews ${payload.renews_display}`)
  }
  if (!details.length) {
    details.push(available ? 'No paid usage balance' : 'Nous usage unavailable')
  }

  return {
    label: remaining ? `${plan} ${remaining}` : available ? `${plan} free` : 'Usage —',
    title: details.join('\n')
  }
}

function contextStatusItem(payload) {
  const used = finite(payload?.context_used) ?? finite(payload?.estimated_total) ?? 0
  const maximum = finite(payload?.context_max) ?? 0
  const usedPercent =
    clampPercent(payload?.context_percent) ?? (maximum > 0 ? clampPercent((used / maximum) * 100) : null)
  const categories = Array.isArray(payload?.categories) ? payload.categories : []
  const details = [maximum > 0 ? `${count(used)} / ${count(maximum)} tokens` : 'No active context data']

  for (const category of categories.slice(0, 8)) {
    details.push(`${category.label || category.name || 'Context'}: ${count(category.tokens ?? category.value)}`)
  }

  return {
    label: `Ctx ${percent(usedPercent)}`,
    title: payload?.model ? `Context usage · ${payload.model}\n${details.join('\n')}` : details.join('\n')
  }
}

function clockStatusItem(now = new Date()) {
  return {
    label: localTime(now),
    title: new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(now)
  }
}

function StatusChip({ label, title }) {
  return jsx('span', { className: CHIP_CLASS, title, children: label })
}

function UsageChip() {
  const query = useQuery({
    queryKey: [ID, 'usage'],
    queryFn: () => host.request('usage.bars'),
    refetchInterval: USAGE_POLL_MS,
    retry: false
  })
  return jsx(StatusChip, { ...usageStatusItem(query.data) })
}

function ContextChip() {
  const sessionId = useValue(host.state.activeSessionId)
  const query = useQuery({
    queryKey: [ID, 'context', sessionId],
    queryFn: () => host.request('session.context_breakdown', { session_id: sessionId }),
    enabled: Boolean(sessionId),
    refetchInterval: CONTEXT_POLL_MS,
    retry: false
  })
  return jsx(StatusChip, { ...contextStatusItem(sessionId ? query.data : null) })
}

function ClockChip() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return jsx(StatusChip, { ...clockStatusItem(now) })
}

const plugin = {
  id: ID,
  name: NAME,
  version: VERSION,
  defaultEnabled: true,
  register(ctx) {
    console.info(`[${ID}] loaded v${VERSION}`)
    ctx.registerMany([
      {
        id: 'account-usage',
        area: STATUSBAR_AREAS.right,
        order: 100,
        data: {
          id: 'account-usage',
          render: () => jsx(UsageChip, {}),
          toggleLabel: 'Account usage'
        }
      },
      {
        id: 'context-usage',
        area: STATUSBAR_AREAS.right,
        order: 110,
        data: {
          id: 'context-usage',
          render: () => jsx(ContextChip, {}),
          toggleLabel: 'Context usage'
        }
      },
      {
        id: 'local-clock',
        area: STATUSBAR_AREAS.right,
        order: 120,
        data: {
          id: 'local-clock',
          render: () => jsx(ClockChip, {}),
          toggleLabel: 'Local clock'
        }
      }
    ])
  }
}

export { VERSION, clampPercent, contextStatusItem, clockStatusItem, usageStatusItem }
export default plugin
