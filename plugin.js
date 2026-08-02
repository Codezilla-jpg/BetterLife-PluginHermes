import { host, SESSION_ACTIONS_AREA, STATUSBAR_AREAS } from '@hermes/plugin-sdk'

const ID = 'statusline-workspaces'
const NAME = 'Hermes Statusline & Workspaces'
const VERSION = '0.1.0'
const POLL_MS = 60_000

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
const count = value => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const localTime = date => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
const localDateTime = value => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function providerEntries(payload) {
  const providers = payload?.providers
  if (!providers || typeof providers !== 'object') return []
  return Object.entries(providers)
}

function providerUsage(entry) {
  const accountWindows = Array.isArray(entry?.account?.windows) ? entry.account.windows : []
  const accountValues = accountWindows.map(window => clampPercent(window.used_percent)).filter(value => value !== null)
  if (accountValues.length) return Math.max(...accountValues)

  const buckets = entry?.rate_limits?.buckets
  if (!buckets || typeof buckets !== 'object') return null
  const bucketValues = Object.values(buckets)
    .filter(bucket => finite(bucket?.limit) > 0)
    .map(bucket => clampPercent(bucket?.used_percent))
    .filter(value => value !== null)
  return bucketValues.length ? Math.max(...bucketValues) : null
}

function providerMenuItems(payload) {
  const rows = []
  const names = { 'openai-codex': 'Codex', 'xai-oauth': 'Grok', xai: 'Grok' }

  for (const [provider, entry] of providerEntries(payload)) {
    const name = names[provider] ?? provider
    const windows = Array.isArray(entry?.account?.windows) ? entry.account.windows : []
    if (windows.length) {
      for (const [index, window] of windows.entries()) {
        const reset = window.reset_at ? ` · resets ${localDateTime(window.reset_at)}` : ''
        rows.push({
          id: `${provider}:account:${index}`,
          disabled: true,
          label: `${name} ${window.label}: ${percent(window.used_percent)}${reset}`
        })
      }
    }

    const buckets = entry?.rate_limits?.buckets
    if (buckets && typeof buckets === 'object') {
      for (const [bucketName, bucket] of Object.entries(buckets)) {
        const limit = finite(bucket?.limit)
        if (limit === null || limit <= 0) continue
        const reset = bucket.reset_at ? ` · resets ${localDateTime(bucket.reset_at)}` : ''
        rows.push({
          id: `${provider}:rate:${bucketName}`,
          disabled: true,
          label: `${name} ${bucketName.replaceAll('_', ' ')}: ${count(bucket.remaining)}/${count(limit)}${reset}`
        })
      }
    }

    if (!windows.length && !entry?.rate_limits?.available) {
      rows.push({
        id: `${provider}:unavailable`,
        disabled: true,
        label: `${name}: ${entry?.account?.unavailable_reason || 'no limit telemetry yet'}`
      })
    }
  }

  return rows.length
    ? rows
    : [{ id: 'unavailable', disabled: true, label: payload?.error || 'Provider limits unavailable' }]
}

function providerStatusItem(payload) {
  const names = { 'openai-codex': 'Codex', 'xai-oauth': 'Grok', xai: 'Grok' }
  const labels = providerEntries(payload).map(([provider, entry]) => `${names[provider] ?? provider} ${percent(providerUsage(entry))}`)

  return {
    id: 'provider-limits',
    label: labels.length ? labels.join(' · ') : 'Limits —',
    menuItems: providerMenuItems(payload),
    title: 'Provider account and API limits',
    toggleLabel: 'Provider limits',
    variant: 'menu'
  }
}

function contextStatusItem(payload) {
  const used = finite(payload?.context_used) ?? finite(payload?.estimated_total) ?? 0
  const maximum = finite(payload?.context_max) ?? 0
  const usedPercent = clampPercent(payload?.context_percent) ?? (maximum > 0 ? clampPercent((used / maximum) * 100) : null)
  const categories = Array.isArray(payload?.categories) ? payload.categories : []
  const menuItems = [
    {
      id: 'total',
      disabled: true,
      label: maximum > 0 ? `${count(used)} / ${count(maximum)} tokens` : 'No active context data'
    },
    ...categories.slice(0, 8).map((category, index) => ({
      id: `category:${index}`,
      disabled: true,
      label: `${category.label || category.name || 'Context'}: ${count(category.tokens ?? category.value ?? 0)}`
    }))
  ]

  return {
    id: 'context-usage',
    label: `Ctx ${percent(usedPercent)}`,
    menuItems,
    title: payload?.model ? `Context usage · ${payload.model}` : 'Context usage',
    toggleLabel: 'Context usage',
    variant: 'menu'
  }
}

