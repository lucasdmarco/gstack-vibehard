import { Response } from 'express'

export function success<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  return res.json({ success: true as const, data, ...(meta ? { meta } : {}) })
}

export function created<T>(res: Response, data: T) {
  return res.status(201).json({ success: true as const, data })
}

export function noContent(res: Response) {
  return res.status(204).end()
}

export function paginated<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  limit: number
) {
  return res.json({
    success: true as const,
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  })
}
