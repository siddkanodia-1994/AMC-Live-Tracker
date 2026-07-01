export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function requireAdminSecret(request: Request): void {
  const provided = request.headers.get("x-admin-secret");
  const expected = process.env.ADMIN_SECRET;

  if (!expected) {
    throw new Error("ADMIN_SECRET is not configured on the server");
  }
  if (!provided || provided !== expected) {
    throw new UnauthorizedError();
  }
}
