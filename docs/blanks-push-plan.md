# Blanks 订单按 vendor 推送多供应商 — 实施计划 / TODO

> 状态：**方案已定，待开工**。本文件是可执行的实施清单，含已锁定的决策、供应商 API 规格摘要、环境变量、待补信息。
> 关联代码参考：现有 `src/lib/factory/client.ts`（linmiao）、`src/app/api/orders/[id]/push-factory/route.ts`、`src/components/orders/push-factory-dialog.tsx`。

## 背景 / 目标

一个订单可能包含多个 blank 产品（`OrderItem.itemType === "other"`），不同 blank 可能属于不同供应商，需要按产品的 **Shopify vendor** 路由到对应供应商的 API 下单。目前手上有两个供应商 API，够用；后续 riin 一套可挂多个供应商。

## 已锁定的决策

1. **vendor→供应商映射**：用**数据库表 + 管理界面**维护（可增删改）。
2. **blank 判定**：复用现有 `itemType === "other"`。
3. **推送 UX**：**一个弹窗**，按供应商自动分组，分别推送到各自 API。
4. **与现有 push-factory(linmiao) 的关系**：**统一**——linmiao 也作为 Supplier 注册表里的一条；现有 push-factory 收编/改造进新流程。
5. **工艺**：目前全是白板，**craftType 默认 1（白墨烫画）**，UI 不需要突出选择（保留可改）。
6. **是否打印**：每个 item 有"打印/不打印"开关，**默认不打印**（纯白板）。不打印时不传打印图/printPosition（见"待确认"#4：imageList 接口标必填，纯白板怎么传需与 riin 确认）。
7. **推送模式**：两种——**仅 placeOrder（建单不推送）** 和 **placeOrder + pushOrder（建单并推送工厂）**，弹窗里可选；已建单未推送的订单可后续单独 push。
8. **状态同步**：**自动轮询 `queryOrderStatus`** 回写本地（重点捕捉"反审回电商"），订单列表/详情/新菜单页展示状态徽章；另提供手动刷新。
9. **入口**：**两处**——现有 order list / order detail 的推送按钮 + **新增一个专门菜单页**（只列含 blank 即需推工厂的订单），两处都能推。

## 核心洞察

linmiao 和 riin(JJSPROMO) 是**同一种 POD T 恤系统协议**：`secretKey` header + `sign = md5(body + "::" + secretKey)`、`platformType:15`、`goodsList` 含 `sizeCode/sizeName/colorCode/colorName/styleCode/styleName/craftType(1=白墨烫画,2=白墨直喷)/num`、`imageList` type1=打印图/type2=效果图、响应 `{successful,message,errorCode,data}`。
差异只在**端点路径**和**字段结构**：

| | riin（JJSPROMO） | 现有 factory（linmiao） |
|---|---|---|
| 下单端点 | `/trade/api/interface/placeOrder` | `trade/v1/openapi/create-order` |
| 收货人 | 扁平字段 `consigneeName/phone/receiverCountry/receiverProvince/receiverCity...` | 嵌套 `consignee{}` |
| 订单号字段 | `platformOid` / `platformOllId` | `pfOrderId` / `pfSubOrderId` |

因此抽象 `SupplierAdapter` 接口，两家各写一个实现；UI 与 SkuMapping 缓存基本复用现有 push-factory。

---

## 实施 Phase（TODO）

### Phase 1 — 数据层（Prisma schema + 迁移 + seed）✅ 完成（branch agent/blanks-push）
- [x] 新增 `Supplier` 表：`key`(唯一)、`name`、`adapterType`("linmiao"|"riin")、`baseUrl?`、`secretKeyEnv`(**存环境变量名，密钥不落库**)、`platformType?`(默认15)、`enabled`(默认true)。
  - 一个 `adapterType="riin"` 挂多条 Supplier，**各自 secretKey 不同**（已确认的 riin 系工厂：**jjspromo、xinfeiyang**，后续还可能加）；baseUrl 都是 riin 的（同一系统）。
- [x] 新增 `VendorMapping` 表：`vendor`(唯一, Shopify vendor 规范化) → `supplierId`(FK Supplier)。
- [x] `OrderItem` 增字段：`vendor String?`；推送状态 `supplierId?`、`supplierPushedAt?`、`supplierOrderNo?`、`supplierTraceId?`；`printEnabled Boolean @default(false)`。
- [x] `SupplierPush` 表（含 `itemIds`、`requestPayload`、`traceId`）。
- [x] `SkuMapping` 增 `supplierId`(可空，null=历史行)，复合唯一改为 `ourSku + variantTitle + supplierId`；seed 里把历史行回填到 linmiao；旧 push-factory 路由的 upsert 改为 supplier 感知的 findFirst+update/create。
- [x] 迁移 SQL `20260808000000_blanks_suppliers` + seed 写入 linmiao、jjspromo、xinfeiyang 三条 Supplier。

