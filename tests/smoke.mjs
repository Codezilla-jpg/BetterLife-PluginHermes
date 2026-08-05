import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginPath = path.join(repoRoot, 'plugin.js')
const source = fs.readFileSync(pluginPath, 'utf8')
const registrations = []

assert.doesNotMatch(source, /SESSION_ACTIONS_AREA|selectWorkspaceDirectory|setSessionWorkspace|usage\.bars|ctx\.onDispose/)
assert.match(source, /ctx\.rest/)
assert.match(source, /useQuery/)
assert.match(source, /useEffect/)

const activeSessionId = { get: () => null, subscribe: () => () => {} }
const sdk = {
  host: {
    state: { activeSessionId },
    request: async () => ({ available: false })
  },
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

assert.equal(VERSION, '0.3.1')
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
      windows: [
        { label: 'Weekly credits', used_percent: 100 },
        { label: 'Monthly included', used_percent: 28, detail: '4169 / 15000 quota points' }
      ]
    }
  ]
}
const codexItem = providerStatusItem(providerPayload, 'codex', 'Codex')
assert.equal(codexItem.label, 'Codex 12%')
assert.match(codexItem.title, /Plan: Plus/)
const grokItem = providerStatusItem(providerPayload, 'grok', 'Grok')
assert.equal(grokItem.label, 'Grok 100%')
assert.match(grokItem.title, /Monthly included: 28% used/)
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
  ['betterlife-codex-usage', 'betterlife-grok-usage', 'betterlife-context-usage', 'betterlife-local-clock']
)
assert.ok(registrations.every(item => item.data.id === item.id))
assert.ok(registrations.every(item => item.area === 'statusBar.right'))
assert.ok(registrations.every(item => typeof item.data.render === 'function'))
assert.ok(registrations.every(item => typeof item.data.toggleLabel === 'string'))

for (const contribution of registrations) {
  const element = contribution.data.render()
  assert.equal(typeof element.type, 'function')
}

console.log('smoke: PASS — Codex/Grok provider chips and lifecycle verified')
