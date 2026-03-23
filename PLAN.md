# 库存物料管理 & 采购模块 实现计划

## 一、业务背景

DTF 印刷业务的核心耗材包括：PET 膜卷、DTF 墨水（CMYK + 白墨）、热熔粉、包装材料等。
需要跟踪库存水位、出入库记录、低库存预警，以及向供应商的采购流程。

---

## 二、数据模型设计 (Prisma Schema)

### 新增 Enums

```prisma
enum MaterialCategory {
  INK           // 墨水
  FILM          // PET 膜
  POWDER        // 热熔粉
  PACKAGING     // 包装材料
  EQUIPMENT     // 设备耗材
  OTHER         // 其他
}

enum StockMovementType {
  IN            // 入库（采购到货）
  OUT           // 出库（生产消耗）
  ADJUST        // 调整（盘点修正）
  RETURN        // 退货
}

enum PurchaseOrderStatus {
  DRAFT         // 草稿
  SUBMITTED     // 已提交
  CONFIRMED     // 供应商已确认
  PARTIAL       // 部分到货
  RECEIVED      // 全部到货
  CANCELLED     // 已取消
}
```

### 新增 Models

#### 1. Material（物料）
```prisma
model Material {
  id            String           @id @default(cuid())
  sku           String           @unique
  name          String
  category      MaterialCategory
  unit          String           // "roll", "bottle", "kg", "box", "piece"
  description   String?          @db.Text

  // 库存参数
  currentStock  Decimal          @default(0) @map("current_stock") @db.Decimal(10, 2)
  minStock      Decimal          @default(0) @map("min_stock") @db.Decimal(10, 2)  // 低库存阈值
  maxStock      Decimal?         @map("max_stock") @db.Decimal(10, 2)

  // 成本
  unitCost      Decimal?         @map("unit_cost") @db.Decimal(10, 2)
  currency      String           @default("USD")

  // 状态
  isActive      Boolean          @default(true) @map("is_active")

  createdAt     DateTime         @default(now()) @map("created_at")
  updatedAt     DateTime         @updatedAt @map("updated_at")

  // Relations
  stockMovements StockMovement[]
  purchaseItems  PurchaseItem[]
  supplierMaterials SupplierMaterial[]

  @@index([category])
  @@index([isActive])
  @@map("materials")
}
```

#### 2. Supplier（供应商）
```prisma
model Supplier {
  id            String   @id @default(cuid())
  name          String
  contactName   String?  @map("contact_name")
  email         String?
  phone         String?
  address       String?  @db.Text
  website       String?
  notes         String?  @db.Text
  isActive      Boolean  @default(true) @map("is_active")

  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  // Relations
  purchaseOrders PurchaseOrder[]
  supplierMaterials SupplierMaterial[]

  @@map("suppliers")
}
```

#### 3. SupplierMaterial（供应商-物料关联 — 记录每个供应商对每种物料的报价）
```prisma
model SupplierMaterial {
  id            String   @id @default(cuid())
  supplierId    String   @map("supplier_id")
  materialId    String   @map("material_id")
  supplierSku   String?  @map("supplier_sku")   // 供应商的料号
  unitPrice     Decimal  @map("unit_price") @db.Decimal(10, 2)
  currency      String   @default("USD")
  leadTimeDays  Int?     @map("lead_time_days") // 交期（天）
  minOrderQty   Decimal? @map("min_order_qty") @db.Decimal(10, 2)
  isPreferred   Boolean  @default(false) @map("is_preferred")

  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  supplier      Supplier @relation(fields: [supplierId], references: [id], onDelete: Cascade)
  material      Material @relation(fields: [materialId], references: [id], onDelete: Cascade)

  @@unique([supplierId, materialId])
  @@map("supplier_materials")
}
```

#### 4. StockMovement（库存变动记录）
```prisma
model StockMovement {
  id            String            @id @default(cuid())
  materialId    String            @map("material_id")
  type          StockMovementType
  quantity      Decimal           @db.Decimal(10, 2)  // 正数=增加, 负数=减少
  beforeStock   Decimal           @map("before_stock") @db.Decimal(10, 2)
  afterStock    Decimal           @map("after_stock") @db.Decimal(10, 2)

  // 关联来源
  purchaseOrderId String?         @map("purchase_order_id")

  reason        String?           @db.Text
  operatorId    String?           @map("operator_id")

  createdAt     DateTime          @default(now()) @map("created_at")

  material      Material          @relation(fields: [materialId], references: [id], onDelete: Cascade)

  @@index([materialId])
  @@index([type])
  @@index([createdAt])
  @@map("stock_movements")
}
```

#### 5. PurchaseOrder（采购单）
```prisma
model PurchaseOrder {
  id            String              @id @default(cuid())
  orderNumber   String              @unique @map("order_number")  // PO-20260323-001
  supplierId    String              @map("supplier_id")
  status        PurchaseOrderStatus @default(DRAFT)

  // 金额
  totalAmount   Decimal             @default(0) @map("total_amount") @db.Decimal(10, 2)
  currency      String              @default("USD")

  // 日期
  orderDate     DateTime?           @map("order_date")
  expectedDate  DateTime?           @map("expected_date")    // 预计到货日
  receivedDate  DateTime?           @map("received_date")    // 实际到货日

  // 人员
  createdBy     String?             @map("created_by")
  approvedBy    String?             @map("approved_by")

  notes         String?             @db.Text

  createdAt     DateTime            @default(now()) @map("created_at")
  updatedAt     DateTime            @updatedAt @map("updated_at")

  // Relations
  supplier      Supplier            @relation(fields: [supplierId], references: [id])
  items         PurchaseItem[]

  @@index([status])
  @@index([supplierId])
  @@index([orderDate])
  @@map("purchase_orders")
}
```

