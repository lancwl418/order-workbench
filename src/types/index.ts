import type {
  Order,
  OrderItem,
  Shipment,
  OrderLog,
  PrintLog,
  User,
  OrderException,
} from "@prisma/client";

export type OrderWithRelations = Order & {
  orderItems: OrderItem[];
  shipments: Shipment[];
  orderLogs?: OrderLog[];
  printLogs?: PrintLog[];
  exceptions?: (OrderException & {
    shipment?: { trackingNumber: string | null; carrier: string | null; status: string } | null;
  })[];
  _count?: {
    shipments: number;
  };
};

export type ShipmentSummary = {
  status: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
};

export type OrderListItem = Order & {
  orderItems: OrderItem[];
  shipments: ShipmentSummary[];
  _count: {
    shipments: number;
  };
};

export type PaginatedResponse<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type ApiError = {
  error: string;
  details?: unknown;
};

export type ExceptionWithRelations = OrderException & {
  order: {
    id: string;
    shopifyOrderNumber: string | null;
    customerName: string | null;
    internalStatus: string;
    trackingNumber: string | null;
  };
  shipment?: {
    id: string;
    trackingNumber: string | null;
    carrier: string | null;
    status: string;
    createdAt: Date;
  } | null;
};

export type ExceptionCounts = {
  shipmentIssues: number;
  processingDelays: number;
  totalOpen: number;
};

export type { Order, OrderItem, Shipment, OrderLog, PrintLog, User, OrderException };
