export class Order {
  id: number;
  orderCode: string;
  status: string;
  route?: string | null;
  originHub?: string | null;
  destinationHub?: string | null;
  totalQuantity?: number | null;
  totalWeight: number;
  totalVolume: number;
  goodsDescription?: string | null;
  isExternalVehicleNeeded: boolean;
  createdByUserId?: number | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}
