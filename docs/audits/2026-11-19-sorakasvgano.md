审计日期：2026-11-19。作者：SoraKasvgano（用户所指的 sorakasvgano）。范围为本地 Git 历史中该作者的全部 7 次提交，基线 `4f8f3f9`，当前 `HEAD = fa45a7c`。结论基于最终代码，已被后续提交修复的问题不重复列入。

原始审计发现 5 项 P1、9 项 P2。下列发现保留原始证据；用户要求继续实施后的修复状态、测试结果和部署边界见文末。此次修复没有连接实际邮箱或修改远程数据库。

| 提交 | 主要内容 |
| --- | --- |
| `bf0aa68` | 行业资讯抓取、配置和界面 |
| `ce0ec70` | 资讯抓取与分页加固 |
| `23f66c0` | 全局资讯配置与定时任务 |
| `e09fe67` | 本地邮件缓存、IMAP / SMTP |
| `10ca6f7` | 发信附件与本地已发送箱 |
| `88bf368` | 工单、SLA、邮件转工单 |
| `fa45a7c` | 最后成功抓取时间 |

**1. P1：本地邮件缓存没有按 CRM 用户隔离，切换登录账号会泄露邮件。**

位置：`src/lib/crm/email/local-db.ts:90,235,251`；`src/components/crm/email/EmailView.tsx:165,173`；`src/components/crm/layout/CrmTopbar.tsx:113`。引入：`e09fe67`，`10ca6f7` 扩大到已发送邮件和附件。

所有用户共用 IndexedDB 数据库 `oboya-email`，草稿和已发送箱直接调用不带账号过滤的 `listDrafts()` / `listSent()`。登出只退出 Supabase 并跳转，没有切换或清理这个数据库。A 在浏览器中保存草稿或发送带附件的邮件后，退出并让 B 登录，B 打开邮件模块即可读取 A 的这些本地内容；即使 B 没有配置邮箱，两个本地列表仍会加载。服务端 RLS 无法保护这些浏览器数据。

建议：数据库实例与 CRM 用户 ID 绑定，所有表、读取和删除操作都采用同一隔离方式；退出或身份切换时关闭旧实例并清空组件状态。为现有共用数据库设计清理或明确归属的迁移，不能直接把旧数据归给下一个登录者。补充同一浏览器 A → B 的隔离测试，覆盖正文、附件和“清空已发送”。

**2. P1：新模块迁移会覆盖管理员自定义权限，并可能恢复已经撤销的授权。**

位置：`supabase/migrations/20261116000800_crm_industry_news.sql:55`、`20261117010000_crm_email.sql:58`、`20261118000000_crm_cases.sql:56`。引入：`bf0aa68`、`e09fe67`、`88bf368`。

三份迁移都执行 `on conflict (id) do update set matrix = excluded.matrix`，用整个内置矩阵替换数据库中已有矩阵。若部署前管理员撤销过 sales_rep 的某项权限，或增加了自定义角色，迁移会恢复旧的内置授权并删除自定义角色的配置。这是升级现有安装时的权限回归。

建议：增量合并新模块的缺省授权，保留已有角色、已有模块及其显式授权；自定义角色的新模块默认拒绝。对“已有安装 + 自定义矩阵”执行升级测试。已经应用过的迁移不要改写，修正应通过新迁移实现。

**3. P1：工单迁移覆盖了新版数据库守卫，撤销已转换线索的只读保护。**

位置：`supabase/migrations/20261118000000_crm_cases.sql:291`；对照 `supabase/migrations/20261116000700_crm_v1_fixes.sql:103`。引入：`88bf368`。

工单迁移按较早的 000300 版本重建 `crm_record_guard()`，没有保留 000700 对已转换 Lead 的 `lead_converted` 检查。具备线索编辑权限的 authenticated 会话可以直接通过 Supabase 更新已经转换的线索普通字段；界面限制无法替代被删除的数据库保护。

建议：通过新迁移，在最新守卫上增加 case 引用检查，并恢复转换后的字段保护及原有软删除 / 恢复例外。补充按完整迁移顺序运行的 RLS 测试，断言更新已转换线索被拒绝。

**4. P1：IMAP 信封地址字段用错，正常邮件的发件人和收件人都会被丢弃。**

位置：`src/lib/crm/email/imap.ts:15,40`。引入：`e09fe67`。

