import type { Branch, BranchSettings } from '@prisma/client';
import type { BranchResponseDto } from '../presentation/http/dto/branch.dto';

type BranchWithSettings = Branch & {
  settings: BranchSettings | null;
};

export function mapBranchToResponse(
  branch: BranchWithSettings,
): BranchResponseDto {
  return {
    branchId: branch.id,
    restaurantId: branch.restaurantId,
    name: branch.name,
    address: branch.address,
    status: branch.status,
    settings: {
      qrOrderingEnabled: branch.settings?.qrOrderingEnabled ?? true,
      qrPaymentMode: branch.settings?.qrPaymentMode ?? 'prepaid_order',
      splitBillEnabled: branch.settings?.splitBillEnabled ?? true,
      partialDeliveryEnabled: branch.settings?.partialDeliveryEnabled ?? true,
      autoDeliverAfterMinutes: branch.settings?.autoDeliverAfterMinutes ?? null,
    },
  };
}
