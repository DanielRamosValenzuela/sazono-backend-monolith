import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import { CreateLeadService } from '../../application/create-lead.service';
import { ListLeadsService } from '../../application/list-leads.service';
import { CreateLeadDto, LeadResponseDto } from './dto/leads.dto';

@ApiTags('leads')
@Controller(buildVersionedControllerPath('leads'))
export class LeadsController {
  constructor(
    private readonly createLeadService: CreateLeadService,
    private readonly listLeadsService: ListLeadsService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Registra un lead desde la landing publica (contacto o solicitud de demo). Sin autenticacion.',
  })
  create(@Body() dto: CreateLeadDto): Promise<LeadResponseDto> {
    return this.createLeadService.execute(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.PLATFORM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lista los leads capturados, mas recientes primero.',
  })
  list(): Promise<LeadResponseDto[]> {
    return this.listLeadsService.execute();
  }
}
