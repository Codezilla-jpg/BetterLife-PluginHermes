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
const newChatCalls = []
const openSessionCalls = []
const coreFsCalls = []
const requestCalls = []
const liveState = {
  activeSessionId: null,
  storedId: null,
  profile: 'developer',
  cwd: '/home/hermes/1_Projekte/BetterLife-PluginHermes',
  busy: false,
  busyBySession: {}
}

assert.doesNotMatch(source, /SIDEBAR_NAV_AREA|providerStatusItem|contextStatusItem/)
assert.match(source, /ctx\.rest/)
assert.match(source, /useEffect/)
assert.match(source, /useQuery/)

const sdk = {
  cn: (...classes) => classes.filter(Boolean).join(' '),
  host: {
    notifyError: () => {
      notifyErrorCalls += 1
    },
    notify: () => {},
    openSession: async (id, options) => {
      openSessionCalls.push({ id, options })
    },
    newChat: name => {
      newChatCalls.push(name)
    },
    request: async (method, params) => {
      requestCalls.push({ method, params })
      if (method === 'profiles.list') {
        return {
          profiles: [
            { name: 'default', display_name: 'Default' },
            { name: 'developer', display_name: 'Developer' }
          ]
        }
      }
      if (method === 'projects.list') {
        return {
          projects: [
            {
              id: 'p_app',
              name: 'BetterLife',
              archived: false,
              primary_path: '/home/hermes/1_Projekte/BetterLife-PluginHermes'
            },
            { id: 'p_old', name: 'Archiv', archived: true, primary_path: '/tmp/old' }
          ]
        }
      }
      return { ok: true }
    },
    state: {
      activeSessionId: { get: () => liveState.activeSessionId },
      focusedStoredSessionId: { get: () => liveState.storedId },
      focusedSessionProfile: { get: () => liveState.profile },
      profile: { get: () => liveState.profile },
      cwd: { get: () => liveState.cwd },
      busy: { get: () => liveState.busy },
      busyBySession: { get: () => liveState.busyBySession }
    }
  },
  haptic: kind => {
    assert.equal(kind, 'tap')
    hapticCalls += 1
  },
  icons: { ChevronDown: 'chevron-icon', FileText: 'file-icon', FolderOpen: 'folder-icon', RefreshCw: 'refresh-icon' },
  Button: props => ({ type: 'button', props }),
  COMPOSER_AREAS: { top: 'composer.top' },
  Dialog: props => ({ type: 'dialog', props }),
  DialogContent: props => ({ type: 'dialog-content', props }),
  DialogDescription: props => ({ type: 'dialog-description', props }),
  DialogFooter: props => ({ type: 'dialog-footer', props }),
  DialogTitle: props => ({ type: 'dialog-title', props }),
  DropdownMenu: props => ({ type: 'dropdown-menu', props }),
  DropdownMenuContent: props => ({ type: 'dropdown-content', props }),
  DropdownMenuItem: props => ({ type: 'dropdown-item', props }),
  DropdownMenuTrigger: props => ({ type: 'dropdown-trigger', props }),
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
    },
    hermesDesktop: {
      api: async ({ path }) => {
        coreFsCalls.push(path)
        return {
          entries: [{ name: 'Projekte', path: '/home/hermes/1_Projekte', isDirectory: true }]
        }
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
  },
  encodeURIComponent,
  decodeURIComponent
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
  VERSION,
  default: plugin,
  clockStatusItem,
  defaultPickerPath,
  isComposerDraft,
  isSessionRunning,
  listHostDir,
  moveStoredSessionProfile,
  parentDir,
  pathCrumbs,
  projectChoices,
  selectDraftProfile,
  applyWorkspaceCwd,
  workspaceLabel
} = mod.namespace

assert.equal(VERSION, '0.6.0')
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
    if (String(path).startsWith('/fs/list')) {
      return {
        path: '/home/hermes/1_Projekte',
        parent: '/home/hermes',
        entries: [
          { name: 'BetterLife-PluginHermes', path: '/home/hermes/1_Projekte/BetterLife-PluginHermes', isDirectory: true },
          { name: 'README.md', path: '/home/hermes/1_Projekte/README.md', isDirectory: false }
        ]
      }
    }
    if (String(path).startsWith('/session/move')) {
      const query = new URL(path, 'http://local').searchParams
      return {
        ok: true,
        session_id: query.get('session_id'),
        from_profile: query.get('from_profile'),
        to_profile: query.get('to_profile'),
        adopted: true
      }
    }
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
    'betterlife-composer-context',
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
assert.equal(limitsPage.props.children[1].props.children.length, 3)
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
const codexRowElement = limitsPage.props.children[1].props.children[1]
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
const grokRowElement = limitsPage.props.children[1].props.children[2]
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

