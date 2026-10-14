# CookPilot

手机端 AI 烹饪助手，React + TypeScript + Vite，数据保存在浏览器 IndexedDB。根目录是正式应用；`demo.html` 与 `archive/demo/` 保留为原型参考。

## 启动

需要 Node.js 22.12+（本次使用 Node.js 24）和 npm。

```powershell
npm ci
npm run dev
```

打开 [http://localhost:5173](http://localhost:5173)。开发服务支持局域网访问，终端会打印本机地址；手机和电脑在同一网络时可用该地址试用。HTTP 局域网地址不提供 PWA 安装，正式安装需 HTTPS。

本机已配置 DeepSeek Flash，模型名称为 `deepseek-flash`。私密配置位于被 Git 忽略的 `.local/model.json`，开发服务器仅向本机回环地址提供一次初始化；已存在的用户模型配置优先。删除模型或清空数据后不会重新添加它。

从其他电脑拉取代码、从手机访问局域网地址，或运行正式构建时，在「我的厨房 → 添加模型」填写接口地址、自己的 API Key 和模型名称。支持兼容 Chat Completions 的 HTTPS 接口，地址可填根路径、`/v1` 或完整 `/chat/completions`。接口必须允许浏览器跨域；失败会显示真实错误。

截至 2026-10-13，按 [DeepSeek 官方模型说明](https://api-docs.deepseek.com/quick_start/pricing/) 提供 Flash（`deepseek-flash`，对应 V4.1-Flash）和 V4 Pro（`deepseek-v4-pro`）两种快速配置，接口均为 `https://api.deepseek.com`。默认使用 Flash；按照 [思考模式说明](https://api-docs.deepseek.com/guides/thinking_mode/)，交互请求显式发送 `thinking: { type: 'disabled' }`，推荐、生成与问答启用 JSON Output，并保留各自输出预算。官方 JSON 模式只保证合法 JSON，应用仍校验字段、用量与引用；常见难度“容易 / 中等 / 困难”统一为“简单 / 适中 / 有点挑战”。

官方已于 2026-07-24 [停用 `deepseek-chat` 与 `deepseek-reasoner`](https://api-docs.deepseek.com/news/news260424/)。启动时移除指向官方接口的这两种旧配置及对应凭据，当前选中项自动切换至剩余配置；旧 Demo 迁移也会跳过它们。旧 Flash 别名统一为 `deepseek-flash`，原 API Key 保留。第三方兼容服务的模型名由其服务决定。

## 首版功能

- 自然语言对话与候选推荐，选中一道才生成完整指南；结构和用量检查通过后原子保存。
- AI 菜谱、独立制作记录、再次制作、删除、已知别名复用与忌口冲突提示。
- 200 道本地菜谱，支持搜索和分类，点选即可使用，无需模型或联网。
- 准备卡和逐步烹饪卡、滑动、步骤目录、查看位置与备菜勾选恢复。
- 制作记录独立心得、多计时、暂停和继续、跨页入口、按截止时间恢复。
- 当前制作 AI 问答；确认实际进度后提出流程调整，用户确认才保存新版本。版本历史保留，其他制作不受影响。
- 通用偏好、多模型增删改测切换、30 天对话历史、全局搜索、脱敏 JSON 导出与确认清空。
- PWA 应用资源与本地内容离线可用；AI 始终需要网络。更新不会主动刷新做菜页面。
- 同一来源可读取的旧 Demo 数据支持备份后事务迁移。

食材数字用量由统一数据渲染，调整后动作与用量表同步。翻卡、计时结束、备菜勾选和保存心得均不推断烹饪步骤已经完成。AI 调整所需的实际进度在问答中明确确认。

预置资料保留原编号、来源、原文和内容版本；原资料尚未逐道实做。预置和旧 Demo 保留原文中的用量，首版不支持直接改变这类指南的食材总量，可使用问答获取操作建议。AI 新生成指南支持经过校验的结构化用量调整；涉及已使用材料或新增材料/步骤时，会保守拒绝并提示重新确认。

## 构建、验证和发布

```powershell
npm test                 # 业务、适配器和迁移；不消耗模型 Token
npm run test:e2e          # 浏览器流程和手机尺寸；拦截模型请求
npm run build            # TypeScript + 正式静态构建 + PWA
npm run test:pwa          # 正式构建离线恢复；先执行 build
npm run test:perf         # 先启动 dev；隔离浏览器内的大数据性能采样，不调用模型
npm run check:secrets     # 检查源码与构建产物不包含本机 Key
npm run format:check
npm run preview          # http://localhost:4173
```

性能检查范围、修复与采样结果见 [性能检查与修复](docs/性能检查与修复.md)。

浏览器测试使用本机 Google Chrome。`dist/` 可部署到稳定的 HTTPS 来源，所有静态资源需要保留；Hash 路由不需要后端页面路由。默认部署到站点根路径，子目录部署时在构建前设置 `VITE_BASE_PATH`（含前后 `/`，例如 `/cookPilot/`）；页面资源与 PWA 都使用该路径。正式部署中不存在本地 Key 初始化接口，发布产物不包含开发配置。

### GitHub Pages

在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。推送到 `main` 后，`.github/workflows/deploy-pages.yml` 自动安装依赖、按 Pages 路径构建，只上传并部署 `dist/`。也可以在 Actions 中手动运行 **Deploy to GitHub Pages**。

工作流会先检查发布来源；仍为分支发布时直接报错，防止两套发布流程互相覆盖。部署后还会用浏览器访问线上地址，确认首页渲染、JS/CSS/字体加载和 PWA 路径正确，才算整个工作流成功。如果看到 `/src/main.tsx` 404，先检查 Source 是否被改回了 **Deploy from a branch**；修正后重新运行上述工作流。

本站地址为 https://yangxl12.github.io/cookPilot/ 。不要将仓库根目录作为静态站点直接发布：根目录 `index.html` 的 `/src/main.tsx` 是 Vite 开发入口，需要构建后才会替换成浏览器可运行的 JavaScript。

本地复现 Pages 子路径（PowerShell）：

```powershell
$env:VITE_BASE_PATH = '/cookPilot/'
npm run build
npm run test:pwa
npm run preview          # http://localhost:4173/cookPilot/
# 完成后执行 Remove-Item Env:VITE_BASE_PATH 恢复根路径构建
```

生成前会在本地消解备菜依赖、补齐已分配食材的零比例引用及遗漏的用量占位符；不更改食材总量或推测缺失的正比例分配。重复分配、未知引用、错误步骤依赖、明确用量、忌口与锅具冲突仍须通过严格校验。模型收到的分配错误包含当前总和与分配位置，菜名也在保存前纳入自动修复。

`npm run test:live` **会调用真实模型**，仅手动按需执行，需要先启动开发服务并准备本机私密配置。一次流程包含连接、推荐、一道完整生成、问答和一次调整；完整生成最多追加两次内容修复，网络、超时、认证等请求错误不自动重试。结果写入 `.local/`，不纳入 Git。普通测试不会消耗真实模型用量。

`npm run recipes:build` 从 `docs/中外经典家常菜200道.md` 重建结构化资源，不调用模型。来源原文中的混合、定性用量会保留，不编造精确分配。自动验证保证结构、引用和来源完整，不能代替逐道实做。

## 数据与凭据

菜谱版本是不可变快照，制作记录单独引用版本；再次制作不会重新生成。生成任务幂等，事务内二次查重；取消任务不能再提交结果。保存失败会保留当前生成结果或编辑草稿，可重试。

Key 与业务实体分表保存，仅在请求时读取；不进入提示词、普通日志、JSON 导出或静态包。浏览器存储不等于系统密钥库。当前没有账户和跨设备同步，浏览器清理数据可能导致丢失，请定期导出。JSON 导出尚不提供导入界面。

旧 Demo 迁移只适用于同一来源能读取到 `cookpilot.demo.v1` 的情况。先原样备份至 `cookpilot.legacy.backup`，失败保留原文并回滚，不重置为示例数据；明确清空时连同旧备份与凭据一起清除。文件方式打开的 Demo、不同端口和不同域名之间不能自动迁移。

## 工程目录

```text
src/app/                  初始化、路由和应用上下文
src/features/             首页、菜谱、制作和设置页面
src/domain/               实体、schema、身份、用量与版本规则
src/services/ai/           fetch 适配、提示词、解析和校验
src/storage/              Dexie 数据库、事务业务、迁移与导出
src/shared/               弹层和沿用 Demo 参数的样式
src/assets/recipes/       200 道结构化本地资料
tests/unit/               业务、适配器与迁移测试
tests/e2e/                浏览器流程与布局
tests/pwa/                正式构建离线验证
tests/fixtures/           脱敏真实生成样本
scripts/                  内容转换、显式真实接口验证、凭据检查
public/fonts/             本地 DM Sans 与 SIL 字体许可
```

依据：[最终开发说明](docs/CookPilot最终开发说明.md)、[正式开发实施方案](docs/CookPilot正式开发实施方案.md)、[首版开发与验收记录](docs/首版开发与验收记录.md)。
