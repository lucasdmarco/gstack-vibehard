import { Request, Response, NextFunction } from 'express'

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, 'BAD_REQUEST', message, details)
  }

  static unauthorized(message = 'Unauthorized') {
    return new AppError(401, 'UNAUTHORIZED', message)
  }

  static forbidden(message = 'Forbidden') {
    return new AppError(403, 'FORBIDDEN', message)
  }

  static notFound(message = 'Not found') {
    return new AppError(404, 'NOT_FOUND', message)
  }

  static conflict(message: string) {
    return new AppError(409, 'CONFLICT', message)
  }

  static validation(details: unknown) {
    return new AppError(422, 'VALIDATION_ERROR', 'Validation failed', details)
  }

  static internal(message = 'Internal server error') {
    return new AppError(500, 'INTERNAL_ERROR', message)
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    })
    return
  }

  console.error('Unhandled error:', err)
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  })
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found`,
    },
  })
}
