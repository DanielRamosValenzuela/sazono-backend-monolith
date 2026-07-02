import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getStatus() {
    return {
      service: 'sazono-backend-monolith',
      status: 'ok',
    };
  }
}
