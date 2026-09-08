import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginPath = path.join(repoRoot, 'plugin.js')
const source = fs.readFileSync(pluginPath, 'utf8')
const registrations = []
let hapticCalls = 0
let reloadCalls = 0
let notifyErrorCalls = 0
const restCalls = []
const queryCacheUpdates = []

assert.doesNotMatch(source, /SIDEBAR_NAV_AREA|providerStatusItem|contextStatusItem/)
assert.match(source, /ctx\.rest/)
assert.match(source, /useEffect/)
assert.match(source, /useQuery/)

const sdk = {
  cn: (...classes) => classes.filter(Boolean).join(' '),
  host: {
    notifyError: () => {
      notifyErrorCalls += 1
    }
  },
  haptic: kind => {
    assert.equal(kind, 'tap')
    hapticCalls += 1
  },
  icons: { RefreshCw: 'refresh-icon' },
  STATUSBAR_AREAS: { left: 'statusBar.left', right: 'statusBar.right' },
  useQuery: () => ({
    data: {
      fetched_at: '2026-08-25T12:00:00Z',
      providers: [
        {
          id: 'nous',
          label: 'Nous Research',
          available: false,
          reason: 'Nous quota unavailable',
          windows: []
        },
        {
          id: 'claude',
          label: 'Claude',
          available: true,
          display_used_percent: 40,
          display_reset_at: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
          windows: [
            { used_percent: 40, reset_at: new Date(Date.now() + 3 * 60 * 60_000).toISOString() },
            { used_percent: 10, reset_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString() }
          ]
        },
        {
          id: 'codex',
          label: 'OpenAI Codex',
          available: true,
          windows: [
            { used_percent: 20, reset_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString() },
            { used_percent: 80, reset_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString() }
          ]
        },
        {
          id: 'grok',
          label: 'xAI Grok',
          available: true,
          display_used_percent: 10,
          display_reset_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
          windows: [
            { used_percent: 10, reset_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString() },
            { used_percent: 80, reset_at: new Date(Date.now() + 60_000).toISOString() }
          ]
        }
      ]
    },
    isError: false,
    isFetching: false,
    isLoading: false,
    refetch: async () => ({})
  }),
  useQueryClient: () => ({
    setQueryData: (key, data) => queryCacheUpdates.push({ key, data })
  }),
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
  },
  setTimeout(callback) {
    callback()
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

const { VERSION, default: plugin, clockStatusItem } = mod.namespace

assert.equal(VERSION, '0.7.0')
assert.equal(plugin.id, 'statusline-workspaces')
assert.equal(plugin.name, 'BetterLife')
assert.equal(plugin.version, VERSION)
assert.equal(plugin.defaultEnabled, true)
const clockLabel = clockStatusItem(new Date(2026, 7, 2, 20, 5)).label
assert.match(clockLabel, /20[:.]05/)
assert.doesNotMatch(clockLabel, /\b(?:AM|PM)\b/i)

const ctx = {
  rest: async (path, options) => {
    restCalls.push({ path, options })
    if (path === '/refresh') return { providers: [], fetched_at: '2026-08-25T12:01:00Z' }
    return { ok: true }
  },
  registerMany(contributions) {
    registrations.push(...contributions)
    return () => registrations.splice(0)
  }
}
plugin.register(ctx)
assert.deepEqual(
  registrations.map(item => item.id),
  [
    'betterlife-limits-pane',
    'betterlife-local-clock',
    'betterlife-restart-gateway',
    'betterlife-restart-hermes',
    'betterlife-restart-client'
  ]
)

const limitsPane = registrations.find(item => item.id === 'betterlife-limits-pane')
assert.equal(limitsPane.area, 'panes')
assert.equal(limitsPane.title, 'Limits')
assert.equal(limitsPane.data.placement, 'left')
assert.equal(limitsPane.data.dock.pane, 'sessions')
assert.equal(limitsPane.data.dock.pos, 'center')
const limitsElement = limitsPane.render()
const limitsPage = limitsElement.type(limitsElement.props)
assert.equal(limitsPage.type, 'div')
assert.equal(limitsPage.props.children[0].props.children[0].props.children, 'Limits')
assert.equal(limitsPage.props.children[1].props.children.length, 4)
const nousRowElement = limitsPage.props.children[1].props.children[0]
const nousRow = nousRowElement.type(nousRowElement.props)
assert.equal(nousRow.props.children[0].props.left, null)
const nousRingElement = nousRow.props.children[0]
const nousRing = nousRingElement.type(nousRingElement.props)
const nousRingValue = nousRing.props.children[1]
assert.equal(nousRing.props['aria-label'], 'Nicht verfügbar')
assert.equal(nousRingValue.props.children[0].props.children, 'N/V')
assert.equal(nousRingValue.props.children[1].props.children, 'Nicht verfügbar')
const nousTabElement = nousRow.props.children[1]
const nousTab = nousTabElement.type(nousTabElement.props)
const nousReason = nousTab.props.children.find(child => child.props?.key === 'reason')
assert.equal(nousReason.props.children, 'Nicht verfügbar')
assert.equal(nousReason.props.title, 'Nous quota unavailable')
const claudeRowElement = limitsPage.props.children[1].props.children[1]
const claudeRow = claudeRowElement.type(claudeRowElement.props)
assert.equal(claudeRow.props.children[0].props.left, 60)
const codexRowElement = limitsPage.props.children[1].props.children[2]
const codexRow = codexRowElement.type(codexRowElement.props)
assert.equal(codexRow.props.children[0].props.left, 20)
const codexRingElement = codexRow.props.children[0]
const codexRing = codexRingElement.type(codexRingElement.props)
const codexRingValue = codexRing.props.children[1]
assert.equal(codexRing.props['aria-label'], '20% übrig')
assert.equal(codexRing.props.style.width, '108px')
assert.equal(codexRing.props.style.height, '108px')
assert.equal(codexRingValue.props.children[0].props.children, '20%')
assert.equal(codexRingValue.props.children[1].props.children, 'übrig')
assert.equal(codexRingValue.props.style.maxWidth, '68px')
assert.equal(codexRingValue.props.children[0].props.style.fontSize, '1rem')
assert.equal(codexRingValue.props.children[1].props.style.marginTop, '2px')
assert.equal(codexRingValue.props.children[1].props.style.letterSpacing, '0.12em')
const codexTabElement = codexRow.props.children[1]
const codexTab = codexTabElement.type(codexTabElement.props)
assert.equal(codexTab.props.style.flex, '0 1 30rem')
assert.doesNotMatch(codexTab.props.className, /\bflex-1\b/)
assert.match(codexTab.props.children.find(child => child.props?.key === 'reset').props.children, /^Reset in (23h|1d)/)
const grokRowElement = limitsPage.props.children[1].props.children[3]
const grokRow = grokRowElement.type(grokRowElement.props)
assert.equal(grokRow.props.children[0].props.left, 90)
const grokTabElement = grokRow.props.children[1]
const grokTab = grokTabElement.type(grokTabElement.props)
assert.match(grokTab.props.children.find(child => child.props?.key === 'reset').props.children, /^Reset in [12]h/)
const refreshButton = limitsPage.props.children[0].props.children[1]
await refreshButton.props.onClick()
const forceRefresh = restCalls.find(call => call.path === '/refresh')
assert.equal(forceRefresh.options.method, 'POST')
assert.equal(forceRefresh.options.timeoutMs, 45_000)
assert.equal(queryCacheUpdates.length, 1)
assert.equal(queryCacheUpdates[0].key[1], 'limits')

const statusItems = registrations.filter(item => item.area === 'statusBar.right')
assert.ok(statusItems.every(item => item.data.id === item.id))
assert.ok(statusItems.every(item => item.area === 'statusBar.right'))
assert.ok(statusItems.every(item => typeof item.data.render === 'function'))
assert.ok(statusItems.every(item => typeof item.data.toggleLabel === 'string'))

for (const contribution of statusItems) {
  const element = contribution.data.render()
  assert.equal(typeof element.type, 'function')
}

const clockChip = registrations.find(item => item.id === 'betterlife-local-clock')
assert.equal(clockChip.order, 120)
const clockElement = clockChip.data.render()
const chip = clockElement.type(clockElement.props)
assert.equal(typeof chip.type, 'function')
assert.equal(String(chip.props.children ?? ''), '')

const gatewayRestart = registrations.find(item => item.id === 'betterlife-restart-gateway')
assert.equal(gatewayRestart.order, 130)
const gatewayElement = gatewayRestart.data.render()
const gatewayButton = gatewayElement.type(gatewayElement.props)
assert.equal(gatewayButton.type, 'button')
assert.equal(gatewayButton.props.title, 'Gateway neu starten')
assert.equal(gatewayButton.props.children[0].type, 'refresh-icon')
assert.equal(gatewayButton.props.children[1].props.children, 'Gateway')
assert.equal(gatewayButton.props.style.width, '28px')
assert.equal(gatewayButton.props.children[1].props.style.maxWidth, '0')
assert.equal(typeof gatewayButton.props.onMouseEnter, 'function')
assert.equal(typeof gatewayButton.props.onMouseLeave, 'function')
await gatewayButton.props.onClick()
const gatewayCall = restCalls.find(call => call.path === '/restart/gateway')
assert.equal(gatewayCall.options.method, 'POST')
assert.equal(gatewayCall.options.timeoutMs, 45_000)
assert.equal(hapticCalls, 2)

const hermesRestart = registrations.find(item => item.id === 'betterlife-restart-hermes')
assert.equal(hermesRestart.order, 140)
const hermesElement = hermesRestart.data.render()
const hermesButton = hermesElement.type(hermesElement.props)
assert.equal(hermesButton.props.title, 'Hermes neu starten')
assert.equal(hermesButton.props.children[1].props.children, 'Hermes')
await hermesButton.props.onClick()
const hermesCall = restCalls.find(call => call.path === '/restart/hermes')
assert.equal(hermesCall.options.method, 'POST')
assert.equal(hermesCall.options.timeoutMs, 5_000)
assert.equal(reloadCalls, 1)
assert.equal(hapticCalls, 3)

const clientRestart = registrations.find(item => item.id === 'betterlife-restart-client')
assert.equal(clientRestart.order, 150)
const clientElement = clientRestart.data.render()
const clientButton = clientElement.type(clientElement.props)
assert.equal(clientButton.type, 'button')
assert.equal(clientButton.props.title, 'Client neu starten')
await clientButton.props.onClick()
assert.equal(reloadCalls, 2)
assert.equal(hapticCalls, 4)
assert.equal(notifyErrorCalls, 0)

console.log('smoke: PASS — merged Limits pane, local clock and restart actions verified')
