export type NotificationType = 'WAREHOUSE' | 'FLEET' | 'DISPATCHER' | 'GENERIC';

export class Notification {
  id: number;
  userId: number;
  title: string;
  body: string;
  type: NotificationType;
  isRead: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
