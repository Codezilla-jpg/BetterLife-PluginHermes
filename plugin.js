import { SIDEBAR_NAV_AREA, STATUSBAR_AREAS, host, useQuery, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx } from 'react/jsx-runtime'

const ID = 'statusline-workspaces'
const NAME = 'BetterLife'
const VERSION = '0.4.0'
const PROVIDER_POLL_MS = 5 * 60_000
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

const localTime = date =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)

const localDateTime = value => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}

function providerStatusItem(payload, providerId, providerLabel) {
  const provider = Array.isArray(payload?.providers)
    ? payload.providers.find(item => item?.id === providerId)
    : null
  const windows = Array.isArray(provider?.windows) ? provider.windows : []
  const percentages = windows.map(item => clampPercent(item?.used_percent)).filter(value => value !== null)
  const used = percentages.length ? Math.max(...percentages) : null
  const details = []

  if (provider?.plan) details.push(`Plan: ${provider.plan}`)
  for (const window of windows) {
    const reset = localDateTime(window?.reset_at)
    const suffix = reset ? ` · resets ${reset}` : ''
    details.push(`${window?.label || 'Quota'}: ${percent(window?.used_percent)} used${suffix}`)
    if (window?.detail) details.push(String(window.detail))
  }
  for (const detail of Array.isArray(provider?.details) ? provider.details : []) {
    if (detail) details.push(String(detail))
  }
  if (!details.length) details.push(provider?.reason || `${providerLabel} quota unavailable`)

  return {
    label: `${providerLabel} ${percent(used)}`,
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

function ProviderChip({ providerId, providerLabel, rest }) {
  const query = useQuery({
    queryKey: [ID, 'provider-usage'],
    queryFn: () => rest('/usage', { timeoutMs: 35_000 }),
    refetchInterval: PROVIDER_POLL_MS,
    retry: false,
    staleTime: 60_000
  })
  return jsx(StatusChip, { ...providerStatusItem(query.data, providerId, providerLabel) })
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
        id: 'betterlife-cronjobs-nav',
        area: SIDEBAR_NAV_AREA,
        order: 60,
        data: {
          codicon: 'watch',
          label: 'Cronjobs',
          path: '/cron'
        }
      },
      {
        id: 'betterlife-codex-usage',
        area: STATUSBAR_AREAS.right,
        order: 90,
        data: {
          id: 'betterlife-codex-usage',
          render: () => jsx(ProviderChip, { providerId: 'codex', providerLabel: 'Codex', rest: ctx.rest }),
          toggleLabel: 'Codex usage'
        }
      },
      {
        id: 'betterlife-grok-usage',
        area: STATUSBAR_AREAS.right,
        order: 100,
        data: {
          id: 'betterlife-grok-usage',
          render: () => jsx(ProviderChip, { providerId: 'grok', providerLabel: 'Grok', rest: ctx.rest }),
          toggleLabel: 'Grok usage'
        }
      },
      {
        id: 'betterlife-context-usage',
        area: STATUSBAR_AREAS.right,
        order: 110,
        data: {
          id: 'betterlife-context-usage',
          render: () => jsx(ContextChip, {}),
          toggleLabel: 'Context usage'
        }
      },
      {
        id: 'betterlife-local-clock',
        area: STATUSBAR_AREAS.right,
        order: 120,
        data: {
          id: 'betterlife-local-clock',
          render: () => jsx(ClockChip, {}),
          toggleLabel: 'Local clock'
        }
      }
    ])
  }
}

export { VERSION, clampPercent, contextStatusItem, clockStatusItem, providerStatusItem }
export default plugin
