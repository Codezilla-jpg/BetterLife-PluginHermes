import {
  Button,
  COMPOSER_AREAS,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  STATUSBAR_AREAS,
  cn,
  haptic,
  host,
  icons,
  useQuery,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx } from 'react/jsx-runtime'

const ID = 'statusline-workspaces'
const NAME = 'BetterLife'
const VERSION = '0.6.0'
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
const { ChevronDown, FileText, FolderOpen, RefreshCw } = icons
const PILL_CLASS = cn(
  'h-(--composer-control-size) min-w-0 max-w-44 shrink gap-1 rounded-md px-2 text-xs font-normal',
  'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
)

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

const isComposerDraft = (sessionId, storedId) => !sessionId && !storedId

const pathBasename = value => {
  const text = String(value || '').replace(/[\\/]+$/, '')
  if (!text) return ''
  const parts = text.split(/[\\/]/)
  return parts[parts.length - 1] || text
}

const profileLabel = profile => String(profile?.display_name || profile?.name || '').trim()

const projectPath = project => {
  const primary = String(project?.primary_path || '').trim()
  if (primary) return primary
  const folders = Array.isArray(project?.folders) ? project.folders : []
  const folder = folders.find(item => item?.is_primary) || folders[0]
  return String(folder?.path || '').trim()
}

const projectChoices = payload => {
  const projects = Array.isArray(payload?.projects) ? payload.projects : []
  return projects
    .filter(project => project && !project.archived && projectPath(project))
    .map(project => ({
      id: project.id,
      name: project.name || pathBasename(projectPath(project)),
      cwd: projectPath(project)
    }))
}

const workspaceLabel = (cwd, name) => String(name || pathBasename(cwd) || 'Workspace').trim()

const parentDir = path => {
  const value = String(path || '').replace(/[\\/]+$/, '') || '/'
  if (value === '/') return '/'
  const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  return index <= 0 ? '/' : value.slice(0, index)
}

const pathCrumbs = path => {
  const parts = String(path || '').split(/[\\/]/).filter(Boolean)
  const crumbs = [{ label: '/', path: '/' }]
  let acc = ''
  for (const part of parts) {
    acc += `/${part}`
    crumbs.push({ label: part, path: acc })
  }
  return crumbs
}

const defaultPickerPath = cwd => String(cwd || '').trim() || '/home/hermes/1_Projekte'

const selectDraftProfile = name => {
  const profile = String(name || '').trim()
  if (!profile) return false
  if (typeof host.newChat !== 'function') {
    host.notifyError('Update Hermes Desktop für den Profilwechsel.')
    return false
  }
  haptic('tap')
  host.newChat(profile)
  return true
}

const applyWorkspaceCwd = async (cwd, { sessionId, storedId } = {}) => {
  const path = String(cwd || '').trim()
  if (!path || typeof host.request !== 'function') return false
  if (storedId) {
    await host.request('session.workspace.move', { session_key: storedId, cwd: path })
    return true
  }
  if (sessionId) {
    await host.request('session.cwd.set', { session_id: sessionId, cwd: path })
    return true
  }
  return false
}

function ContextPill({ label, title, locked, onOpen, children }) {
  const trigger = jsx(Button, {
    type: 'button',
    variant: 'ghost',
    disabled: locked,
    className: PILL_CLASS,
    title,
    'aria-label': title,
    children: [
      jsx('span', { key: 'label', className: 'truncate', children: label }),
      locked ? null : jsx(ChevronDown, { key: 'chevron', className: 'size-2.5 shrink-0 opacity-50' })
    ]
  })
  if (locked) return trigger
  return jsx(DropdownMenu, {
    onOpenChange: open => {
      if (open && typeof onOpen === 'function') void onOpen()
    },
    children: [
      jsx(DropdownMenuTrigger, { key: 'trigger', asChild: true, children: trigger }),
      jsx(DropdownMenuContent, {
        key: 'content',
        align: 'start',
        side: 'top',
        sideOffset: 8,
        className: 'min-w-48 p-1',
        children
      })
    ]
  })
}

function FolderRow({ name, disabled, muted, icon, onClick }) {
  return jsx('button', {
    type: 'button',
    disabled,
    onClick,
    className: cn(
      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
      muted
        ? 'text-(--ui-text-quaternary)'
        : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground',
      disabled && 'pointer-events-none opacity-40'
    ),
    children: [
      jsx(icon, { key: 'icon', className: 'size-3.5 shrink-0 opacity-70' }),
      jsx('span', { key: 'name', className: 'min-w-0 truncate', children: name })
    ]
  })
}

