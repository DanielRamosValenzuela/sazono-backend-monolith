import { Global, Module } from '@nestjs/common';
import { BranchAccessService } from './branch-access.service';

@Global()
@Module({
  providers: [BranchAccessService],
  exports: [BranchAccessService],
})
export class BranchAccessModule {}
