import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("token/:mint", "routes/token.$mint.tsx"),
  route("token/:mint/simulate", "routes/token.$mint.simulate.tsx"),
  route("api/me", "routes/api.me.ts"),
  route("api/token/:mint", "routes/api.token.$mint.ts"),
  route("api/apply-split/build", "routes/api.apply-split.build.ts"),
  route("api/apply-split/submit", "routes/api.apply-split.submit.ts"),
] satisfies RouteConfig;
