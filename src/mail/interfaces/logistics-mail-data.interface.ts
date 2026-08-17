export enum WarehouseNotificationType {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
  DEADLINE_ALERT = 'DEADLINE_ALERT',
  CAPACITY_WARNING = 'CAPACITY_WARNING',
}

export enum FleetNotificationType {
  TRIP_ASSIGNMENT = 'TRIP_ASSIGNMENT',
  OVERLOAD_ALERT = 'OVERLOAD_ALERT',
  TRIP_STATUS_UPDATE = 'TRIP_STATUS_UPDATE',
}

export enum DispatcherNotificationType {
  NEW_ORDER = 'NEW_ORDER',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  ROUTING_ALERT = 'ROUTING_ALERT',
  DAILY_SUMMARY = 'DAILY_SUMMARY',
}

export interface WarehouseNotificationData {
  title: string;
  recipientName?: string;
  hubName: string; // e.g., Kho Andromeda (Thủ Đức, HCM), Kho Magellan (Đà Nẵng), Kho Vela (Hưng Yên)
  notificationType: WarehouseNotificationType;
  tripCode?: string;
  vehiclePlate?: string;
  driverName?: string;
  expectedTime?: string; // e.g., "16:30 - 17/08/2026"
  totalPackages?: number;
  totalWeight?: string; // e.g., "1,500 kg"
  totalVolume?: string; // e.g., "8.5 m³"
  notes?: string;
  actionUrl?: string;
}

export interface FleetNotificationData {
  title: string;
  recipientName?: string;
  notificationType: FleetNotificationType;
  tripCode: string;
  vehiclePlate: string;
  driverName: string;
  route: string; // e.g., "Huế -> Kho Andromeda (Thủ Đức, HCM)"
  currentWeight?: string; // e.g., "8,200 kg"
  maxPayload?: string; // e.g., "8,000 kg"
  currentVolume?: string; // e.g., "42 m³"
  maxVolume?: string; // e.g., "40 m³"
  status?: string; // e.g., "ASSIGNED", "OVERLOAD", "IN_TRANSIT", "COMPLETED"
  notes?: string;
  actionUrl?: string;
}

export interface DispatcherNotificationData {
  title: string;
  recipientName?: string;
  notificationType: DispatcherNotificationType;
  orderCode: string; // e.g., "NDA2607-8892"
  customerName?: string;
  pickupLocation?: string; // e.g., "TBS Tân Vạn"
  dropoffLocation?: string; // e.g., "Đại lý Phùng Chí Kiên, Hưng Yên"
  regionGroup?: string; // e.g., "12 ĐƠN MIỀN BẮC"
  cargoInfo?: string; // e.g., "50 thùng hóa chất (450kg - 2.8m³)"
  status?: string;
  notes?: string;
  actionUrl?: string;
}

export interface GenericNotificationData {
  title: string;
  recipientName?: string;
  badgeText?: string;
  badgeType?: 'info' | 'warning' | 'danger' | 'success';
  message: string;
  details?: Array<{ label: string; value: string }>;
  actionTitle?: string;
  actionUrl?: string;
  footerText?: string;
}

export interface TripConfirmedNotificationData {
  orderCode: string;
  route?: string;
  originHub?: string;
  destinationHub?: string;
  licensePlate: string;
  isExternal?: boolean;
  externalProvider?: string;
  driverName?: string;
  driverPhone?: string;
  weightAllocated: number;
  volumeAllocated: number;
  pickupDate?: string;
  pickupTime?: string;
  estimatedDeliveryDate?: string;
  goodsDescription?: string;
  orderNotes?: string;
  externalNote?: string;
  tripNotes?: string;
}
