import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
      'Retorna la carta publicada de la sucursal para el QR de una mesa. Endpoint publico.',
  })
  getPublishedMenu(
    @Param('qrToken') qrToken: string,
  ): Promise<MenuDetailResponseDto> {
    return this.getPublishedMenuByQrService.execute(qrToken);
  }
}