#### 6. PurchaseItem（采购单明细）
```prisma
model PurchaseItem {
  id              String   @id @default(cuid())
  purchaseOrderId String   @map("purchase_order_id")
  materialId      String   @map("material_id")

  quantity        Decimal  @db.Decimal(10, 2)
  unitPrice       Decimal  @map("unit_price") @db.Decimal(10, 2)
  totalPrice      Decimal  @map("total_price") @db.Decimal(10, 2)

  receivedQty     Decimal  @default(0) @map("received_qty") @db.Decimal(10, 2)

  notes           String?  @db.Text

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  purchaseOrder   PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  material        Material      @relation(fields: [materialId], references: [id])

  @@index([purchaseOrderId])
  @@index([materialId])
  @@map("purchase_items")
}
```

---

## 三、前端页面 & 路由

### 侧边栏新增两个导航项
- **库存管理** `/inventory` — Package icon
- **采购管理** `/purchasing` — ShoppingCart icon

### 页面规划

| 路由 | 页面 | 说明 |
|------|------|------|
| `/inventory` | 物料列表 | 物料卡片/表格，库存水位条，低库存高亮，筛选（分类/状态） |
| `/inventory/[id]` | 物料详情 | 基本信息 + 库存变动历史 + 关联供应商列表 |
| `/inventory/movements` | 出入库记录 | 全局库存变动日志，支持按物料/类型/时间筛选 |
| `/purchasing` | 采购单列表 | 表格展示所有 PO，状态筛选，金额汇总 |
| `/purchasing/[id]` | 采购单详情 | PO 信息 + 明细行 + 到货确认操作 |
| `/purchasing/suppliers` | 供应商管理 | 供应商列表，编辑，关联物料报价 |

### 核心交互

1. **物料页面**
   - 创建/编辑物料（弹窗表单）
   - 手动出入库 / 盘点调整（弹窗，选类型 + 填数量 + 原因）
   - 低库存警告标识（currentStock < minStock 时红色高亮）

2. **采购单页面**
   - 新建 PO：选供应商 → 添加物料行 → 填数量/单价 → 自动算总价
   - 状态流转：DRAFT → SUBMITTED → CONFIRMED → PARTIAL/RECEIVED
   - 到货确认：逐行填已收数量 → 自动更新库存（创建 StockMovement IN）
   - 取消 PO

3. **供应商页面**
   - CRUD 供应商
   - 管理供应商-物料报价关系

---

## 四、API 路由

| 方法 | 路由 | 说明 |
|------|------|------|
| GET/POST | `/api/materials` | 物料列表 & 创建 |
| GET/PATCH/DELETE | `/api/materials/[id]` | 物料详情 & 更新 & 删除 |
| POST | `/api/materials/[id]/adjust` | 手动调整库存 |
| GET | `/api/materials/low-stock` | 低库存预警列表 |
| GET | `/api/stock-movements` | 库存变动记录 |
| GET/POST | `/api/suppliers` | 供应商列表 & 创建 |
| GET/PATCH/DELETE | `/api/suppliers/[id]` | 供应商详情 & 更新 & 删除 |
| GET/POST | `/api/suppliers/[id]/materials` | 供应商物料报价管理 |
| GET/POST | `/api/purchase-orders` | 采购单列表 & 创建 |
| GET/PATCH | `/api/purchase-orders/[id]` | 采购单详情 & 更新 |
| POST | `/api/purchase-orders/[id]/receive` | 采购到货确认（→ 更新库存） |
| POST | `/api/purchase-orders/[id]/cancel` | 取消采购单 |

---

## 五、实施步骤

### Phase 1: 数据层 + 物料基础
1. 更新 Prisma schema，添加所有新 model 和 enum
2. 运行 migration
3. 添加 i18n 翻译 (en.json / zh.json)
4. 侧边栏添加导航项
5. 实现物料 CRUD API (`/api/materials`)
6. 实现物料列表页 `/inventory`（表格 + 创建弹窗 + 低库存标识）
7. 实现物料详情页 `/inventory/[id]`

### Phase 2: 库存变动
8. 实现库存调整 API (`/api/materials/[id]/adjust`)
9. 实现库存变动记录 API (`/api/stock-movements`)
10. 实现手动出入库弹窗
11. 实现库存变动历史页 `/inventory/movements`
12. 实现低库存预警 API + 页面标识

### Phase 3: 供应商管理
13. 实现供应商 CRUD API
14. 实现供应商管理页 `/purchasing/suppliers`
15. 实现供应商-物料报价关联

### Phase 4: 采购单
16. 实现采购单 CRUD API
17. 实现采购单列表页 `/purchasing`
18. 实现采购单创建/编辑页
19. 实现采购单详情页 `/purchasing/[id]`
20. 实现到货确认功能（→ 自动更新库存 + 创建 StockMovement）
21. 实现采购单状态流转

---

## 六、与现有系统的集成点

- **User model**：StockMovement.operatorId、PurchaseOrder.createdBy/approvedBy 关联现有 User
- **权限**：admin 可完整操作，operator 可查看库存和提交采购需求，cs 只读
- **未来扩展**：印刷完成时自动扣减墨水/膜的库存（PrintLog → StockMovement OUT）
