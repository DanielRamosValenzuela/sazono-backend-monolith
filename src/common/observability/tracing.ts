import 'dotenv/config';

import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';

let telemetrySdk: NodeSDK | undefined;

async function stopTelemetry() {
  if (!telemetrySdk) {
    return;
  }

  await telemetrySdk.shutdown();
  telemetrySdk = undefined;
}

export async function startTelemetry() {
  if (process.env.OTEL_ENABLED !== 'true' || telemetrySdk) {
    return;
  }

  const exporterUrl = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

  if (!exporterUrl) {
    return;
  }

  if (process.env.OTEL_DEBUG === 'true') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  telemetrySdk = new NodeSDK({
    serviceName:
      process.env.OTEL_SERVICE_NAME ?? 'sazono-backend-monolith',
    traceExporter: new OTLPTraceExporter({
      url: exporterUrl,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
      }),
      new NestInstrumentation(),
      new PrismaInstrumentation(),
    ],
  });

  await telemetrySdk.start();

  process.once('SIGINT', () => {
    void stopTelemetry();
  });

  process.once('SIGTERM', () => {
    void stopTelemetry();
  });
}
