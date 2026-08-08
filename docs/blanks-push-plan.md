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

### Phase 1 — 数据层（Prisma schema + 迁移 + seed）
- [ ] 新增 `Supplier` 表：`key`(唯一)、`name`、`adapterType`("linmiao"|"riin")、`baseUrl?`、`secretKeyEnv`(**存环境变量名，密钥不落库**)、`platformType?`(默认15)、`enabled`(默认true)。
  - 一个 `adapterType="riin"` 可挂多条 Supplier（JJSPROMO 现在，其他以后），各自 secretKey 不同。
- [ ] 新增 `VendorMapping` 表：`vendor`(唯一, Shopify vendor 规范化) → `supplierId`(FK Supplier)。
- [ ] `OrderItem` 增字段：`vendor String?`；推送状态 `supplierId?`、`supplierPushedAt?`、`supplierOrderNo?`、`supplierTraceId?`（沿用现有 `factory*` 字段思路）。
- [ ] `SkuMapping` 增 `supplierId`，复合唯一改为 `ourSku + variantTitle + supplierId`（映射按供应商区分）。
- [ ] 迁移 + `prisma/seed.ts`：写入 linmiao、jjspromo 两条 Supplier。

### Phase 2 — vendor 采集（补现有缺口：目前 mapper 未采集 vendor）
- [ ] `src/lib/shopify/types.ts`：`ShopifyLineItem` 加 `vendor?: string`；`MappedOrderItem` 加 `vendor`。
- [ ] `src/lib/shopify/orders.ts`（~L196 map）：`vendor: lineItem.vendor || null`。
- [ ] `src/lib/shopify/webhooks.ts`：upsert/create OrderItem 三处（约 L107、L238、L358 附近）带上 `vendor`。
- [ ] 回填脚本 `scripts/`：遍历现有订单 `shopifyRawJson.line_items[].vendor` 补 `OrderItem.vendor`。

### Phase 3 — 对接层（`src/lib/suppliers/`）
- [ ] `types.ts`：`SupplierAdapter` 接口 + 统一 `SupplierOrderInput`（consignee 扁平化字段、items 数组），`SupplierOrderResult`（externalOrderNo/traceId/raw）。
- [ ] `linmiao.ts`：包一层现有 `factory/client.ts`，把统一 input 映射成 `FactoryCreateOrderParams`（嵌套 consignee、pfOrderId/pfSubOrderId）。
- [ ] `riin.ts`：**新 client**，对接 `/trade/api/interface/placeOrder`，扁平 consignee、`platformOid/platformOllId`；备用 `queryOrderStatus`、`queryOrderDelivery`、`queryProduct/Style/Color/Size`。`sign = md5(body + "::" + secretKey)`（secretKey 走 header）。限流每接口 10 次/秒。env：`RIIN_API_URL`、`RIIN_API_SECRET_KEY`。
- [ ] `registry.ts`：按 `supplier.adapterType` + Supplier 配置（baseUrl / secretKeyEnv）返回 adapter 实例。

### Phase 4 — API 路由
- [ ] `POST /api/orders/[id]/push-blanks`：取该单 `itemType='other'` items → 按 `item.vendor` 查 VendorMapping 定供应商（**服务端重算，不信任前端**）→ 按供应商分组 → 各调 adapter 下单 → **部分成功**分组返回（A 成 B 败可单独重推）；每组写 `OrderLog`、回写 item 供应商字段、按供应商 upsert `SkuMapping`；未映射 vendor 的 item 拦截报错。
- [ ] `GET/POST /api/suppliers`、`PATCH/DELETE /api/suppliers/[id]`。
- [ ] `GET/POST /api/vendor-mappings`、`DELETE /api/vendor-mappings/[id]`。

### Phase 5 — UI
- [ ] `src/components/orders/push-blanks-dialog.tsx`（取代 push-factory-dialog）：拉取 `other` items + vendor + 解析出的供应商，**按供应商分组展示**；每行复用 SKU/尺码/颜色/款号/工艺/打印字段，从 SkuMapping 预填；未映射 vendor 的 item 高亮提示去配置；按组推送并显示各组结果。
- [ ] 供应商 & 映射管理页（`src/app/(dashboard)/` 下）：CRUD Supplier 和 vendor→supplier 映射。
- [ ] 订单入口：把 push-factory 按钮替换为"推 Blanks"（有 `other` item 时可用）。
- [ ] i18n 文案（`messages/`）。

