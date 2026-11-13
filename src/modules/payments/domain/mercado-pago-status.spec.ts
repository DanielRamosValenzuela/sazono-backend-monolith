import {
  mapMercadoPagoOrderStatus,
  mapMercadoPagoStatus,
} from './mercado-pago-status';

describe('mapMercadoPagoStatus', () => {
  it('maps approved to APPROVED without a failure reason', () => {
    expect(mapMercadoPagoStatus('approved')).toEqual({ outcome: 'APPROVED' });
  });

  it('maps in_process to PENDING', () => {
    expect(mapMercadoPagoStatus('in_process').outcome).toBe('PENDING');
  });

  it('maps pending to PENDING', () => {
    expect(mapMercadoPagoStatus('pending').outcome).toBe('PENDING');
  });

  it('maps authorized to PENDING', () => {
    expect(mapMercadoPagoStatus('authorized').outcome).toBe('PENDING');
  });

  it('maps rejected to REJECTED with a readable message for a known status_detail', () => {
    expect(
      mapMercadoPagoStatus('rejected', 'cc_rejected_insufficient_amount'),
    ).toEqual({
      outcome: 'REJECTED',
      failureReason: 'La tarjeta no tiene saldo suficiente.',
    });
  });

  it('maps rejected to REJECTED with a generic message when status_detail is unknown', () => {
    expect(mapMercadoPagoStatus('rejected', 'some_unmapped_detail')).toEqual({
      outcome: 'REJECTED',
      failureReason: 'El medio de pago rechazo el cobro, intenta con otro.',
    });
  });

  it('maps cancelled to REJECTED', () => {
    expect(mapMercadoPagoStatus('cancelled').outcome).toBe('REJECTED');
  });

  it('normalizes the status casing before matching', () => {
    expect(mapMercadoPagoStatus('APPROVED')).toEqual({ outcome: 'APPROVED' });
  });
});

describe('mapMercadoPagoOrderStatus', () => {
  it('maps processed to APPROVED', () => {
    expect(mapMercadoPagoOrderStatus('processed')).toEqual({
      outcome: 'APPROVED',
    });
  });

  it.each(['created', 'processing', 'action_required'])(
    'maps %s to PENDING',
    (status) => {
      expect(mapMercadoPagoOrderStatus(status).outcome).toBe('PENDING');
    },
  );

  it.each(['failed', 'canceled', 'expired'])(
    'maps %s to REJECTED',
    (status) => {
      expect(mapMercadoPagoOrderStatus(status).outcome).toBe('REJECTED');
    },
  );

  it('uses the status detail message when rejected', () => {
    expect(
      mapMercadoPagoOrderStatus('failed', 'cc_rejected_insufficient_amount')
        .failureReason,
    ).toBe('La tarjeta no tiene saldo suficiente.');
  });

  it.each(['refunded', 'charged_back'])(
    'handles %s explicitly without REJECTED',
    (status) => {
      const mapping = mapMercadoPagoOrderStatus(status);

      expect(mapping.outcome).toBe('PENDING');
      expect(mapping.failureReason).not.toBe(
        mapMercadoPagoOrderStatus('processing').failureReason,
      );
    },
  );

  it('normalizes casing', () => {
    expect(mapMercadoPagoOrderStatus('PROCESSED').outcome).toBe('APPROVED');
  });
});
