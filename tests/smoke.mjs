import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginPath = path.join(repoRoot, 'plugin.js')
const source = fs.readFileSync(pluginPath, 'utf8')
const activeRegistrations = new Map()
const registrationHistory = []
const pluginDisposers = []
const timers = new Map()
const eventListeners = new Map()
const notifications = []
const workspaceChanges = []
let timerSequence = 0

function atom(initial) {
  let value = initial
  const subscribers = new Set()
  return {
    get: () => value,
    set(next) {
      value = next
      for (const subscriber of subscribers) subscriber(value)
    },
    subscribe(subscriber) {
      subscribers.add(subscriber)
      subscriber(value)
      return () => subscribers.delete(subscriber)
    },
    subscriberCount: () => subscribers.size
  }
}

const activeSessionId = atom(null)
const gateway = atom('open')
const host = {
  state: { activeSessionId, gateway },
  async request(method) {
    if (method === 'usage.providers') {
      return {
        providers: {
          'openai-codex': {
            account: {
              windows: [{ label: 'Session', used_percent: 42, reset_at: '2026-08-03T10:00:00Z' }]
            },
            rate_limits: null
          },
          'xai-oauth': {
            account: null,
            rate_limits: {
              available: true,
              buckets: {
                requests_min: {
                  limit: 100,
                  remaining: 75,
                  used: 25,
                  used_percent: 25,
                  reset_at: '2026-08-03T10:01:00Z'
                }
              }
            }
          }
        }
      }
    }
    if (method === 'session.context_breakdown') {
      return {
        context_used: 32_000,
        context_max: 128_000,
        context_percent: 25,
        model: 'gpt-test',
        categories: [{ label: 'Messages', tokens: 30_000 }]
      }
    }
    throw new Error(`unexpected request ${method}`)
  },
  onEvent(type, listener) {
    const listeners = eventListeners.get(type) ?? new Set()
    listeners.add(listener)
    eventListeners.set(type, listeners)
    return () => listeners.delete(listener)
  },
  async selectWorkspaceDirectory() {
    return '/new/workspace'
  },
  async setSessionWorkspace(change) {
    workspaceChanges.push(change)
    return { cwd: change.cwd, live: false, session_id: change.sessionId }
  },
  notify(notification) {
    notifications.push(notification)
  }
}

const sandbox = {
  console,
  clearInterval(handle) {
    timers.delete(handle)
  },
  setInterval(callback) {
    const handle = `interval-${++timerSequence}`
    timers.set(handle, callback)
    return handle
  }
}
const context = vm.createContext(sandbox)
const sdk = {
  host,
  SESSION_ACTIONS_AREA: 'session.actions',
  STATUSBAR_AREAS: { left: 'statusBar.left', right: 'statusBar.right' }
}
const synthetic = (identifier, values) => {
  const names = Object.keys(values)
  return new vm.SyntheticModule(
    names,
    function () {
      for (const name of names) this.setExport(name, values[name])
    },
    { context, identifier }
  )
}
const mod = new vm.SourceTextModule(source, { context, identifier: pluginPath })
await mod.link(specifier => {
  if (specifier === '@hermes/plugin-sdk') return synthetic(specifier, sdk)
  throw new Error(`unexpected import: ${specifier}`)
})
await mod.evaluate()

const { clampPercent, clockStatusItem, contextStatusItem, default: plugin, providerStatusItem, VERSION } = mod.namespace
assert.equal(VERSION, '0.1.0')
assert.equal(plugin.id, 'statusline-workspaces')
assert.equal(plugin.name, 'Hermes Statusline & Workspaces')
assert.equal(plugin.version, VERSION)
assert.equal(plugin.defaultEnabled, true)
assert.equal(clampPercent(-4), 0)
assert.equal(clampPercent(104), 100)
assert.equal(clampPercent(Number.NaN), null)
assert.match(clockStatusItem(new Date('2026-08-02T20:00:00Z')).label, /\d{2}:\d{2}/)
assert.equal(contextStatusItem({ context_used: 25, context_max: 100 }).label, 'Ctx 25%')

const providerPayload = await host.request('usage.providers')
const providerItem = providerStatusItem(providerPayload)
assert.equal(providerItem.label, 'Codex 42% · Grok 25%')
assert.ok(providerItem.menuItems.some(item => item.label.includes('resets')))
assert.ok(providerItem.menuItems.every(item => item.disabled === true))

const ctx = {
  register(contribution) {
    registrationHistory.push(contribution)
    activeRegistrations.set(contribution.id, contribution)
    return () => {
      if (activeRegistrations.get(contribution.id) === contribution) activeRegistrations.delete(contribution.id)
    }
  },
  onDispose(dispose) {
    pluginDisposers.push(dispose)
  }
}
plugin.register(ctx)
await new Promise(resolve => setImmediate(resolve))

assert.deepEqual([...activeRegistrations.keys()].sort(), [
  'change-workspace',
  'context-usage',
  'local-clock',
  'provider-limits'
])
assert.equal(activeRegistrations.get('provider-limits').data.label, 'Codex 42% · Grok 25%')
assert.equal(activeRegistrations.get('context-usage').data.label, 'Ctx —')
assert.equal(timers.size, 3)
assert.equal(activeSessionId.subscriberCount(), 1)
assert.equal(gateway.subscriberCount(), 1)
assert.equal(eventListeners.get('session.usage').size, 1)
assert.equal(eventListeners.get('session.complete').size, 1)

activeSessionId.set('runtime-1')
await new Promise(resolve => setImmediate(resolve))
assert.equal(activeRegistrations.get('context-usage').data.label, 'Ctx 25%')
assert.ok(activeRegistrations.get('context-usage').data.menuItems.some(item => item.label.includes('32K')))

const workspaceAction = activeRegistrations.get('change-workspace').data
assert.equal(workspaceAction.label, 'Change workspace…')
await workspaceAction.onSelect({ cwd: '/old', profile: 'work', sessionId: 'stored-1', surface: 'row', title: 'Session' })
assert.equal(workspaceChanges.length, 1)
assert.equal(workspaceChanges[0].cwd, '/new/workspace')
assert.equal(workspaceChanges[0].profile, 'work')
assert.equal(workspaceChanges[0].sessionId, 'stored-1')
assert.equal(notifications.at(-1).title, 'Workspace changed')

for (const dispose of pluginDisposers.reverse()) await dispose()
assert.equal(timers.size, 0, 'plugin unload must clean up all timers')
assert.equal(activeSessionId.subscriberCount(), 0)
assert.equal(gateway.subscriberCount(), 0)
assert.equal(eventListeners.get('session.usage').size, 0)
assert.equal(eventListeners.get('session.complete').size, 0)
assert.equal(activeRegistrations.size, 0, 'plugin unload must remove all contributions')
assert.ok(registrationHistory.length >= 4)

console.log('smoke: PASS — live status items, workspace action and cleanup verified')