当前代码读取 `mailbox` / `host` 拼接地址，但已安装的 ImapFlow 2.12.1 返回 `{ name, address }`，见其 `dist/cjs/types.d.ts:561`。实际字段经当前转换后变成空字符串并被过滤，导致发件人显示“—”、回复没有收件人、CRM 地址匹配失败；邮件转工单还会因为 `from` 为空而被邮箱校验拒绝。

已执行内存探针：`addresses([{name: 'Buyer', address: 'buyer@example.com'}])` 返回 `[]`。建议使用依赖导出的信封类型并直接读取 `address`，避免通过自定义宽松类型和强制转换掩盖接口不一致；加入真实返回结构的转换测试。

**5. P1：默认行业资讯配置不符合自己的校验规则，配置页面无法正常保存。**

位置：`src/lib/crm/industry-news/schemas.ts:8`；`src/lib/crm/industry-news/trendradar-preset.ts:136`；`src/app/api/crm/industry-news/config/route.ts:34`。引入：`23f66c0`。

默认预设把每组大型正则放入一个 `words[].text`，但 API 对这个字段统一限制为 120 字符。默认 13 条正则全部超限，长度分别为 301、264、249、403、304、148、231、172、264、251、653、444、520。管理员即使只修改来源或打开 AI，也会因保留这些预设而保存失败。

已执行 `industryNewsConfigSchema.safeParse(createDefaultConfig())`，返回 13 个 `too_big` 错误。建议区分普通关键词与正则的长度上限，或将预设拆成符合限制的表达式，并验证表达式可编译。补充“默认配置必须能通过保存校验”和配置保存流程测试。

**6. P2：收件附件的文件名字段也用错，邮件列表和阅读器都不会展示正常附件。**

位置：`src/lib/crm/email/imap.ts:50`。引入：`e09fe67`。

`attachmentMeta()` 要求 `current.filename` 存在，而 ImapFlow 的 MIME 结构把文件名放在 `dispositionParameters.filename` 或 `parameters.name`。普通附件因此被忽略，`hasAttachments` 为 false，界面没有下载按钮。

已用包含 `dispositionParameters: {filename: 'quote.pdf'}` 的真实接口结构执行探针，结果为 `[]`。建议读取 MIME 参数并正确解码文件名，补充混合正文、普通附件和内联附件的样本测试。

**7. P2：附件流尚未消费就退出 IMAP，会中断下载；响应长度也不可靠。**

位置：`src/lib/crm/email/imap.ts:108,253`；`src/app/api/crm/email/attachment/route.ts:40,48`。引入：`e09fe67`。

`fetchAttachment()` 在 `withImap()` 内返回未消费的流；后者在返回到路由之前就释放锁并 `await client.logout()`。ImapFlow 的下载通过流消费期间的多次分块 FETCH 完成，因此稍大的附件会在余下分块读取前失去连接。路由又把 `meta.expectedSize` 用作 HTTP `Content-Length`，但依赖的实现从 `response.size` 填入该值，并不能保证等于解码后的附件字节数，会造成长度不匹配。

内存替身验证到实际调用顺序为 `connect → release → logout → returned_to_route → consume`；未连接真实 IMAP。建议由流的结束、错误或取消统一负责释放连接，保持背压，并移除无法确定的 `Content-Length`。用超过 64 KiB、包含 base64 编码的附件验证完整字节内容及取消下载时的资源释放。

**8. P2：删除邮箱的应用操作与 RLS 冲突，软删除会被拒绝。**

位置：`src/lib/crm/email/account-repository.ts:105`；`supabase/migrations/20261117010000_crm_email.sql:120`。引入：`e09fe67`。

应用通过 UPDATE 将 `deleted_at` 设置为非空；UPDATE policy 的 `WITH CHECK` 却要求新行的 `deleted_at is null`。即使用户拥有 email.delete 权限，也不能执行这个软删除。SQL 中的 DELETE policy 不会应用于 UPDATE。

建议：通过检查 email.delete 权限和 owner 的专用软删除 RPC 完成操作，并保证普通编辑不能绕过删除权限。补充拥有删除权限、仅编辑权限以及其他 owner 的 RLS 测试。

**9. P2：工单没有加入通用对象表映射，删除和恢复操作不可用。**

位置：`supabase/migrations/20261118000000_crm_cases.sql` 的共享 helper 扩展部分；`supabase/migrations/20261116000600_crm_functions.sql:101`；`src/lib/crm/repositories/object-repository.ts:398`。引入：`88bf368`。

界面的工单删除调用通用 `crm_soft_delete('case', id)`，但 `crm_object_table()` 只支持原有五种对象，没有 `case → crm_cases`。RPC 必定抛出 `Unknown object`（22023），`crm_restore` 也有相同问题。

