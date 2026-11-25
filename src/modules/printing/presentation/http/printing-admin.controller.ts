import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { API_V1_PREFIX } from '../../../../common/http/api-version';
import { CurrentAuthUser } from '../../../auth/decorators/current-auth-user.decorator';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { PrintDevicesService } from '../../application/print-devices.service';
import { PrintJobsService } from '../../application/print-jobs.service';
import { PrintersService } from '../../application/printers.service';
import {
  CreatePrintDeviceDto,
  CreatePrinterDto,
  ListPrintJobsQueryDto,
  SamplePreviewQueryDto,
  SetPrinterStationsDto,
  UpdatePrintDeviceDto,
  UpdatePrintStationDto,
  UpdatePrinterDto,
} from './dto/printing.dto';

@ApiTags('print')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfileTypeGuard)
@RequireProfileType(LoginProfileType.STAFF)
@Controller(`${API_V1_PREFIX}/branches/:branchId/print`)
export class PrintingAdminController {
  constructor(
    private readonly printers: PrintersService,
    private readonly jobs: PrintJobsService,
    private readonly devices: PrintDevicesService,
  ) {}

  @Get('printers')
  @ApiOperation({ summary: 'Lista las impresoras. ADMIN y SUPERVISOR.' })
  listPrinters(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.printers.list(user, branchId);
  }

  @Post('printers')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Crea una impresora. Requiere ADMIN.' })
  createPrinter(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: CreatePrinterDto,
  ) {
    return this.printers.create(user, branchId, dto);
  }

  @Get('printers/:printerId')
  @ApiOperation({ summary: 'Detalle de una impresora. ADMIN y SUPERVISOR.' })
  getPrinter(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
  ) {
    return this.printers.get(user, branchId, printerId);
  }

  @Patch('printers/:printerId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Actualiza una impresora. Requiere ADMIN.' })
  updatePrinter(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Body() dto: UpdatePrinterDto,
  ) {
    return this.printers.update(user, branchId, printerId, dto);
  }

  @Delete('printers/:printerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Elimina una impresora sin trabajos abiertos. Requiere ADMIN.',
  })
  removePrinter(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
  ) {
    return this.printers.remove(user, branchId, printerId);
  }

  @Put('printers/:printerId/stations')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Reemplaza las estaciones que imprimen en la impresora. ADMIN.',
  })
  setPrinterStations(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Body() dto: SetPrinterStationsDto,
  ) {
    return this.printers.setStations(user, branchId, printerId, dto.stationIds);
  }

  @Post('printers/:printerId/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Encola una hoja de prueba. Requiere ADMIN.' })
  testPrint(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
  ) {
    return this.printers.testPrint(user, branchId, printerId);
  }

  @Get('stations')
  @ApiOperation({
    summary: 'Estaciones con su codigo de impresion e impresoras asignadas.',
  })
  listStations(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.printers.listStations(user, branchId);
  }

  @Patch('stations/:stationId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Cambia el codigo de impresion de la estacion y/o sus impresoras. ADMIN.',
  })
  updateStation(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('stationId', ParseUUIDPipe) stationId: string,
    @Body() dto: UpdatePrintStationDto,
  ) {
    return this.printers.updateStation(user, branchId, stationId, dto);
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Lista trabajos de impresion con filtros.' })
  listJobs(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListPrintJobsQueryDto,
  ) {
    return this.jobs.list(user, branchId, query);
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Detalle de un trabajo con su documento.' })
  getJob(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.get(user, branchId, jobId);
  }

  @Get('jobs/:jobId/preview')
  @ApiOperation({ summary: 'Vista de comanda: texto y HTML de un trabajo.' })
  previewJob(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.preview(user, branchId, jobId);
  }

  @Post('jobs/:jobId/reprint')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Reimprime un trabajo. ADMIN, SUPERVISOR, KITCHEN y BAR.',
  })
  reprint(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.reprint(user, branchId, jobId);
  }

  @Post('jobs/:jobId/retry')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Reintenta un trabajo FAILED. ADMIN y SUPERVISOR.',
  })
  retry(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.retry(user, branchId, jobId);
  }

  @Post('station-tickets/:stationTicketId/reprint')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Reimprime la comanda de un ticket de estacion en todas sus impresoras. ADMIN, SUPERVISOR, KITCHEN y BAR.',
  })
  reprintTicket(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('stationTicketId', ParseUUIDPipe) stationTicketId: string,
  ) {
    return this.jobs.reprintTicket(user, branchId, stationTicketId);
  }

  @Get('preview/sample')
  @ApiOperation({
    summary:
      'Vista de una comanda de ejemplo con el codigo de la estacion y el ancho indicado.',
  })
  samplePreview(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: SamplePreviewQueryDto,
  ) {
    return this.jobs.samplePreview(user, branchId, query);
  }

  @Get('devices')
  @ApiOperation({ summary: 'Lista los dispositivos de impresion.' })
  listDevices(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.devices.list(user, branchId);
  }

  @Post('devices')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Crea un dispositivo y su codigo de emparejamiento (6 digitos, vigencia corta). ADMIN.',
  })
  createDevice(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: CreatePrintDeviceDto,
  ) {
    return this.devices.createPairing(user, branchId, dto);
  }

  @Post('devices/:deviceId/pairing-code')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Genera un nuevo codigo para volver a emparejar un dispositivo (invalida su token). ADMIN.',
  })
  regeneratePairing(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    return this.devices.regeneratePairing(user, branchId, deviceId);
  }

  @Patch('devices/:deviceId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Renombra un dispositivo o cambia sus impresoras. ADMIN.',
  })
  updateDevice(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: UpdatePrintDeviceDto,
  ) {
    return this.devices.update(user, branchId, deviceId, dto);
  }

  @Delete('devices/:deviceId')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Revoca el dispositivo: su token deja de funcionar. ADMIN.',
  })
  revokeDevice(
    @CurrentAuthUser() user: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    return this.devices.revoke(user, branchId, deviceId);
  }
}
