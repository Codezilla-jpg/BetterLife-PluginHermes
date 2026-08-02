import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginPath = path.join(repoRoot, 'plugin.js')
assert.ok(fs.existsSync(pluginPath), 'plugin.js must exist before the plugin can load')

const source = fs.readFileSync(pluginPath, 'utf8')
const registrations = []
const disposers = []
const timers = new Set()
const listeners = new Set()
let timerSequence = 0

const sandbox = {
  console,
  clearInterval(handle) { timers.delete(handle) },
  clearTimeout(handle) { timers.delete(handle) },
  setInterval() {
    const handle = `interval-${++timerSequence}`
    timers.add(handle)
    return handle
  },
  setTimeout() {
    const handle = `timeout-${++timerSequence}`
    timers.add(handle)
    return handle
  },
  addEventListener(type, listener) { listeners.add(`${type}:${String(listener)}`) },
  removeEventListener(type, listener) { listeners.delete(`${type}:${String(listener)}`) }
}
const context = vm.createContext(sandbox)

const sdk = Object.freeze({})
const react = Object.freeze({})
const jsxRuntime = Object.freeze({})
const synthetic = (identifier, values) => {
  const names = Object.keys(values)
  return new vm.SyntheticModule(names, function () {
    for (const name of names) this.setExport(name, values[name])
  }, { context, identifier })
}

const mod = new vm.SourceTextModule(source, { context, identifier: pluginPath })
await mod.link(specifier => {
  if (specifier === '@hermes/plugin-sdk') return synthetic(specifier, sdk)
  if (specifier === 'react') return synthetic(specifier, react)
  if (specifier === 'react/jsx-runtime') return synthetic(specifier, jsxRuntime)
  throw new Error(`unexpected import: ${specifier}`)
})
await mod.evaluate()

assert.deepEqual(Object.keys(mod.namespace), ['default'])
const plugin = mod.namespace.default
assert.equal(plugin.id, 'statusline-workspaces')
assert.equal(plugin.name, 'Hermes Statusline & Workspaces')
assert.equal(plugin.version, '0.1.0')
assert.deepEqual(Object.keys(plugin).sort(), ['id', 'name', 'register', 'version'])
assert.equal(typeof plugin.register, 'function')

const ctx = {
  register(contribution) { registrations.push(contribution) },
  registerMany(contributions) { registrations.push(...contributions) },
  onDispose(dispose) { disposers.push(dispose) }
}
const returnedCleanup = plugin.register(ctx)
assert.equal(registrations.length, 4)
assert.deepEqual(registrations.map(({ id, area }) => ({ id, area })), [
  { id: 'provider-limits', area: 'statusBar.right' },
  { id: 'context-usage', area: 'statusBar.right' },
  { id: 'local-clock', area: 'statusBar.right' },
  { id: 'change-workspace', area: 'session.actions' }
])
assert.deepEqual(
  registrations.filter(item => item.area === 'statusBar.right').map(item => item.data?.id),
  ['provider-limits', 'context-usage', 'local-clock']
)
assert.equal(registrations.find(item => item.area === 'session.actions')?.id, 'change-workspace')

if (typeof returnedCleanup === 'function') await returnedCleanup()
for (const dispose of disposers.reverse()) await dispose()
assert.equal(timers.size, 0, 'plugin unload must clean up all timers')
assert.equal(listeners.size, 0, 'plugin unload must clean up all listeners')

console.log('smoke: PASS — default export and 4 placeholder contributions verified')
