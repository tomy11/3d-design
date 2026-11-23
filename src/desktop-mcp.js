import { useEffect, useLayoutEffect, useRef } from 'react'
import { desktop } from './project-file'

function newProjectId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function useDesktopMcp(ready, commands, setNotice, readWorkbench) {
  const projectId = useRef(null)
  const read = useRef(readWorkbench)

  useLayoutEffect(() => { read.current = readWorkbench }, [readWorkbench])

  useEffect(() => {
    if (!desktop || !ready) return
    let active = true
    projectId.current ??= newProjectId()

    async function connect() {
      const { Channel, invoke } = await import('@tauri-apps/api/core')
      if (!active) return
      const channel = new Channel(async ({ id, call }) => {
        let reply
        try {
          if (!active) throw new Error('The workbench is reloading.')
          const currentProject = projectId.current
          const args = call.arguments
          let body
          if (call.name === 'get_body') {
            body = commands.get_body(args)
          } else if (call.name === 'get_scene' || call.name === 'get_robot_pose') {
            body = read.current[call.name]()
          } else if (call.name === 'set_adapter_dimensions') {
            const { revision } = commands.getSnapshot()
            if (args.project_id !== currentProject) {
              throw Object.assign(new Error('The active project has changed. Call get_body before editing.'), {
                code: 'PROJECT_CONFLICT', revision,
              })
            }
            body = await commands.set_adapter_dimensions(args)
            if (body.revision !== revision) setNotice('Flange adapter dimensions updated via MCP.')
          } else {
            throw new Error('Unknown Assembly Lab tool.')
          }
          reply = { status: 'ok', data: { project_id: currentProject, ...body } }
        } catch (error) {
          reply = { status: 'error', data: {
            code: error.code ?? 'TOOL_FAILED',
            message: error.message,
            revision: error.revision,
          } }
        }
        await invoke('mcp_reply', { id, reply }).catch(console.error)
      })
      await invoke('mcp_connect', { channel })
    }
    connect().catch(console.error)
    return () => { active = false }
  }, [ready, commands, setNotice])

  return () => {
    if (desktop) projectId.current = newProjectId()
  }
}
