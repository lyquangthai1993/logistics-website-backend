export class Trip {
  id: number;
  orderId: number;
  vehicleId?: number | null;
  driverId?: number | null;
  status: string;
  pickupDate?: string | null;
  pickupTime?: string | null;
  estimatedDeliveryDate?: string | null;
  weightAllocated: number;
  volumeAllocated: number;
  sequenceNumber: number;
  assignedByUserId?: number | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}