function WorkspacePicker({ open, initialPath, rest, onOpenChange, onSelect }) {
  const [currentPath, setCurrentPath] = useState(initialPath)
  const [entries, setEntries] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) setCurrentPath(initialPath || defaultPickerPath())
  }, [open, initialPath])

  useEffect(() => {
    if (!open || typeof rest !== 'function') return undefined
    let alive = true
    setLoading(true)
    setError(null)
    void rest(`/fs/list?path=${encodeURIComponent(currentPath || '')}`, { timeoutMs: 15_000 })
      .then(result => {
        if (!alive) return
        if (result?.error) {
          setError(result.error)
          setEntries([])
          if (result.path && result.path !== currentPath) setCurrentPath(result.path)
          return
        }
        if (result?.path && result.path !== currentPath) setCurrentPath(result.path)
        setEntries(Array.isArray(result?.entries) ? result.entries : [])
      })
      .catch(err => {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
        setEntries([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, currentPath, rest])

  const crumbs = pathCrumbs(currentPath)
  const close = () => onOpenChange(false)

  return jsx(Dialog, {
    open,
    onOpenChange: next => {
      if (!next) close()
    },
    children: jsx(DialogContent, {
      className: 'h-[min(36rem,calc(100vh-4rem))] max-w-lg',
      bodyClassName: 'flex min-h-0 flex-col gap-0 overflow-hidden p-0',
      children: [
        jsx('div', {
          key: 'header',
          className: 'shrink-0 border-b border-(--ui-stroke-secondary) px-4 py-3',
          children: [
            jsx(DialogTitle, { key: 'title', className: 'text-sm', children: 'Workspace auf Hermes-Host' }),
            jsx(DialogDescription, {
              key: 'desc',
              className: 'mt-1 text-xs',
              children: 'Ordner wählen. Dateien sind nur zur Orientierung sichtbar.'
            })
          ]
        }),
        jsx('div', {
          key: 'crumbs',
          className: 'flex shrink-0 flex-wrap items-center gap-1 border-b border-(--ui-stroke-secondary) px-3 py-2 text-xs text-(--ui-text-tertiary)',
          children: crumbs.map((crumb, index) =>
            jsx('button', {
              key: crumb.path,
              type: 'button',
              className: cn(
                'rounded px-1.5 py-0.5 hover:bg-(--chrome-action-hover) hover:text-foreground',
                index === crumbs.length - 1 && 'text-foreground'
              ),
              onClick: () => setCurrentPath(crumb.path),
              children: crumb.label
            })
          )
        }),
        jsx('div', {
          key: 'list',
          className: 'min-h-0 flex-1 overflow-y-auto p-2',
          children: [
            jsx(FolderRow, {
              key: 'up',
              name: '..',
              icon: FolderOpen,
              disabled: currentPath === '/',
              onClick: () => setCurrentPath(parentDir(currentPath))
            }),
            loading
              ? jsx('div', {
                  key: 'loading',
                  className: 'px-2 py-3 text-xs text-(--ui-text-tertiary)',
                  children: 'Lade Host-Dateien…'
                })
              : error
                ? jsx('div', {
                    key: 'error',
                    className: 'px-2 py-3 text-xs text-destructive',
                    children: error
                  })
                : entries.length === 0
                  ? jsx('div', {
                      key: 'empty',
                      className: 'px-2 py-3 text-xs text-(--ui-text-tertiary)',
                      children: 'Leerer Ordner'
                    })
                  : entries.map(entry =>
                      jsx(FolderRow, {
                        key: entry.path,
                        name: entry.name,
                        icon: entry.isDirectory ? FolderOpen : FileText,
                        muted: !entry.isDirectory,
                        disabled: !entry.isDirectory,
                        onClick: entry.isDirectory ? () => setCurrentPath(entry.path) : undefined
                      })
                    )
          ]
        }),
        jsx(DialogFooter, {
          key: 'footer',
          className: 'shrink-0 justify-between gap-2 border-t border-(--ui-stroke-secondary) px-4 py-3',
          children: [
            jsx('div', {
              key: 'path',
              className: 'min-w-0 truncate text-xs text-(--ui-text-tertiary)',
              title: currentPath,
              children: currentPath
            }),
            jsx('div', {
              key: 'actions',
              className: 'flex shrink-0 items-center gap-2',
              children: [
                jsx(Button, {
                  key: 'cancel',
                  type: 'button',
                  size: 'sm',
                  variant: 'ghost',
                  onClick: close,
                  children: 'Abbrechen'
                }),
                jsx(Button, {
                  key: 'select',
                  type: 'button',
                  size: 'sm',
                  onClick: () => {
                    if (!currentPath) return
                    haptic('tap')
                    onSelect(currentPath)
                    close()
                  },
                  children: 'Diesen Ordner wählen'
                })
              ]
            })
          ]
        })
      ]
    })
  })
}

function ContextBar({ rest }) {
  const sessionId = useValue(host.state.activeSessionId)
  const storedId = useValue(host.state.focusedStoredSessionId)
  const liveProfile = useValue(host.state.focusedSessionProfile) || useValue(host.state.profile) || 'default'
  const liveCwd = useValue(host.state.cwd) || ''
  const draft = isComposerDraft(sessionId, storedId)
  const [profiles, setProfiles] = useState([])
  const [pendingProfile, setPendingProfile] = useState('')
  const [pendingWorkspace, setPendingWorkspace] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const profileName = draft && pendingProfile ? pendingProfile : liveProfile
  const workspace = draft && pendingWorkspace ? pendingWorkspace : { cwd: liveCwd, name: '' }
  const workspaceName = workspaceLabel(workspace.cwd, workspace.name)

  const loadOptions = async () => {
    if (typeof host.request !== 'function') return
    try {
      const profilePayload = await host.request('profiles.list', { include_sessions: false })
      setProfiles(Array.isArray(profilePayload?.profiles) ? profilePayload.profiles : [])
    } catch {
      // fail-open: the live profile label still renders
    }
  }

  useEffect(() => {
    if (!pendingWorkspace?.cwd) return
    if (!sessionId && !storedId) return
    const cwd = pendingWorkspace.cwd
    void applyWorkspaceCwd(cwd, { sessionId, storedId })
      .then(applied => {
        if (applied) setPendingWorkspace(null)
      })
      .catch(error => host.notifyError(error, 'Workspace konnte nicht gesetzt werden'))
  }, [pendingWorkspace, sessionId, storedId])

  const onPickProfile = name => {
    if (!draft || name === profileName) return
    setPendingProfile(name)
    selectDraftProfile(name)
  }

  const onPickWorkspace = async choice => {
    if (!draft || !choice?.cwd) return
    if (choice.cwd === workspace.cwd) return
    haptic('tap')
    setPendingWorkspace(choice)
    try {
      const applied = await applyWorkspaceCwd(choice.cwd, {
        sessionId: host.state.activeSessionId.get(),
        storedId: host.state.focusedStoredSessionId.get()
      })
      if (applied) {
        setPendingWorkspace(null)
        return
      }
      if (choice.id) {
        await host.request('projects.set_active', { id: choice.id }).catch(() => undefined)
      }
    } catch (error) {
      host.notifyError(error, 'Workspace konnte nicht gesetzt werden')
    }
  }

  return jsx('div', {
    className: 'flex min-w-0 items-center gap-1',
    'data-betterlife-context': draft ? 'draft' : 'locked',
    children: [
      jsx(ContextPill, {
        key: 'profile',
        label: profileName,
        title: draft ? 'Profil wählen' : `Profil: ${profileName}`,
        locked: !draft,
        onOpen: loadOptions,
        children: profiles.map(profile => {
          const name = profileLabel(profile) || profile.name
          return jsx(DropdownMenuItem, {
            key: name,
            onSelect: () => onPickProfile(profile.name),
            children: name
          })
        })
      }),
      jsx(Button, {
        key: 'workspace',
        type: 'button',
        variant: 'ghost',
        disabled: !draft,
        className: PILL_CLASS,
        title: draft ? 'Workspace auf Hermes-Host wählen' : `Workspace: ${workspace.cwd || workspaceName}`,
        'aria-label': draft ? 'Workspace auf Hermes-Host wählen' : `Workspace: ${workspaceName}`,
        onClick: () => {
          if (!draft) return
          haptic('tap')
          setPickerOpen(true)
        },
        children: [
          jsx('span', { key: 'label', className: 'truncate', children: workspaceName }),
          draft ? jsx(ChevronDown, { key: 'chevron', className: 'size-2.5 shrink-0 opacity-50' }) : null
        ]
      }),
      jsx(WorkspacePicker, {
        key: 'picker',
        open: pickerOpen,
        initialPath: defaultPickerPath(workspace.cwd),
        rest,
        onOpenChange: setPickerOpen,
        onSelect: cwd => {
          void onPickWorkspace({ cwd, name: pathBasename(cwd) })
        }
      })
    ]
  })
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
        id: 'betterlife-composer-context',
        area: COMPOSER_AREAS.top,
        order: 10,
        render: () => jsx(ContextBar, { rest: ctx.rest })
      },
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

export {
  VERSION,
  applyWorkspaceCwd,
  clockStatusItem,
  defaultPickerPath,
  isComposerDraft,
  parentDir,
  pathCrumbs,
  projectChoices,
  selectDraftProfile,
  workspaceLabel
}
export default plugin
