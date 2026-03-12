export interface CreateLabelParams {
  orderId: string;
  recipientName: string;
  recipientAddress: {
    address1: string;
    address2?: string;
    city: string;
    province: string;
    zip: string;
    country: string;
    phone?: string;
  };
  packageInfo?: {
    weightOz?: number;
    lengthIn?: number;
    widthIn?: number;
    heightIn?: number;
  };
  shippingService?: string;
}

export interface CreateLabelResult {
  success: boolean;
  trackingNumber?: string;
  carrier?: string;
  service?: string;
  labelUrl?: string;
  shippingCost?: number;
  externalShipmentId?: string;
  error?: string;
  rawResponse?: unknown;
}

export interface TrackingStatus {
  status: string;
  statusDetail?: string;
  estimatedDelivery?: Date;
  deliveredAt?: Date;
  events?: Array<{
    timestamp: Date;
    description: string;
    location?: string;
  }>;
}

export interface VoidResult {
  success: boolean;
  error?: string;
}

export interface ShippingProvider {
  name: string;
  createLabel(params: CreateLabelParams): Promise<CreateLabelResult>;
  getTrackingStatus(trackingNumber: string): Promise<TrackingStatus>;
  voidLabel(trackingOrRef: string): Promise<VoidResult>;
}
