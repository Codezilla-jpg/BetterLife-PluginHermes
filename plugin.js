const ID = 'statusline-workspaces'
const NAME = 'Hermes Statusline & Workspaces'
const VERSION = '0.1.0'

const PLACEHOLDER_CONTRIBUTIONS = [
  {
    id: 'provider-limits',
    area: 'statusBar.right',
    order: 100,
    data: {
      id: 'provider-limits',
      label: 'Provider limits',
      placeholder: true
    }
  },
  {
    id: 'context-usage',
    area: 'statusBar.right',
    order: 110,
    data: {
      id: 'context-usage',
      label: 'Context usage',
      placeholder: true
    }
  },
  {
    id: 'local-clock',
    area: 'statusBar.right',
    order: 120,
    data: {
      id: 'local-clock',
      label: 'Local clock',
      placeholder: true
    }
  },
  {
    id: 'change-workspace',
    area: 'session.actions',
    order: 100,
    data: {
      label: 'Change workspace',
      placeholder: true,
      disabled: true
    }
  }
]

export default {
  id: ID,
  name: NAME,
  version: VERSION,
  register(ctx) {
    for (const contribution of PLACEHOLDER_CONTRIBUTIONS) {
      ctx.register(contribution)
    }
  }
}
