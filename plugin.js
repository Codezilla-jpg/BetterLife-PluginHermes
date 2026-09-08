import { STATUSBAR_AREAS, cn, haptic, host, icons, useQuery, useQueryClient } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx } from 'react/jsx-runtime'

const ID = 'statusline-workspaces'
const NAME = 'BetterLife'
const VERSION = '0.6.1'
const CLOCK_POLL_MS = 60_000
const LIMITS_POLL_MS = 5 * 60_000
const LIMITS_QUERY_KEY = [ID, 'limits']
const CHIP_CLASS =
  'inline-flex h-full items-center px-1.5 text-[0.6875rem] text-(--ui-text-tertiary)'
const RESTART_CLASS =
  'inline-flex h-full items-center justify-center overflow-hidden whitespace-nowrap disabled:opacity-50'
const RESTART_TARGETS = [
  { target: 'gateway', label: 'Gateway', order: 130 },
  { target: 'hermes', label: 'Hermes', order: 140 },
  { target: 'client', label: 'Client', order: 150 }
]
const { RefreshCw } = icons

const clampPercent = value => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null
}

const percentLeft = usedPercent => {
  const used = clampPercent(usedPercent)
  return used === null ? null : Math.round((100 - used) * 10) / 10
}

const localTime = date =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)

const localDateTime = value => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}