### Phase 2 — vendor 采集 ✅ 完成
- [x] `src/lib/shopify/types.ts`：`ShopifyLineItem.vendor?`、`MappedOrderItem.vendor`。
- [x] `src/lib/shopify/orders.ts` mapper：`vendor: lineItem.vendor || null`。
- [x] OrderItem 写入点补 vendor：`webhooks.ts` 两处 upsert + `api/orders/sync/route.ts`（create 走 `...item` 展开自动带上，update 子句显式加）。
- [x] 回填脚本 `scripts/backfill-item-vendor.mjs`（幂等，只填 vendor 为 null 的行；**部署后需手动跑一次**）。

### Phase 3 — 对接层（`src/lib/suppliers/`）✅ 完成
- [x] `types.ts`：`SupplierAdapter`（placeOrder/pushToFactory/queryStatus）+ `SupplierOrderInput`/`SupplierOrderResult`/`SupplierOrderStatus`；riin 状态枚举、终态列表、`REJECTED_ORDER_STATUS=3`、`normalizeVendor`、`formatOrderTime`。
- [x] `linmiao.ts`：`buildLinmiaoCreateOrderParams`（纯函数可测）+ `LinmiaoAdapter` 包现有 `factory/client.ts`；不打印沿用 `[不打印]` 标记惯例；linmiao 无二段推送（place 即 pushed）。
- [x] `riin-client.ts`：按实例持 key 的 raw client（placeOrder/pushOrder/queryOrderStatus/queryOrderDelivery/closeOrder/query 基础数据）。
- [x] `riin.ts`：`buildRiinPlaceOrderParams` + `RiinAdapter`；place 后可选 pushOrder，push 失败不算 place 失败（返回 pushError 可重推）；不打印时只传效果图。
- [x] `registry.ts`：按 adapterType 实例化，riin 的 secretKey 从 `supplier.secretKeyEnv` 指向的环境变量读。
- [x] vitest：签名、时间格式、riin/linmiao payload 映射、子单号序号、图片 code 唯一性（10 个用例）。

### Phase 4 — API 路由 ✅ 完成
- [x] 核心逻辑集中在 `src/lib/suppliers/push-service.ts`（复用原则）：`pushBlanksForOrder`（分组/建单/推送/落库）、`pushPlacedSupplierPush`、`syncSupplierStatuses`、`resolveSupplierGroups`、`buildSupplierConsignee`。
- [x] `POST /api/orders/[id]/push-blanks`：mode place|place_and_push；服务端重算路由；部分成功 200 + 各组状态；全败 502。
- [x] `GET /api/orders/[id]/blanks`：推送弹窗唯一数据源（items+vendor+解析供应商+按供应商 SkuMapping 预填+已有 pushes）。
- [x] `POST /api/supplier-pushes/[id]/push`：单独 pushOrder，失败写 lastError。
- [x] `POST /api/supplier-pushes/sync-status`（登录态，支持 orderId 单单刷新）+ `GET|POST /api/cron/sync-supplier-status`（CRON_SECRET bearer，沿用 scan-exceptions 模式；**Render Cron Job 定时调**）。状态变为 3(反审回电商) 时写 OrderLog `blanks_rejected`。
- [x] `GET /api/blanks-orders`：分页 + q 搜索 + filter(all/unpushed/placed/pushed/rejected)。
- [x] `GET/POST /api/suppliers`（含 secretConfigured 检查，不回传密钥）、`PATCH/DELETE /api/suppliers/[id]`（有推送记录只能停用不能删）。
- [x] `GET/POST /api/vendor-mappings`（GET 附 unmappedVendors 提示）、`DELETE /api/vendor-mappings/[id]`。

### Phase 5 — UI