建议：新增迁移扩展对象映射，并验证工单创建、删除、管理员恢复及无权限用户拒绝路径。仅检查迁移文件含有 RLS 字样的测试覆盖不到这个缺口。

**10. P2：工单关联活动只放开了列约束，没有更新实际存在性检查。**

位置：`supabase/migrations/20261118000000_crm_cases.sql:387`；`supabase/migrations/20261116000300_crm_objects.sql:438`。引入：`88bf368`。

迁移允许 `crm_activities.what_object = 'case'`，但 `crm_activity_rules()` 的父记录检查仍只处理 lead、account、contact、opportunity。新建关联工单的活动会走 `else false` 并抛出 `Related record not found`（23503）；即使工单归当前用户所有也会失败。

建议：新迁移同时扩展触发器函数，保留其他对象规则；补充从工单详情创建活动并读回时间线的集成测试。

**11. P2：邮件转工单按单封邮件 ID 去重，不能识别同一会话中的回复。**

位置：`src/components/crm/email/EmailView.tsx:333`；`src/app/api/crm/cases/from-email/route.ts:36`；`src/lib/crm/email/types.ts` 的 `MailHeader`。引入：`88bf368`。

接口注释要求同一会话的回复更新既有工单，但客户端只提交当前邮件的 Message-ID，服务端只按 `source_message_id` 等值查找。回复通常具有新的 Message-ID，关联关系在 In-Reply-To / References 中；这些字段未被同步和传递。因此将原邮件和回复分别转为工单会产生两张单。

建议：同步并传递会话引用，按可见的原始消息或引用链查找已有工单，明确重新打开已解决工单的规则，并保留会话历史。补充“原邮件 → 回复 → 再次请求”的去重与并发测试。

**12. P2：所有资讯源失败仍更新“最后成功抓取时间”，界面也提示成功。**

位置：`src/lib/crm/industry-news/server.ts:209,263`；`supabase/migrations/20261119000000_crm_industry_news_last_fetched.sql:174`；`src/components/crm/insights/IndustryNewsView.tsx:170`。引入：`fa45a7c`，失败提示缺口也存在于前面的抓取流程。

抓取器把失败收集到 `errors`，不会抛出整个任务；`ingestNews()` 无条件调用 ingest RPC，RPC 又无条件更新时间。界面没有展示 `response.errors`，只给成功 toast。全部来源超时或不可用时，旧资讯也会显示刚刚“成功更新”，掩盖定时任务故障。

已用所有来源失败的 fetch 替身验证：`fetched = 0` 且 `errors.length = 1`，仍调用 `crm_industry_news_ingest` 并返回新的 `lastFetchedAt`。建议记录尝试时间与成功时间，只有确有来源成功时更新后者；部分失败和全部失败应在界面、cron 返回值及日志中明确区分。成功但零命中不应当作失败。

**13. P2：现有 E2E 断言与后来改成的只读权限相矛盾。**

位置：`e2e/smoke.spec.ts:80`；`src/components/crm/insights/IndustryNewsView.tsx:235`；`src/lib/crm/industry-news/permissions.ts:8`。原断言引入：`bf0aa68`；后续行为变化：`23f66c0`。

smoke 使用 demo sales_rep 登录，却要求看到 Configuration 标签；新界面只有 super_admin 才渲染这个标签。在数据与登录正常的环境下，该断言也无法成立。当前单元测试通过不能代表仓库要求的 E2E 验证通过。

建议：sales_rep 断言 Configuration 不存在且资讯可读；另加管理员场景验证配置保存、抓取和错误提示。邮件与工单也需要实际流程覆盖，不能仅检查路由源文件是否包含 `crmGuard`。

**14. P2：快速切换邮件时，较早请求的正文可能覆盖当前选中的邮件。**

位置：`src/components/crm/email/EmailView.tsx:250`。引入：`e09fe67`，`88bf368` 使错误正文可能被保存到工单。

`selectHeader()` 先选择邮件，再异步读取缓存、正文和 CRM 匹配；各阶段完成后都直接更新共享状态，没有检查选中 ID 或请求版本。先点 A，再点 B，若 A 的请求最后返回，就会出现 B 的标题搭配 A 的正文或客户匹配。此时转工单会使用 B 的消息 ID 和 A 的正文，回复引用也可能取到错误内容。

建议：使用递增请求标识或当前邮件 ID 校验，每次状态提交都确认请求仍属于当前选择；切换账号或文件夹时同步清除选择。补充可控制异步完成顺序的交互测试。

