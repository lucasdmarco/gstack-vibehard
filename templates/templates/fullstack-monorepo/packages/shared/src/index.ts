export type User = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
}

export type ApiResponse<T> = {
  success: true
  data: T
} | {
  success: false
  error: string
}
