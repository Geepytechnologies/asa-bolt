export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
