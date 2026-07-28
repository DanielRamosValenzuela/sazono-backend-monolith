import { mapTransbankStatus } from './transbank-status';

describe('mapTransbankStatus', () => {
  it('maps AUTHORIZED with response_code 0 to APPROVED', () => {
    expect(mapTransbankStatus('AUTHORIZED', 0)).toEqual({
      outcome: 'APPROVED',
    });
  });

  it('maps AUTHORIZED with a non-zero response_code to REJECTED', () => {
    expect(mapTransbankStatus('AUTHORIZED', -1)).toEqual({
      outcome: 'REJECTED',
      failureReason: 'El medio de pago rechazo el cobro, intenta con otro.',
    });
  });

  it('maps FAILED to REJECTED regardless of response_code', () => {
    expect(mapTransbankStatus('FAILED', 0)).toEqual({
      outcome: 'REJECTED',
      failureReason: 'El medio de pago rechazo el cobro, intenta con otro.',
    });
  });

  it('maps NULLIFIED to REJECTED', () => {
    expect(mapTransbankStatus('NULLIFIED', 0)).toEqual({
      outcome: 'REJECTED',
      failureReason: 'El medio de pago rechazo el cobro, intenta con otro.',
    });
  });

  it('maps an unknown status to REJECTED', () => {
    expect(mapTransbankStatus('SOMETHING_UNEXPECTED', 0)).toEqual({
      outcome: 'REJECTED',
      failureReason: 'El medio de pago rechazo el cobro, intenta con otro.',
    });
  });
});
