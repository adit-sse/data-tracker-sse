/** Validates the Bearer token on all ingestion API routes. */
export function checkApiKey(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.INGESTION_API_KEY;
}
