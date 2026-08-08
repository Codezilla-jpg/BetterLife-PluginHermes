import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginPath = path.join(repoRoot, 'plugin.js')
const source = fs.readFileSync(pluginPath, 'utf8')
const registrations = []
let restartCalls = 0
let hapticCalls = 0
let reloadCalls = 0

assert.doesNotMatch(source, /SESSION_ACTIONS_AREA|selectWorkspaceDirectory|setSessionWorkspace|usage\.bars|ctx\.onDispose/)
assert.match(source, /ctx\.rest/)
assert.match(source, /useQuery/)
assert.match(source, /useEffect/)

const activeSessionId = { get: () => null, subscribe: () => () => {} }
const sdk = {
  host: {
    state: { activeSessionId },
    request: async () => ({ available: false }),
    restartGateway: async () => {
      restartCalls += 1
    }
  },
  haptic: kind => {
    assert.equal(kind, 'tap')
    hapticCalls += 1
  },
  icons: { RefreshCw: 'refresh-icon' },
  SIDEBAR_NAV_AREA: 'sidebar.nav',
  STATUSBAR_AREAS: { left: 'statusBar.left', right: 'statusBar.right' },
  useQuery: options => ({ data: options.enabled === false ? undefined : { providers: [] } }),
  useValue: atom => atom.get()
}
const react = {
  useEffect: effect => effect(),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}]
}
const jsxRuntime = {
  jsx: (type, props) => ({ type, props })
}

const sandbox = {
  console,
  window: {
    location: {
      reload() {
        reloadCalls += 1
      }
    }
  },
  clearInterval() {},
  setInterval() {
    return 1
  }
}
const context = vm.createContext(sandbox)
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
  if (specifier === 'react') return synthetic(specifier, react)
  if (specifier === 'react/jsx-runtime') return synthetic(specifier, jsxRuntime)
  throw new Error(`unexpected import: ${specifier}`)
})
await mod.evaluate()

const {
  clampPercent,
  clockStatusItem,
  contextStatusItem,
  default: plugin,
  providerStatusItem,
  VERSION
} = mod.namespace

assert.equal(VERSION, '0.4.3')
assert.equal(plugin.id, 'statusline-workspaces')
assert.equal(plugin.name, 'BetterLife')
assert.equal(plugin.version, VERSION)
assert.equal(plugin.defaultEnabled, true)
assert.equal(clampPercent(-4), 0)
assert.equal(clampPercent(104), 100)
assert.equal(clampPercent(Number.NaN), null)
const clockLabel = clockStatusItem(new Date(2026, 7, 2, 20, 5)).label
assert.match(clockLabel, /20[:.]05/)
assert.doesNotMatch(clockLabel, /\b(?:AM|PM)\b/i)
assert.equal(contextStatusItem({ context_used: 25, context_max: 100 }).label, 'Ctx 25%')

const providerPayload = {
  providers: [
    {
      id: 'codex',
      label: 'Codex',
      available: true,
      plan: 'Plus',
      windows: [{ label: 'Session', used_percent: 12, reset_at: '2026-08-03T12:00:00Z' }]
    },
    {
      id: 'grok',
      label: 'Grok',
      available: true,
      display_used_percent: 16,
      windows: [
        { label: 'Grok Build', used_percent: 16 },
        { label: 'Monthly included', used_percent: 33, detail: '4934 / 15000 quota points' }
      ]
    }
  ]
}
const codexItem = providerStatusItem(providerPayload, 'codex', 'Codex')
assert.equal(codexItem.label, 'Codex 12%')
assert.match(codexItem.title, /Plan: Plus/)
const grokItem = providerStatusItem(providerPayload, 'grok', 'Grok')
assert.equal(grokItem.label, 'Grok 16%')
assert.match(grokItem.title, /Monthly included: 33% used/)
const legacyGrokItem = providerStatusItem(
  {
    providers: [
      {
        id: 'grok',
        windows: [
          { label: 'Weekly credits', used_percent: 16 },
          { label: 'Monthly included', used_percent: 33 }
        ]
      }
    ]
  },
  'grok',
  'Grok'
)
assert.equal(legacyGrokItem.label, 'Grok 16%')
assert.equal(providerStatusItem({}, 'grok', 'Grok').label, 'Grok —')

const ctx = {
  rest: async () => providerPayload,
  registerMany(contributions) {
    registrations.push(...contributions)
    return () => registrations.splice(0)
  }
}
plugin.register(ctx)
assert.deepEqual(
  registrations.map(item => item.id),
  [
    'betterlife-cronjobs-nav',
    'betterlife-codex-usage',
    'betterlife-grok-usage',
    'betterlife-context-usage',
    'betterlife-local-clock',
    'betterlife-restart-backend',
    'betterlife-restart-client'
  ]
)
const nav = registrations[0]
assert.equal(nav.area, 'sidebar.nav')
assert.equal(nav.data.codicon, 'watch')
assert.equal(nav.data.label, 'Cronjobs')
assert.equal(nav.data.path, '/cron')

const statusItems = registrations.slice(1)
assert.ok(statusItems.every(item => item.data.id === item.id))
assert.ok(statusItems.every(item => item.area === 'statusBar.right'))
assert.ok(statusItems.every(item => typeof item.data.render === 'function'))
assert.ok(statusItems.every(item => typeof item.data.toggleLabel === 'string'))

for (const contribution of statusItems) {
  const element = contribution.data.render()
  assert.equal(typeof element.type, 'function')
}

const backendRestart = registrations.find(item => item.id === 'betterlife-restart-backend')
assert.equal(backendRestart.order, 130)
const backendElement = backendRestart.data.render()
const backendButton = backendElement.type(backendElement.props)
assert.equal(backendButton.type, 'button')
assert.equal(backendButton.props.title, 'Backend neu starten')
assert.equal(backendButton.props.children.type, 'refresh-icon')
await backendButton.props.onClick()
assert.equal(restartCalls, 1)
assert.equal(hapticCalls, 1)

const clientRestart = registrations.find(item => item.id === 'betterlife-restart-client')
assert.equal(clientRestart.order, 140)
const clientElement = clientRestart.data.render()
const clientButton = clientElement.type(clientElement.props)
assert.equal(clientButton.type, 'button')
assert.equal(clientButton.props.title, 'Client neu starten')
await clientButton.props.onClick()
assert.equal(reloadCalls, 1)
assert.equal(hapticCalls, 2)

console.log('smoke: PASS — Cronjobs navigation, provider chips, restart action and lifecycle verified')
