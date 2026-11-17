import { Global, Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { BranchAccessService } from './branch-access.service';

@Global()
@Module({
  imports: [CacheModule],
  providers: [BranchAccessService],
  exports: [BranchAccessService],
})
export class BranchAccessModule {}
