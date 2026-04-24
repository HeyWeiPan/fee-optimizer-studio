import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("token/:mint", "routes/token.$mint.tsx"),
  route("api/me", "routes/api.me.ts"),
  route("api/token/:mint", "routes/api.token.$mint.ts"),
] satisfies RouteConfig;
