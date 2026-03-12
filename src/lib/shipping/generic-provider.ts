import type {
  ShippingProvider,
  CreateLabelParams,
  CreateLabelResult,
  TrackingStatus,
  VoidResult,
} from "./provider.interface";

/**
 * Generic shipping provider for manual entry workflow.
 * Does not make external API calls - stores manually entered data.
 * Can be replaced with real providers (EasyPost, ShipStation, etc.)
 */
export class GenericProvider implements ShippingProvider {
  name = "generic";

  async createLabel(params: CreateLabelParams): Promise<CreateLabelResult> {
    // Generic provider doesn't actually create labels via API.
    // It returns a success response so the shipment record can be created,
    // and the user manually enters tracking info later.
    return {
      success: true,
      trackingNumber: undefined,
      carrier: undefined,
      service: params.shippingService,
      labelUrl: undefined,
      shippingCost: undefined,
      externalShipmentId: `manual-${Date.now()}`,
      rawResponse: { provider: "generic", note: "Manual entry required" },
    };
  }

  async getTrackingStatus(trackingNumber: string): Promise<TrackingStatus> {
    // Generic provider cannot query tracking status.
    // Returns a basic status indicating manual tracking.
    return {
      status: "unknown",
      statusDetail: `Tracking ${trackingNumber} - check carrier website for status`,
    };
  }

  async voidLabel(_trackingOrRef: string): Promise<VoidResult> {
    // Generic provider marks as voided locally.
    return {
      success: true,
    };
  }
}
