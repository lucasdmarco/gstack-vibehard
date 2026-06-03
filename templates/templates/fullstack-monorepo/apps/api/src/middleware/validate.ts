import { Request, Response, NextFunction } from 'express'
import { z, ZodError } from 'zod'
import { AppError } from './error'

type Schemas = {
  body?: z.ZodType
  query?: z.ZodType
  params?: z.ZodType
}

export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body)
      if (schemas.query) req.query = schemas.query.parse(req.query)
      if (schemas.params) req.params = schemas.params.parse(req.params)
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        next(AppError.validation(err.errors.map(e => ({
          path: e.path.join('.'),
          message: e.message,
        }))))
      } else {
        next(err)
      }
    }
  }
}
