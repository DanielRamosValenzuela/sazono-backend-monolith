import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { GetPublishedMenuByQrService } from '../../application/get-published-menu-by-qr.service';
import { MenuDetailResponseDto } from './dto/menus.dto';

@ApiTags('qr')
@Controller(buildVersionedControllerPath('qr'))
export class QrMenuController {
  constructor(
    private readonly getPublishedMenuByQrService: GetPublishedMenuByQrService,
  ) {}

  @Get('tables/:qrToken/menu')
  @ApiOperation({
    summary:
      'Retorna la carta publicada de la sucursal para el QR de una mesa. Endpoint publico. "locale" opcional traduce nombre/descripcion cuando existe traduccion; sin traduccion cae al idioma original.',
  })
  @ApiQuery({ name: 'locale', required: false, example: 'en' })
  getPublishedMenu(
    @Param('qrToken') qrToken: string,
    @Query('locale') locale?: string,
  ): Promise<MenuDetailResponseDto> {
    return this.getPublishedMenuByQrService.execute(qrToken, locale);
  }
}
