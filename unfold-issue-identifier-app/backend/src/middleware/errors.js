export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new ApiError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Not authenticated.') => new ApiError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Not permitted.') => new ApiError(403, 'forbidden', msg);
export const notFoundError = (msg = 'Not found.') => new ApiError(404, 'not_found', msg);
export const conflict = (msg, details) => new ApiError(409, 'conflict', msg, details);
export const gone = (msg) => new ApiError(410, 'gone', msg);

/** Wraps an async route so a rejected promise reaches the error handler. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundMiddleware(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
}

export function errorMiddleware(err, req, res, _next) {
  const status = err.status || 500;

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.path}`, err);
  }

  res.status(status).json({
    error: {
      code: err.code || 'internal_error',
      // Never leak an internal stack or driver message to a participant.
      message: status >= 500 ? 'Something went wrong on our side.' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
}
