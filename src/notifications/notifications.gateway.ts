import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AllConfigType } from '../config/config.type';
import { Notification } from './domain/notification';

@WebSocketGateway({
  namespace: 'notifications',
  cors: {
    origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
      callback(null, true);
    },
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  /** userId → Set of socketIds (user có thể mở nhiều tab) */
  private readonly userSockets = new Map<number, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  afterInit(): void {
    this.logger.log('NotificationsGateway initialized');
  }

  handleConnection(client: Socket): void {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string);

      if (!token) {
        this.logger.warn(`WS [${client.id}]: no token → disconnect`);
        client.disconnect();
        return;
      }

      const secret = this.configService.getOrThrow('auth.secret', {
        infer: true,
      });
      const payload = this.jwtService.verify<{ id: number }>(token, { secret });
      const userId = Number(payload.id);

      if (!userId) {
        client.disconnect();
        return;
      }

      // Attach userId vào socket data để dùng sau
      client.data.userId = userId;

      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(client.id);

      // Join room theo userId để emit dễ dàng
      void client.join(`user:${userId}`);

      this.logger.log(`WS connected: userId=${userId} socketId=${client.id}`);
    } catch {
      this.logger.warn(`WS [${client.id}]: invalid token → disconnect`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data?.userId as number | undefined;
    if (userId) {
      const sockets = this.userSockets.get(userId);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
        }
      }
      this.logger.log(`WS disconnected: userId=${userId} socketId=${client.id}`);
    }
  }

  /**
   * Push notification đến một user cụ thể (qua room).
   * Gọi từ NotificationsService sau khi lưu DB.
   */
  emitToUser(userId: number, notification: Notification): void {
    this.server.to(`user:${userId}`).emit('notification:new', notification);
  }
}
