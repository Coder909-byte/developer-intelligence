import { API_VERSION, type ApiSuccess } from '@udi/contracts';
export const responseMeta = (requestId: string) => ({
  apiVersion: API_VERSION,
  requestId,
  timestamp: new Date().toISOString(),
});
export function apiSuccess<T>(data: T, requestId: string): ApiSuccess<T> {
  return { ok: true, data, meta: responseMeta(requestId) };
}