**审计时发现的补充项（以下实施状态已全部补齐）**

- 工单最近浏览：`crm_recent_views.object` 的 CHECK（`20261116000300_crm_objects.sql:477`）未加入 case，`markViewed()` 写入会失败但被吞掉，最近浏览筛选无法包含工单。需要扩展该约束。此约束属于最近浏览表，审计表 `crm_audit_logs.object` 没有这个 CHECK。
- 工单可见性一致性：cases SELECT policy 允许通过父账户 / 联系人查看，但新增 `crm_can_see_record('case', ...)` 只检查 owner。通过父级获准查看的工单，其活动和审计可能仍被拒绝；应统一权限判断，并加入跨 owner 的父级可见测试。
- 品牌与翻译：`email/schemas.ts:18` 默认 `#2563eb`，账户颜色接受任意 HEX；`EmailList.tsx` 使用 `text-amber-500`，没有遵循 Oboya 色板。默认英文邮件模板和日期 / 时长格式也应结合四种语言复核。
- 凭据审计脱敏：邮箱表使用通用审计触发器，`password_encrypted` 会进入历史 diff。虽然内容是密文，仍建议从审计中排除此字段，避免邮箱删除或密码轮换后继续保留不必要的凭据副本。

**只读审计阶段的验证结果与边界（修复后结果见文末）**

| 检查 | 结果 |
| --- | --- |
| `npm.cmd run lint` | 通过 |
| `npm.cmd run i18n:check` | 通过，4 个 locale 与 en 键结构一致 |
| `npm.cmd test` | 通过，21 个文件、223 项测试；沙箱外重跑解决了 esbuild 读取父目录的权限限制 |
| `npm.cmd run build` | 通过，包含 TypeScript 检查 |
| 内存探针 | 复现默认配置校验失败、IMAP 地址 / 附件丢失、附件流提前退出、全部资讯源失败仍推进成功时间 |
| E2E / RLS / 实际邮箱 | 未运行；现有 E2E 会操作真实 Supabase 项目，本次只读审计未使用项目凭据或进行远程写入；SQL 结论来自完整迁移与调用链追踪，尚未在测试数据库执行 |

建议修正时优先增加真实行为验证：用户切换隔离、已有数据库升级、完整迁移后的 Lead 保护、工单删除及活动，以及真实 ImapFlow 数据结构和较大附件。当前若干测试只搜索 SQL / 路由源码中的字符串，不能证明这些操作实际成功。

**实施后的修复状态（2026-11-19）**

| 项目 | 修复与验证 |
| --- | --- |
| 1：邮件跨用户泄露 | IndexedDB 按 CRM 用户 UUID 命名；所有异步任务传递不可变的用户数据库句柄；登出/身份变化关闭旧句柄并卸载旧界面。浏览器实测九张表隔离、清空不影响另一用户、身份切换移除旧内容、旧句柄拒绝延迟写入。无法证明归属的旧共用库隔离，不自动导入当前用户。 |
| 2：权限被迁移覆盖 | 新增 `20261116000750_crm_preserve_module_permissions.sql`，在原有模块迁移之前将种子写入适配为只添加当次新模块；保留现有角色、已有单元和显式拒绝，不恢复被删除角色。尾部修复迁移移除临时适配器，留下供未来迁移使用的增量 helper。完整 PostgreSQL 迁移测试覆盖自定义角色、撤销授权及后续模块不得重新添加已删除 email 单元。**旧库必须按部署文档使用 `--include-all`；已发生的历史权限损失仍需核对审计快照恢复。** |
| 3：已转换线索保护 | 新增迁移恢复 000700 守卫，并保留 case 引用检查；authenticated 普通用户及管理员均不能修改已转换线索，软删除/管理员恢复例外通过真实 SQL 测试。 |
| 4：IMAP 地址 | 使用 ImapFlow 导出的类型和 `address` 字段；真实依赖返回结构回归测试通过。 |
| 5：默认资讯配置 | 区分普通词 120 字符与正则 2000 字符上限，保存时使用与匹配器相同的语法编译；默认预设及仅修改 AI/来源的配置均通过保存校验。 |
| 6、7：附件元数据与流 | 修正 MIME 文件名字段；IMAP 连接保留到流结束/错误/取消，HTTP 使用背压且不伪造长度。超过 150 KB 分块附件及取消清理测试通过；本地附件经浏览器下载后逐字节验证。 |
| 8：邮箱删除 | 新增显式校验用户、owner、写权限和 email.delete 的软删除 RPC，保留 UPDATE RLS 并撤销客户端硬删除；本人删除、其他 owner、只有 edit 的拒绝路径均通过 PostgreSQL 测试。 |
| 9、10：工单删除/恢复和活动 | 补齐 case 对象映射、活动父记录校验及最近浏览约束；统一 helper 与 SELECT 的父级可见性。活动审计采用活动自身 SELECT RLS 并保留 audit_logs.view 门槛，不扩大他人活动删除权限。真实 SQL 覆盖跨 owner 账户/联系人两条路径、活动与审计读取、最近浏览筛选、隐藏记录拒绝、审计权限撤销、删除/恢复。 |
| 11：回复转工单重复 | 同步/缓存/传递 In-Reply-To 与 References；新增 `crm_case_from_email` 原子 invoker RPC，排序获取事务锁，按可见引用链查找。新回复追加历史并设为 working；重复请求不追加或重开；回复先于原邮件也复用同一工单。父级可见但不可写时拒绝更新；不可见的其他 owner 工单不泄露、不阻塞自己的创建。描述表单与 RPC 总上限一致。 |
| 12：资讯失败虚报成功 | 全部源失败/无启用来源时不调用 ingest RPC、不推进成功时间；成功但无命中仍可更新成功时间；部分失败单独提示，cron 全部失败返回 502。四语言提示已补齐，服务器行为测试通过。 |
| 13：E2E 权限断言 | 修正 sales_rep 的 Configuration 标签断言为不存在。真实项目的登录/写入 E2E 尚未执行；离线浏览器覆盖邮件组件流程。 |
| 14：正文请求乱序 | 使用选择请求版本与账号/文件夹切换清理；过期请求不能覆盖正文或 CRM 匹配。浏览器控制请求返回顺序，验证后返回的旧邮件不会覆盖当前阅读器。 |