assert.equal(isComposerDraft(null, null), true)
assert.equal(isComposerDraft('s1', null), false)
assert.equal(isComposerDraft(null, 'stored'), false)
assert.equal(isSessionRunning(null, false, {}), false)
assert.equal(isSessionRunning('live-1', true, {}), true)
assert.equal(isSessionRunning('live-1', false, { 'live-1': true }), true)
assert.equal(isSessionRunning('live-1', false, {}), false)
const fallback = await listHostDir('/home/hermes', async () => {
  throw new Error('Error invoking remote method \'hermes:api\': Error: 404: {"detail":"No such API endpoint: /api/plugins/statusline-workspaces/fs/list"}')
})
assert.equal(fallback.entries[0].name, 'Projekte')
assert.equal(coreFsCalls.some(path => path.includes('/api/fs/list')), true)
assert.equal(workspaceLabel('/home/hermes/1_Projekte/BetterLife-PluginHermes'), 'BetterLife-PluginHermes')
assert.equal(parentDir('/home/hermes/1_Projekte'), '/home/hermes')
assert.equal(parentDir('/'), '/')
assert.equal(pathCrumbs('/home/hermes/1_Projekte').at(-1).path, '/home/hermes/1_Projekte')
assert.equal(defaultPickerPath(''), '/home/hermes/1_Projekte')
const choices = projectChoices({
  projects: [
    { id: 'p_app', name: 'BetterLife', archived: false, primary_path: '/tmp/app' },
    { id: 'p_old', name: 'Archiv', archived: true, primary_path: '/tmp/old' },
    { id: 'p_empty', name: 'Leer', archived: false, primary_path: '' }
  ]
})
assert.equal(choices.length, 1)
assert.equal(choices[0].id, 'p_app')
assert.equal(choices[0].name, 'BetterLife')
assert.equal(choices[0].cwd, '/tmp/app')
assert.equal(selectDraftProfile('personal'), true)
assert.equal(newChatCalls.length, 1)
assert.equal(newChatCalls[0], 'personal')
assert.equal(await applyWorkspaceCwd('/tmp/app', { storedId: 'sess-1' }), true)
assert.equal(requestCalls.at(-1).method, 'session.workspace.move')
assert.equal(requestCalls.at(-1).params.session_key, 'sess-1')
assert.equal(requestCalls.at(-1).params.cwd, '/tmp/app')
assert.equal(await applyWorkspaceCwd('/tmp/run', { sessionId: 'rt-1' }), true)
assert.equal(requestCalls.at(-1).method, 'session.cwd.set')
assert.equal(requestCalls.at(-1).params.session_id, 'rt-1')
assert.equal(requestCalls.at(-1).params.cwd, '/tmp/run')
assert.equal(
  await moveStoredSessionProfile({
    storedId: 'stored-1',
    fromProfile: 'developer',
    toProfile: 'personal',
    rest: ctx.rest
  }),
  true
)
assert.equal(openSessionCalls.length, 1)
assert.equal(openSessionCalls[0].id, 'stored-1')
assert.equal(openSessionCalls[0].options.profile, 'personal')
assert.equal(openSessionCalls[0].options.keepAllProfilesScope, false)
const moved = restCalls.find(call => String(call.path).startsWith('/session/move'))
assert.equal(Boolean(moved), true)

const contextContrib = registrations.find(item => item.id === 'betterlife-composer-context')
assert.equal(contextContrib.area, 'composer.top')
assert.equal(contextContrib.order, 10)
const draftBar = contextContrib.render()
const draftTree = draftBar.type(draftBar.props)
assert.equal(draftTree.props['data-betterlife-context'], 'draft')
assert.equal(draftTree.props.children.length, 3)
const draftPillEl = draftTree.props.children[0].type(draftTree.props.children[0].props)
const draftProfilePill = draftPillEl.type(draftPillEl.props)
assert.equal(draftProfilePill.type, 'dropdown-menu')
assert.equal(typeof draftProfilePill.props.onOpenChange, 'function')
await draftProfilePill.props.onOpenChange(true)
assert.equal(requestCalls.some(call => call.method === 'profiles.list'), true)
const draftProfileTrigger = draftProfilePill.props.children[0]
assert.equal(draftProfileTrigger.props.asChild, true)
const draftProfileButton = draftProfileTrigger.props.children
assert.equal(draftProfileButton.props.disabled, false)
assert.equal(draftProfileButton.props.children[0].props.children, 'developer')
assert.equal(draftProfileButton.props.children[1].type, 'chevron-icon')
const draftWorkspace = draftTree.props.children[1]
assert.equal(draftWorkspace.props.disabled, false)
assert.equal(draftWorkspace.props.children[0].props.children, 'BetterLife-PluginHermes')
assert.equal(typeof draftWorkspace.props.onClick, 'function')
const draftPicker = draftTree.props.children[2]
assert.equal(draftPicker.props.open, false)
assert.match(String(draftPicker.props.initialPath), /1_Projekte/)

liveState.activeSessionId = 'live-1'
liveState.storedId = 'stored-1'
liveState.busy = false
const idleBar = contextContrib.render()
const idleTree = idleBar.type(idleBar.props)
assert.equal(idleTree.props['data-betterlife-context'], 'idle')
const idlePillEl = idleTree.props.children[0].type(idleTree.props.children[0].props)
assert.equal(typeof idlePillEl.props.onOpenChange, 'function')
assert.equal(idleTree.props.children[1].props.disabled, false)

liveState.busy = true
const lockedBar = contextContrib.render()
const lockedTree = lockedBar.type(lockedBar.props)
assert.equal(lockedTree.props['data-betterlife-context'], 'locked')
const lockedProfile = lockedTree.props.children[0].type(lockedTree.props.children[0].props)
assert.equal(lockedProfile.props.disabled, true)
assert.equal(lockedProfile.props.children[1], null)
assert.equal(lockedTree.props.children[1].props.disabled, true)

console.log('smoke: PASS — merged Limits pane, composer context pills, local clock and restart actions verified')
