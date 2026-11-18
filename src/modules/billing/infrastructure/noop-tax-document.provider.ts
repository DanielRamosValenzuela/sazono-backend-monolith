import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  IssueBoletaInput,
  IssueCreditNoteInput,
  IssuedTaxDocument,
  TaxDocumentProviderPort,
} from '../application/ports/tax-document-provider.port';

@Injectable()
export class NoopTaxDocumentProvider implements TaxDocumentProviderPort {
  readonly providerName = 'NOOP';

  issueBoleta(input: IssueBoletaInput): Promise<IssuedTaxDocument> {
    return Promise.reject(
      new NotImplementedException(
        `No hay proveedor de boleta electronica configurado (documento ${input.taxDocumentId}).`,
      ),
    );
  }

  issueCreditNote(input: IssueCreditNoteInput): Promise<IssuedTaxDocument> {
    return Promise.reject(
      new NotImplementedException(
        `No hay proveedor de nota de credito configurado (documento ${input.taxDocumentId}).`,
      ),
    );
  }
}