额外完成：已发送和本地已发送合为一个 Sent 文件夹，按邮箱账号 + Message-ID 去重，保留真实服务器 UID 和本地正文/附件；清理副本只作用于当前账号/客户过滤。标题从原始 Subject 字节按 MIME 声明解码，兼容 UTF-8、真实 GBK/GB18030，以及 UTF-8 被错误标注为 GBK 的邮件；旧缓存会刷新。用户样例对应的原始字节场景已加入测试，若发件方已将乱码与替换字符永久写进标题，原始信息丢失的部分无法保证恢复。

邮箱颜色统一为品牌色板，前端输入、默认值、数据库约束及历史颜色均已处理；星标使用品牌黄。默认邮件模板补齐英、葡、西、中四种语言，旧版未修改的英文种子在内存中换为当前语言，自定义模板、已修改内置模板及草稿保留原文。邮件列表/阅读器和资讯抓取日期使用 CRM 语言及现有 UTC 时区，工单时长使用本地化单位；浏览器检查刻意设置不同的浏览器语言和时区，验证仍遵循 CRM 配置。

新的凭据审计使用掩码并保留密码轮换事件；新增 `20261119030000_crm_visibility_and_credential_audit.sql` 同时清理历史邮箱审计中的凭据密文，仅替换该 diff 字段，保留事件 ID、操作人、时间及其他 diff。SQL 测试覆盖创建/轮换/删除、已有掩码、畸形值、其他对象不受影响及重复执行不改行；备份、导出副本不在此次表内迁移范围。安全复核通过，活动审计的父级可见性没有扩大删除权限。

未新增生产依赖；新增开发依赖 `@electric-sql/pglite`，用于在本地内存 PostgreSQL 执行完整迁移和角色/RLS行为测试。

**最终验证与剩余部署工作**

- `npm.cmd run lint`、`npm.cmd run i18n:check`、`npm.cmd test`、`npm.cmd run build`：通过；27 个测试文件、280 项测试，其中 21 项执行完整迁移后的 PostgreSQL 行为。
- `npm.cmd run test:email:offline`：通过；使用真实邮件组件、真实浏览器 IndexedDB、构建产出的 CSS 和本地模拟 HTTP，覆盖去重、附件字节、标题刷新、乱序响应、账号/用户隔离、旧句柄，以及四语言模板/日期/时长和 375px 布局。
- 数据库迁移只在 PGlite 内存数据库中执行；线上 Supabase 尚未应用这四份新迁移（000750、19010000、19020000、19030000）。部署顺序与历史权限恢复说明见 `docs/SUPABASE.md`。
- 未执行真实邮箱、真实项目 E2E / RLS 或两独立数据库会话的并发压力测试；离线验证不能替代这些上线前验证。