> **复用原则（用户明确要求）**：推送功能只实现一份，所有入口共享，不散开做。
> - `src/components/blanks/push-blanks-dialog.tsx` —— 唯一的推送弹窗，order list、order detail、新菜单页三处都打开这同一个组件（只传 orderId）。
> - `src/components/blanks/supplier-push-status-badge.tsx` —— 唯一的状态徽章，三处列表/详情共用。
> - `src/components/blanks/use-push-blanks.ts`（或 lib）—— 推送/单独 push/刷新状态的请求逻辑集中一处，弹窗和行操作按钮都调它。
> - 表单行组件尽量复用现有 push-factory-dialog 里的字段行；能改造复用的现有 component 一律复用，不新写。

- [x] `src/components/blanks/push-blanks-dialog.tsx`（**全局唯一推送弹窗**，只收 orderId 自取数据）：按供应商分组、SkuMapping 预填、工艺默认白墨烫画、打印开关默认关、**仅建单 / 建单并推送**两个动作、未映射 vendor 高亮 + 链到设置页、已建单 item 禁选、组内结果展示（含 pushError）、已有推送记录区（badge + 单独推送 + 刷新状态）。
- [x] `supplier-push-status-badge.tsx`（唯一状态徽章：反审回红色、已发货绿色、已建单未推送琥珀色）+ `use-push-blanks.ts`（唯一请求逻辑：useBlanksData/pushBlanks/rePush/refreshStatus）。
- [x] **新菜单页 `/blanks`**（sidebar+header 入口，i18n key nav.blanks）：搜索 + filter(全部/未推送/已建单未推送/已推送/被反审)、items/vendor/打印徽章、每供应商状态徽章、行操作（共享弹窗/单独推送/刷新全部状态）、分页；`/blanks/settings` 供应商 & vendor 映射管理（含未映射 vendor 提示一键填入、密钥环境变量已配置检查）。
- [x] 订单入口：order detail 按钮换成"推 Blanks"+ 状态徽章（共享 hook/badge）；order list items 列的 Blanks 徽章可点击打开**同一个共享弹窗**。
- [x] i18n：nav.blanks（en/zh）；页面文案与现有代码风格一致采用中英混排。

### Phase 6 — 测试 & 清理
- [x] vitest：adapter 映射、md5 签名、时间格式、图片规则（`src/__tests__/suppliers.test.ts`）。
- [ ] **待用户线上验证无误后**：删除旧 `push-factory` 路由 + `push-factory-dialog.tsx`（已无 UI 引用，仅路由保留兜底）。

### 上线 checklist（代码之外）
1. Render 环境变量：`RIIN_API_URL`、`RIIN_JJSPROMO_SECRET_KEY`、`RIIN_XINFEIYANG_SECRET_KEY`、`CRON_SECRET`（如未设）。
2. 部署后跑一次 `npx prisma db seed`（写入 3 条 Supplier + 回填历史 SkuMapping 到 linmiao）。
3. 跑一次 `node scripts/backfill-item-vendor.mjs`（回填历史订单 item 的 vendor）。
4. 在 `/blanks/settings` 配置 vendor→供应商映射。
5. ~~Render Cron Job~~ → **已改为应用内置定时**（`src/instrumentation.ts`）：服务启动后每 2 小时自动同步（可用 `SUPPLIER_STATUS_SYNC_INTERVAL_MINUTES` 调整、`SUPPLIER_STATUS_SYNC_DISABLED=1` 关闭）；终态（已发货/已关闭/已退款）自动跳过，重点捕捉反审。`/api/cron/sync-supplier-status`（CRON_SECRET）保留作为外部触发备用。
6. 和 riin 确认纯白板不打印时 imageList 的正确传法（当前实现：只传效果图）。

---

## riin API 规格摘要（来自 T恤第三方接口-20250819.pdf）

- 测试：`https://tshirt-test.riin.com/`  生产：`https://tshirt.riin.com/`
- 每接口限流 10 次/秒；`sign = md5(请求报文 + "::" + secretKey)`，按请求参数字段顺序生成 sign。
- header：`secretKey`、`sign`。响应统一 `{successful, message, errorCode, data}`。

