import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { API_V1_PREFIX } from '../../../../common/http/api-version';
import {
  DeviceProtocolService,
  PairingThrottledException,
  type DeviceContext,
} from '../../application/device-protocol.service';
import { CurrentPrintDevice, DeviceAuthGuard } from './device-auth.guard';
import {
  AckJobDto,
  DevicePrintersDto,
  FailJobDto,
  HeartbeatDto,
  NextJobsQueryDto,
  PairDeviceDto,
} from './dto/printing.dto';

const DEFAULT_WAIT_SECONDS = 25;

@ApiTags('print-device')
@Controller(`${API_V1_PREFIX}/print/device`)
export class DevicePrintController {
  constructor(private readonly protocol: DeviceProtocolService) {}

  @Post('pair')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Canjea el codigo de emparejamiento de 6 digitos por el token del dispositivo (se muestra una sola vez). Sin autenticacion.',
  })
  async pair(
    @Body() dto: PairDeviceDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return await this.protocol.pair(dto, {
        ip: request.ip?.slice(0, 200) ?? null,
      });
    } catch (error) {
      if (error instanceof PairingThrottledException) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }

      throw error;
    }
  }

  @Get('me')
  @UseGuards(DeviceAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Datos del dispositivo, impresoras que atiende y las que podria atender.',
  })
  me(@CurrentPrintDevice() device: DeviceContext) {
    return this.protocol.me(device);
  }

  @Put('printers')
  @UseGuards(DeviceAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Define que impresoras de la sucursal atiende este dispositivo.',
  })
  setPrinters(
    @CurrentPrintDevice() device: DeviceContext,
    @Body() dto: DevicePrintersDto,
  ) {
    return this.protocol.setPrinters(device, dto.printerIds);
  }

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceAuthGuard)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @ApiOperation({ summary: 'Latido del dispositivo cada 20 a 30 segundos.' })
  heartbeat(
    @CurrentPrintDevice() device: DeviceContext,
    @Body() dto: HeartbeatDto,
  ) {
    return this.protocol.heartbeat(device, dto);
  }

  @Get('jobs/next')
  @UseGuards(DeviceAuthGuard)
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Long-poll: reclama hasta 5 trabajos. Responde 200 con la lista o 204 si no hubo trabajo tras esperar.',
  })
  async next(
    @CurrentPrintDevice() device: DeviceContext,
    @Query() query: NextJobsQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const abort = new AbortController();

    request.on('close', () => abort.abort());

    const jobs = await this.protocol.claimNext(
      device,
      query.wait ?? DEFAULT_WAIT_SECONDS,
      abort.signal,
    );

    if (jobs.length === 0) {
      response.status(HttpStatus.NO_CONTENT);

      return;
    }

    return { jobs };
  }

  @Post('jobs/:id/ack')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceAuthGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Confirma que el trabajo se imprimio.' })
  ack(
    @CurrentPrintDevice() device: DeviceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AckJobDto,
  ) {
    return this.protocol.ack(device, id, dto);
  }

  @Post('jobs/:id/fail')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceAuthGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Informa que el trabajo no se pudo imprimir.' })
  fail(
    @CurrentPrintDevice() device: DeviceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailJobDto,
  ) {
    return this.protocol.fail(device, id, dto);
  }

  @Post('jobs/:id/extend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceAuthGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Renueva el lease de un trabajo reclamado.' })
  extend(
    @CurrentPrintDevice() device: DeviceContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.protocol.extend(device, id);
  }

  @Delete('self')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(DeviceAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'El dispositivo se des-registra.' })
  async removeSelf(@CurrentPrintDevice() device: DeviceContext): Promise<void> {
    await this.protocol.removeSelf(device);
  }
}