function clockStatusItem(now = new Date()) {
  return {
    id: 'local-clock',
    label: localTime(now),
    title: new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(now),
    toggleLabel: 'Local clock',
    variant: 'text'
  }
}

function registerReplace(ctx, slots, id, area, order, data) {
  slots.get(id)?.()
  slots.set(id, ctx.register({ id, area, order, data }))
}

const plugin = {
  id: ID,
  name: NAME,
  version: VERSION,
  defaultEnabled: true,
  register(ctx) {
    const slots = new Map()
    let disposed = false

    const showProviders = async () => {
      try {
        const payload = await host.request('usage.providers', {
          providers: ['openai-codex', 'xai-oauth']
        })
        if (!disposed) registerReplace(ctx, slots, 'provider-limits', STATUSBAR_AREAS.right, 100, providerStatusItem(payload))
      } catch (error) {
        if (!disposed) {
          registerReplace(ctx, slots, 'provider-limits', STATUSBAR_AREAS.right, 100, providerStatusItem({ error: String(error) }))
        }
      }
    }

    const showContext = async () => {
      const sessionId = host.state.activeSessionId.get()
      if (!sessionId) {
        registerReplace(ctx, slots, 'context-usage', STATUSBAR_AREAS.right, 110, contextStatusItem(null))
        return
      }
      try {
        const payload = await host.request('session.context_breakdown', { session_id: sessionId })
        if (!disposed) registerReplace(ctx, slots, 'context-usage', STATUSBAR_AREAS.right, 110, contextStatusItem(payload))
      } catch {
        if (!disposed) registerReplace(ctx, slots, 'context-usage', STATUSBAR_AREAS.right, 110, contextStatusItem(null))
      }
    }

    const showClock = () =>
      registerReplace(ctx, slots, 'local-clock', STATUSBAR_AREAS.right, 120, clockStatusItem(new Date()))

    registerReplace(ctx, slots, 'provider-limits', STATUSBAR_AREAS.right, 100, providerStatusItem(null))
    registerReplace(ctx, slots, 'context-usage', STATUSBAR_AREAS.right, 110, contextStatusItem(null))
    showClock()
    registerReplace(ctx, slots, 'change-workspace', SESSION_ACTIONS_AREA, 120, {
      icon: 'folder-opened',
      label: 'Change workspace…',
      async onSelect(session) {
        const cwd = await host.selectWorkspaceDirectory(session.cwd ?? undefined)
        if (!cwd) return
        const result = await host.setSessionWorkspace({ sessionId: session.sessionId, profile: session.profile, cwd })
        host.notify({ kind: 'success', message: result.cwd, title: 'Workspace changed' })
      }
    })

    const providerTimer = setInterval(() => void showProviders(), POLL_MS)
    const contextTimer = setInterval(() => void showContext(), POLL_MS)
    const clockTimer = setInterval(showClock, POLL_MS)
    const activeSessionDispose = host.state.activeSessionId.subscribe(() => void showContext())
    const gatewayDispose = host.state.gateway.subscribe(state => {
      if (state === 'open') void showProviders()
    })
    const usageDispose = host.onEvent('session.usage', () => void showContext())
    const completeDispose = host.onEvent('session.complete', () => {
      void showProviders()
      void showContext()
    })

    ctx.onDispose(() => {
      disposed = true
      clearInterval(providerTimer)
      clearInterval(contextTimer)
      clearInterval(clockTimer)
      activeSessionDispose()
      gatewayDispose()
      usageDispose()
      completeDispose()
      for (const dispose of slots.values()) dispose()
      slots.clear()
    })
  }
}

export { VERSION, clampPercent, contextStatusItem, clockStatusItem, providerStatusItem }
export default plugin
