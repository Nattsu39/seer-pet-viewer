# Bundle 反向代理（Cloudflare Workers）

将 `newseer.61.com` 的 PetAnimPackage bundle 请求转发并添加 CORS 响应头，供静态部署的查看器在浏览器中远程加载资源。

其他平台代理见 `workers/` 目录下对应子项目。

## 部署

```bash
cd workers/bundle-proxy-cloudflare
pnpm install
pnpm deploy:cloudflare
```

或在仓库根目录：

```bash
pnpm deploy:proxy-cloudflare
```

可选：在 `wrangler.toml` 中设置 `ALLOWED_ORIGIN` 限制允许的前端来源。

## 端点

```
GET https://<worker-domain>/<32位hex hash>
```

仅接受 32 位小写十六进制 hash，对应 `pet-anim-index.json` 中的 `path` 字段。
