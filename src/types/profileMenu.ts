export interface ProfileMenuProfileSummary {
  id: string
  name: string
  isDefault: boolean
}

export interface ProfileMenuRequest {
  x: number
  y: number
  profiles: ProfileMenuProfileSummary[]
  activeProfileId: string | null
}
