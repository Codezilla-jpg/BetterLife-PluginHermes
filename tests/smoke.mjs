import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginPath = path.join(repoRoot, 'plugin.js')
const source = fs.readFileSync(pluginPath, 'utf8')
const registrations = []

assert.doesNotMatch(source, /SESSION_ACTIONS_AREA|selectWorkspaceDirectory|setSessionWorkspace|usage\.providers|ctx\.onDispose/)
assert.match(source, /useQuery/)
assert.match(source, /useEffect/)

const activeSessionId = { get: () => null, subscribe: () => () => {} }
const sdk = {
  host: {
    state: { activeSessionId },
    request: async () => ({ available: false })
  },
  STATUSBAR_AREAS: { left: 'statusBar.left', right: 'statusBar.right' },
  useQuery: options => ({ data: options.enabled === false ? undefined : { available: false } }),
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

const { clampPercent, clockStatusItem, contextStatusItem, default: plugin, usageStatusItem, VERSION } = mod.namespace
assert.equal(VERSION, '0.2.0')
assert.equal(plugin.id, 'statusline-workspaces')
assert.equal(plugin.name, 'Hermes Statusline')
assert.equal(plugin.version, VERSION)
assert.equal(plugin.defaultEnabled, true)
assert.equal(clampPercent(-4), 0)
assert.equal(clampPercent(104), 100)
assert.equal(clampPercent(Number.NaN), null)
assert.match(clockStatusItem(new Date('2026-08-02T20:00:00Z')).label, /\d{2}:\d{2}/)
assert.equal(contextStatusItem({ context_used: 25, context_max: 100 }).label, 'Ctx 25%')

const usageItem = usageStatusItem({
  available: true,
  plan_name: 'Plus',
  renews_display: 'Aug 31, 2026',
  total_spendable_display: '$14.00',
  plan_bar: {
    remaining_display: '$14.00',
    total_display: '$20.00',
    pct_used: 30
  }
})
assert.equal(usageItem.label, 'Plus $14.00')
assert.match(usageItem.title, /30% used/)

const ctx = {
  registerMany(contributions) {
    registrations.push(...contributions)
    return () => registrations.splice(0)
  }
}
plugin.register(ctx)
assert.deepEqual(
  registrations.map(item => item.id),
  ['account-usage', 'context-usage', 'local-clock']
)
assert.ok(registrations.every(item => item.area === 'statusBar.right'))
assert.ok(registrations.every(item => typeof item.data.render === 'function'))
assert.ok(registrations.every(item => typeof item.data.toggleLabel === 'string'))

for (const contribution of registrations) {
  const element = contribution.data.render()
  assert.equal(typeof element.type, 'function')
}

console.log('smoke: PASS — lifecycle-safe status components verified')
