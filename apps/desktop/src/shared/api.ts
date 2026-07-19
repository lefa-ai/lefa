export const workspaceChannel = 'workspace:select-directory'

export interface LefaApi {
  workspace: {
    selectDirectory: () => Promise<string | null>
  }
}