const countdown = value => {
  const target = new Date(value).getTime()
  if (!value || Number.isNaN(target)) return null
  const minutesTotal = Math.max(0, Math.floor((target - Date.now()) / 60_000))
  const days = Math.floor(minutesTotal / 1_440)
  const hours = Math.floor((minutesTotal % 1_440) / 60)
  const minutes = minutesTotal % 60
  if (days) return `${days}d ${hours}h`
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

const providerSummary = provider => {
  const preferredUsed = clampPercent(provider?.display_used_percent)
  if (preferredUsed !== null) {
    return { used: preferredUsed, resetAt: provider?.display_reset_at }
  }
  const candidates = (Array.isArray(provider?.windows) ? provider.windows : [])
    .map(window => ({ window, used: clampPercent(window?.used_percent) }))
    .filter(candidate => candidate.used !== null)
  const selected = candidates.reduce(
    (worst, candidate) => (!worst || candidate.used > worst.used ? candidate : worst),
    null
  )
  return { used: selected?.used ?? null, resetAt: selected?.window?.reset_at }
}

const fetchUsage = (rest, force = false) =>
  force
    ? rest('/refresh', { method: 'POST', timeoutMs: 45_000 })
    : rest('/usage', { timeoutMs: 45_000 })

const IRIDESCENT = [
  [0, 'color-mix(in srgb, var(--ui-accent) 55%, var(--ui-text-secondary))'],
  [38, 'var(--ui-accent)'],
  [72, 'color-mix(in srgb, var(--ui-accent) 70%, var(--ui-text-primary))'],
  [100, 'color-mix(in srgb, var(--ui-accent) 45%, var(--ui-text-tertiary))']
]
const RING_WIDTH = 8
const RING_MASK = `radial-gradient(farthest-side, transparent calc(100% - ${RING_WIDTH}px), var(--ui-text-primary) calc(100% - ${RING_WIDTH}px))`

const iridescentGradient = left => {
  const clamped = Math.max(0, Math.min(100, left ?? 0))
  const stops = IRIDESCENT.map(
    ([position, color]) => `${color} ${((position * clamped) / 100).toFixed(2)}%`
  )
  return `conic-gradient(from -90deg, ${stops.join(', ')}, var(--ui-stroke-quaternary) ${clamped.toFixed(2)}%)`
}

function UsageRing({ left, offline }) {
  const percentage = left === null ? null : Math.round(left)
  const unavailable = offline || percentage === null
  const label = unavailable ? 'Nicht verfügbar' : 'übrig'
  return jsx('div', {
    className: 'relative grid shrink-0 place-items-center',
    style: { width: '108px', height: '108px' },
    role: 'img',
    'aria-label': unavailable ? label : `${percentage}% ${label}`,
    children: [
      jsx('div', {
        key: 'ring',
        className: cn('absolute inset-0 rounded-full transition-opacity', unavailable && 'opacity-25'),
        style: {
          background: iridescentGradient(percentage),
          WebkitMask: RING_MASK,
          mask: RING_MASK
        }
      }),
      jsx('div', {
        key: 'value',
        className: 'flex flex-col items-center text-center',
        style: { maxWidth: '68px' },
        children: [
          jsx('span', {
            key: 'percentage',
            className: 'font-semibold tabular-nums text-(--ui-text-primary)',
            style: { fontSize: '1rem', lineHeight: 1 },
            children: unavailable ? 'N/V' : `${percentage}%`
          }),
          jsx('span', {
            key: 'label',
            className: cn(
              'text-(--ui-text-quaternary)',
              !unavailable && 'uppercase'
            ),
            style: {
              marginTop: '2px',
              fontSize: unavailable ? '0.4375rem' : '0.5rem',
              lineHeight: 1,
              letterSpacing: unavailable ? 'normal' : '0.12em'
            },
            children: label
          })
        ]
      })
    ]
  })
}

function ProviderTab({ provider, resetAt }) {
  const meta = [provider?.account, provider?.plan].filter(Boolean).join(' · ')
  const reset = countdown(resetAt)
  return jsx('div', {
    className: cn(
      'min-w-0 rounded-lg border border-(--ui-stroke-secondary)',
      'bg-(--ui-bg-card) px-3 py-2'
    ),
    style: { flex: '0 1 30rem' },
    children: [
      jsx('div', {
        key: 'name',
        className: 'truncate text-xs font-semibold text-(--ui-text-primary)',
        children: provider?.label || provider?.id
      }),
      meta
        ? jsx('div', {
            key: 'meta',
            className: 'mt-0.5 truncate text-[0.6875rem] text-(--ui-text-tertiary)',
            children: meta
          })
        : null,
      reset
        ? jsx('div', {
            key: 'reset',
            className: 'mt-0.5 truncate text-[0.6875rem] text-(--ui-text-quaternary)',
            children: `Reset in ${reset}`
          })
        : null,
      !provider?.available && provider?.reason
        ? jsx('div', {
            key: 'reason',
            className: 'mt-0.5 truncate text-[0.6875rem] text-(--ui-text-quaternary)',
            title: String(provider.reason),
            children: 'Nicht verfügbar'
          })
        : null
    ].filter(Boolean)
  })
}

function ProviderRow({ provider }) {
  const available = Boolean(provider?.available)
  const summary = providerSummary(provider)
  return jsx('div', {
    className: 'flex items-center gap-4',
    children: [
      jsx(UsageRing, {
        key: 'ring',
        left: available ? percentLeft(summary.used) : null,
        offline: !available
      }),
      jsx(ProviderTab, { key: 'tab', provider, resetAt: summary.resetAt })
    ]
  })
}

function LimitsPage({ rest }) {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const query = useQuery({
    queryKey: LIMITS_QUERY_KEY,
    queryFn: () => fetchUsage(rest),
    refetchInterval: LIMITS_POLL_MS,
    retry: false,
    staleTime: 60_000
  })
  const providers = Array.isArray(query.data?.providers) ? query.data.providers : []
  const fetchedAt = localDateTime(query.data?.fetched_at)
  const refresh = async () => {
    if (refreshing) return
    haptic('tap')
    setRefreshing(true)
    try {
      const data = await fetchUsage(rest, true)
      queryClient.setQueryData(LIMITS_QUERY_KEY, data)
    } catch (error) {
      host.notifyError(error, 'Limits-Aktualisierung fehlgeschlagen')
    } finally {
      setRefreshing(false)
    }
  }
  const busy = query.isFetching || refreshing
  let content
  if (query.isLoading) {
    content = jsx('div', {
      className: 'py-6 text-center text-sm text-(--ui-text-tertiary)',
      children: 'Lade…'
    })
  } else if (query.isError) {
    content = jsx('div', {
      className: 'py-6 text-center text-sm text-(--ui-text-tertiary)',
      children: 'Nicht erreichbar.'
    })
  } else {
    content = jsx('div', {
      className: 'space-y-5',
      children: providers.map(provider => jsx(ProviderRow, { provider, key: provider.id }))
    })
  }

  return jsx('div', {
    className: 'flex h-full min-h-0 w-full flex-col overflow-y-auto px-3 pb-5 pt-3',
    children: [
      jsx('div', {
        key: 'header',
        className: 'mb-4 flex items-end justify-between',
        children: [
          jsx('h1', {
            key: 'title',
            className: 'text-sm font-semibold text-(--ui-text-primary)',
            children: 'Limits'
          }),
          jsx('button', {
            key: 'refresh',
            type: 'button',
            onClick: refresh,
            disabled: busy,
            className: cn(
              'inline-flex size-8 items-center justify-center rounded-md border border-(--ui-stroke-secondary)',
              'text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover)',
              'hover:text-(--ui-text-primary) disabled:opacity-50'
            ),
            title: fetchedAt ? `Aktualisiert ${fetchedAt}` : 'Aktualisieren',
            'aria-label': 'Limits aktualisieren',
            children: jsx(RefreshCw, { className: cn('size-3.5', busy && 'animate-spin') })
          })
        ]
      }),
      content
    ]
  })
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

function ClockChip() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return jsx(StatusChip, { ...clockStatusItem(now) })
}

function RestartButton({ target, rest }) {
  const [restarting, setRestarting] = useState(false)
  const [hovered, setHovered] = useState(false)
  const client = target === 'client'
  const hermes = target === 'hermes'
  const targetLabel = RESTART_TARGETS.find(item => item.target === target)?.label || target
  const restart = async () => {
    if (restarting) return
    haptic('tap')
    setRestarting(true)
    try {
      if (client) {
        window.location.reload()
      } else if (hermes) {
        await rest('/restart/hermes', { method: 'POST', timeoutMs: 5_000 })
        await new Promise(resolve => setTimeout(resolve, 1_200))
        window.location.reload()
      } else {
        await rest('/restart/gateway', { method: 'POST', timeoutMs: 45_000 })
      }
    } catch (error) {
      host.notifyError(error, `${targetLabel}-Neustart fehlgeschlagen`)
    } finally {
      setRestarting(false)
    }
  }

  return jsx('button', {
    type: 'button',
    className: RESTART_CLASS,
    style: {
      color: hovered ? 'var(--ui-text-primary)' : 'var(--ui-text-tertiary)',
      paddingInline: hovered ? '6px' : '0',
      transition: 'width 150ms ease, padding 150ms ease, color 150ms ease',
      width: hovered ? `${Math.max(64, targetLabel.length * 7 + 32)}px` : '28px'
    },
    disabled: restarting,
    'aria-label': restarting ? `${targetLabel} wird neu gestartet` : `${targetLabel} neu starten`,
    title: restarting ? `${targetLabel} wird neu gestartet…` : `${targetLabel} neu starten`,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onClick: restart,
    children: [
      jsx(RefreshCw, { className: `size-3 shrink-0${restarting ? ' animate-spin' : ''}`, key: 'icon' }),
      jsx('span', {
        key: 'label',
        style: {
          marginLeft: hovered ? '4px' : '0',
          maxWidth: hovered ? '64px' : '0',
          opacity: hovered ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-width 150ms ease, margin 150ms ease, opacity 150ms ease'
        },
        children: targetLabel
      })
    ]
  })
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
        id: 'betterlife-limits-pane',
        area: 'panes',
        order: 55,
        title: 'Limits',
        data: {
          placement: 'left',
          dock: { pane: 'sessions', pos: 'center' }
        },
        render: () => jsx(LimitsPage, { rest: ctx.rest })
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
      },
      ...RESTART_TARGETS.map(({ target, label, order }) => ({
        id: `betterlife-restart-${target}`,
        area: STATUSBAR_AREAS.right,
        order,
        data: {
          id: `betterlife-restart-${target}`,
          render: () => jsx(RestartButton, { target, rest: ctx.rest }),
          toggleLabel: `${label} restart`
        }
      }))
    ])
  }
}

export { VERSION, clockStatusItem }
export default plugin
