import type {
  Order,
  OrderItem,
  Shipment,
  OrderLog,
  PrintLog,
  User,
  OrderException,
  PrintGroup,
  PrintGroupItem,
  CsComment,
  Notification,
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
  id: string;
  status: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  syncStatus: string;
  providerName: string | null;
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
    shopifyOrderId: string | null;
    shopifyOrderNumber: string | null;
    customerName: string | null;
    customerEmail: string | null;
    internalStatus: string;
    trackingNumber: string | null;
    totalPrice: unknown;
  };
  shipment?: {
    id: string;
    trackingNumber: string | null;
    carrier: string | null;
    status: string;
    shippedAt: Date | null;
    createdAt: Date;
  } | null;
  response?: {
    responseType: string | null;
    needByDate: Date | null;
    noRush: boolean;
    comments: string | null;
    respondedAt: Date | null;
  } | null;
};

export type ExceptionCounts = {
  shipmentIssues: number;
  processingDelays: number;
  totalOpen: number;
};

export type PrintGroupOrderItem = {
  id: string;
  title: string;
  variantTitle: string | null;
  designFileUrl: string | null;
  originalDesignFileUrl: string | null;
  isPrinted: boolean;
};

export type PrintGroupWithItems = PrintGroup & {
  items: (PrintGroupItem & {
    order: {
      id: string;
      shopifyOrderNumber: string | null;
      customerName: string | null;
      internalStatus?: string;
      orderItems?: PrintGroupOrderItem[];
    };
  })[];
};

export type CsCommentWithUser = CsComment & {
  user?: { displayName: string | null; username: string } | null;
};

export type NotificationItem = Notification;

export type { Order, OrderItem, Shipment, OrderLog, PrintLog, User, OrderException, PrintGroup, PrintGroupItem, CsComment, Notification };