### Phase 6 — 测试 & 清理
- [ ] vitest：adapter 映射、分组路由、部分成功、md5 签名。
- [ ] 确认无误后下线旧 `push-factory` 路由/弹窗与相关 UI 入口。

---

## riin API 规格摘要（来自 T恤第三方接口-20250819.pdf）

- 测试：`https://tshirt-test.riin.com/`  生产：`https://tshirt.riin.com/`
- 每接口限流 10 次/秒；`sign = md5(请求报文 + "::" + secretKey)`，按请求参数字段顺序生成 sign。
- header：`secretKey`、`sign`。响应统一 `{successful, message, errorCode, data}`。

**端点**
- 下单 `POST /trade/api/interface/placeOrder`
- 改单 `POST /trade/api/interface/updateOrder`（推到工厂后不可改）
- 预发货 `POST /trade/api/interface/preShipped`（body `{platformOid}`）
- 查面单 `POST /trade/api/interface/queryOrderDelivery`（body `{platformOidList:[]}` ≤100，返回 `trackingNumber/waybillDataPath/shippingTime`）
- 查订单状态 `POST /trade/api/interface/queryOrderStatus`（返回 `orderStatus`(1 店铺审核中/2 店铺推送中/3 反审回电商/4 工厂审核/5 生产中/12 已发货/13 已关闭/14 退款中/15 已退款) + `childOrderStatus[]`）
- 查产品/款号/颜色/尺码 `queryProduct` / `queryStyle` / `queryColor` / `querySize`（分页 `{pageIndex,pageSize}`）

**下单 order 关键字段（true=必填）**
`platformType(15)`、`sourcePlatformOid`、`platformOrderStatus(NOT_SHIPPED)`、`platformRefundStatus(NO_REFUND)`、`platformOid`(订单唯一)、`consigneeName`、`phone`、`address`、`addressOptional?`、`receiverCountry`、`receiverProvince`、`receiverCity`、`receiverDistrict?`、`receiverTown?`、`deliveryCourier?`、`postCode?`(海外单不能为空)、`orderTime`(yyyy-MM-dd HH:mm:ss)、`orderPayTime?`、`selfWaybillFlag?/waybill?/addressId?`(自带面单时必填)、`goodsList`。

**goodsList item 关键字段**
`platformOid`、`platformOllId`(子订单唯一)、`goodsType(1=普通商品)`、`title`、`specification?`(颜色+尺码)、`goodsStatus(NOT_SHIPPED)`、`refundStatus(NO_REFUND)`、`sizeCode`、`sizeName`、`colorCode`、`colorName`、`styleCode`、`styleName`、`craftType(1/2)`、`num`、`platformSpuId?`、`platformSkuId?`、`price?/sellPrice?/totalPrice?/totalSellPrice?`、`printPosition?`(前1/后2/前后1,2)、`goodsLabel?`(标签/欧代)、`imageList`(必填, type1 打印图/type2 效果图, `imageUrl/imageCode/imageName`, 打印图仅 png)。

---

## 待用户提供 / 确认（开工前不阻塞前 3 个 Phase）

1. **riin/JJSPROMO 的 `secretKey`** + 先接测试还是生产环境 → 填 `.env` 的 `RIIN_API_SECRET_KEY` / `RIIN_API_URL`。
2. **vendor→供应商实际映射**：哪些 Shopify vendor 走 JJSPROMO、哪些走 linmiao（给 1~2 个真实 vendor 名用于 seed/测试）。
3. **确认现有 `factory/client.ts`(linmiao.online) 即为要用的 linmiao 接口**；Feishu 文档需登录抓不到，若为新版本请贴出。

## 环境变量（新增）
```
RIIN_API_URL=https://tshirt-test.riin.com/   # 生产切 https://tshirt.riin.com/
RIIN_API_SECRET_KEY=<向 riin/JJSPROMO 索取>
# 现有 linmiao：FACTORY_API_URL / FACTORY_API_SECRET_KEY（已存在）
```
