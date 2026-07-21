import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';

@Injectable()
export class FirebaseAdminService {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private readonly enabled: boolean;
  private appInstance?: App;

  constructor(private readonly configService: ConfigService) {
    this.enabled = Boolean(
      this.configService.get<string>('FIREBASE_PROJECT_ID') &&
      this.configService.get<string>('FIREBASE_CLIENT_EMAIL') &&
      this.configService.get<string>('FIREBASE_PRIVATE_KEY'),
    );

    if (!this.enabled) {
      this.logger.warn(
        'Firebase Admin no esta configurado (faltan FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY) - el envio de push queda deshabilitado.',
      );
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get messaging(): Messaging {
    this.appInstance ??= this.createApp();

    return getMessaging(this.appInstance);
  }

  private createApp(): App {
    const projectId = this.getRequiredConfig('FIREBASE_PROJECT_ID');
    const clientEmail = this.getRequiredConfig('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.getRequiredConfig('FIREBASE_PRIVATE_KEY').replace(
      /\\n/g,
      '\n',
    );

    return initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  }

  private getRequiredConfig(name: string): string {
    const value = this.configService.get<string>(name);

    if (!value) {
      throw new Error(`Firebase Admin no esta configurado. Falta ${name}.`);
    }

    return value;
  }
}
