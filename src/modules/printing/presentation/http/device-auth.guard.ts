import {
  createParamDecorator,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  DeviceProtocolService,
  type DeviceContext,
} from '../../application/device-protocol.service';

type DeviceRequest = Request & { printDevice?: DeviceContext };

@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly protocol: DeviceProtocolService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeviceRequest>();

    request.printDevice = await this.protocol.authenticate(
      request.headers.authorization,
    );

    return true;
  }
}

export const CurrentPrintDevice = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DeviceContext =>
    context.switchToHttp().getRequest<DeviceRequest>()
      .printDevice as DeviceContext,
);