**端点**（全部 POST，路径前缀 `/trade/api/interface/`）
- 下单 `placeOrder` —— **注意：下单后订单仅处于"待推送"，须再调 `pushOrder` 才真正推到工厂**
- **推送订单 `pushOrder`**（body `{platformOidList:[]}` ≤100，仅支持"待推送/反审回电商"状态；响应 `data:{total,failed,succeeded,errMessages:[{key:单号,value:原因}]}`，`data=null` 表示全部成功。失败原因示例："产品编码未设置适配工艺"）
- 改单 `updateOrder`（仅待推送/反审回可改；支持加商品，不支持删商品）
- 修改订单图片 `updatePrintImage`（body `{platformOid, goodsList:[{platformOid,platformOllId,imageList}]}`，仅待推送/反审回可改；**imageCode 相同会复用素材库旧图，改图必须换新 imageCode**）
- 关闭订单 `closeOrder`（body `{platformOid}`）
- 预发货 `preShipped`（body `{platformOid}`）
- 查面单 `queryOrderDelivery`（body `{platformOidList:[]}` ≤100，返回 `trackingNumber/waybillDataPath/shippingTime`）
- 查订单状态 `queryOrderStatus`（返回 `orderStatus`(1 店铺审核中/2 店铺推送中(待推送)/3 反审回电商/4 工厂审核/5 生产中/12 已发货/13 已关闭/14 退款中/15 已退款) + `childOrderStatus[]`(NOT_SHIPPED/SHIPPED/CLOSE/CANCEL/COMPLETE)）
- 查订单详情 `queryOrderInfo`（body `{platformOidList:[]}` ≤100，返回收件人/物流/preShippingTime/shippingTime/addressId 等）
- 查产品/款号/颜色/尺码 `queryProduct` / `queryStyle` / `queryColor` / `querySize`（分页 `{pageIndex,pageSize}` 默认 1/1000；`queryStyle` 返回每款适配 `craftType`（如 "1,2"）可做工艺校验；`queryProduct` 返回 productCode=款-色-码 组合及重量尺寸）
- 查工厂发货地址 `queryShipAddress`（无 body）/ `queryProductShipAddress`（body `{productCodeList:[]}` ≤10）——自带面单时 `addressId` 从这里取
- 已发货订单地址脱敏 `maskAddress`
- 异常图片：`queryAbnormalImagePage` / `uploadAbnormalImage` / `syncImageToFactory`（生产中打印图异常的改图流程，后续可选接）
- 售后：`createAfterSales`（type: 3 原快递单号补发 / 1 新快递单号补发 / 2 赔付）/ `queryAfterSalesInfo`（后续可选接）

**下单 order 关键字段（true=必填）**
`platformType(15)`、`sourcePlatformOid`、`platformOrderStatus(NOT_SHIPPED)`、`platformRefundStatus(NO_REFUND)`、`platformOid`(订单唯一)、`consigneeName`、`phone`、`address`、`addressOptional?`、`receiverCountry`、`receiverProvince`、`receiverCity`、`receiverDistrict?`、`receiverTown?`、`deliveryCourier?`、`postCode?`(海外单不能为空)、`orderTime`(yyyy-MM-dd HH:mm:ss)、`orderPayTime?`、`selfWaybillFlag?/waybill?/addressId?`(自带面单时必填)、`goodsList`。

**goodsList item 关键字段**
`platformOid`、`platformOllId`(子订单唯一)、`goodsType(1=普通商品)`、`title`、`specification?`(颜色+尺码)、`goodsStatus(NOT_SHIPPED)`、`refundStatus(NO_REFUND)`、`sizeCode`、`sizeName`、`colorCode`、`colorName`、`styleCode`、`styleName`、`craftType(1/2)`、`num`、`platformSpuId?`、`platformSkuId?`、`price?/sellPrice?/totalPrice?/totalSellPrice?`、`printPosition?`(前1/后2/前后1,2)、`goodsLabel?`(标签/欧代)、`imageList`(必填, type1 打印图/type2 效果图, `imageUrl/imageCode/imageName`, 打印图仅 png)。

---

## 待用户提供 / 确认（开工前不阻塞前 3 个 Phase）

1. **各 riin 系工厂的 `secretKey`**（jjspromo、xinfeiyang 各一个）+ 先接测试还是生产环境 → 填 `.env` 的 `RIIN_JJSPROMO_SECRET_KEY` / `RIIN_XINFEIYANG_SECRET_KEY` / `RIIN_API_URL`。
2. **vendor→供应商实际映射**：blank items 上实际出现的 vendor（2026-08-08 统计）：marco(693)、JJSPROMO(455)、Idea Max(12)、linmiao(5)、jmall(1)。JJSPROMO/linmiao 归属明确，**marco / Idea Max / jmall 走哪家待定**。
3. ~~确认 linmiao 接口~~ ✅ **已确认**（2026-08-08 读了 linmiao OPEN_API 飞书文档，见下节）：端点/签名/字段与现有 `factory/client.ts` 完全一致。
4. ~~纯白板（不打印）如何下单~~ ✅ **已解决**：linmiao 文档有专门"不打印场景"章节——type=1 传一张 `imageCode="[不打印]"` 的占位打印图（imageUrl 可空）+ type=2 效果图（文档标必传、最多 2 张）。riin 的 imageCode 字符集明确允许英文 `[]` 和中文（正是为该标记设计），故 riin adapter 采用同一约定。**用户决定（2026-08-08）：我们侧不强制效果图**；**实测 linmiao 强制效果图非空（"效果图不能为空"），故推送时自动补图（2026-08-09）**：不打印且效果图留空 → 服务端从 Shopify 抓该 variant 的图（variant 无图退产品主图）作效果图，抓不到用 `BLANKS_PLACEHOLDER_IMAGE_URL` 占位图。

