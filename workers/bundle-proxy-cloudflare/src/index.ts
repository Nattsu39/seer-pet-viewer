import { handleProxyRequest } from "./logic";

export interface Env {
  ALLOWED_ORIGIN?: string;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    return handleProxyRequest(request, {
      allowedOrigin: env.ALLOWED_ORIGIN,
    });
  },
};