## 推送工作流（2026-08-09 用户确认）

- **大部分订单只建单不直接推送**——"建单"是弹窗主按钮，"建单并推送"次要。
- **linmiao 没有推送 API**：建单后订单在 linmiao 处于待推送，需在 **linmiao 后台**把 label 上传到订单后手动推送（UI 已在 linmiao 分组/推送记录处标注）。LinmiaoAdapter.placeOrder 恒为 pushed=false。
- **面单 API 现状**：linmiao/riin 都只有**下单时**可带面单（linmiao: `selfWaybillTag`+`waybill`(URL)+`addressId`；riin: `selfWaybillFlag`+`waybill`+`addressId`，且要求 deliveryCourier/courierNumber）；**改单接口都不支持补传面单**。
- **未来可做**：订单已有 label（Shipment.labelUrl）时建单自动带 `selfWaybillTag+waybill`，实现"先出 label 再建单"一步到位（需先接 queryShipAddress 拿 addressId）。

- **重新建单（2026-08-09）**：弹窗里已建单的 item 可重新勾选 → 自动进入重新建单模式（`replace: true`），供应商侧单号顺延（`#3940-linmiao` → `#3940-linmiao-1` → `-2`…）。原供应商订单不会自动作废，需到供应商后台关闭。未勾选 replace 时服务端仍拦截重复建单。

## linmiao OPEN_API 文档要点（飞书: qcnnzr6psjrw.feishu.cn/docx/IRUkdw8Iroxt1xxxAKqcttv4nPd，访客可看）

- 端点：`trade/v1/openapi/` + `create-order` / `update-order` / `update-order-status` / `query-order-status`(入 `{orderIdList}` 出 `data:[{pfOrderId,orderStatus,orderStateStr,childOrderStatus:[{pfSubOrderId,subOrderSatus,subOrderStatusStr}],reason}]`) / `query-order-info`。签名同 riin：header `secretKey` + `sign=md5(报文+"::"+key)`。
- **imageCode/imageName 不能包含 `-`、`+`、`&`、空格**（riin 同样只允许字母数字下划线英文[]中文）→ 图片编码用 `_` 分隔（已修）。
- 不打印校验规则：`[不打印]` 打印图只能 1 张；效果图必传、最多 2 张。**实测（2026-08-09）：占位打印图的 imageUrl 不能为空**（报"图片url不能为空"）——marker 的 URL 优先取效果图，其次打印图，都没有则用 `BLANKS_PLACEHOLDER_IMAGE_URL` 环境变量（默认 placehold.co）。
- 订单状态枚举（riin 的超集，编号兼容）：1 店铺审核中 / 2 店铺推送中 / 3 反审回电商 / 4 工厂审核 / 5 生产中 / 6 分批排产 / 7 已拣货 / 8 已打印 / 9 已裁切 / 10 已烫印 / 11 已包装 / 12 已发货 / 13 已关闭 / 14 退款中 / 15 已退款 / 20 外部订单 / 负数为分销中间态。共享状态徽章按 orderStatusStr 展示即可。

## 环境变量（新增）
```
RIIN_API_URL=https://tshirt-test.riin.com/   # 生产切 https://tshirt.riin.com/（riin 系工厂共用）
RIIN_JJSPROMO_SECRET_KEY=<向 JJSPROMO 索取>
RIIN_XINFEIYANG_SECRET_KEY=<向 xinfeiyang 索取>
# 每新增一个 riin 系工厂：加一个 RIIN_<KEY>_SECRET_KEY 环境变量 + Supplier 表加一条记录（secretKeyEnv 指向它）
# 现有 linmiao：FACTORY_API_URL / FACTORY_API_SECRET_KEY（已存在）
```
