import {
  classifyFailure,
  describeError,
  parseRetryAfterMs,
  readReplayToken,
} from './openfactura.errors';

const ofError = (code: string, message: string, details: unknown[] = []) => ({
  error: { code, message, details },
});

describe('classifyFailure', () => {
  it('treats network failures as retryable', () => {
    expect(classifyFailure({ status: 0, body: {} }, 'EMIT')).toMatchObject({
      retryable: true,
      code: 'NETWORK',
    });
  });

  it('treats 429 as retryable and reads the retry-after seconds', () => {
    const failure = classifyFailure(
      {
        status: 429,
        body: { message: 'Rate limit is exceeded. Try again in 2 seconds.' },
      },
      'EMIT',
    );

    expect(failure).toMatchObject({
      retryable: true,
      code: 'RATE_LIMITED',
      retryAfterMs: 2000,
    });
  });

  it('treats 5xx as retryable', () => {
    expect(
      classifyFailure(
        { status: 500, body: ofError('OF-22', 'Problema al procesar') },
        'EMIT',
      ),
    ).toMatchObject({ retryable: true, code: 'OF-22' });
  });

  it('flags auth failures as retryable so a new key can recover them', () => {
    const failure = classifyFailure(
      {
        status: 401,
        body: { statusCode: 401, message: 'Access denied due to invalid key' },
      },
      'EMIT',
    );

    expect(failure).toMatchObject({ retryable: true, auth: true });
  });

  it('treats validation errors as permanent with the field details', () => {
    const failure = classifyFailure(
      {
        status: 400,
        body: ofError('OF-10', 'Validacion de Campos', [
          { field: 'MntNeto', issue: 'Monto erroneo : 8403/5042' },
        ]),
      },
      'EMIT',
    );

    expect(failure.retryable).toBe(false);
    expect(failure.code).toBe('OF-10');
    expect(failure.message).toContain('MntNeto: Monto erroneo');
  });

  it('retries a 400 OF-22 and a 404 on status calls only', () => {
    expect(
      classifyFailure(
        { status: 400, body: ofError('OF-22', 'Posible error en el folio') },
        'STATUS',
      ).retryable,
    ).toBe(true);
    expect(classifyFailure({ status: 404, body: {} }, 'STATUS').retryable).toBe(
      true,
    );
    expect(classifyFailure({ status: 404, body: {} }, 'EMIT').retryable).toBe(
      false,
    );
  });
});

describe('helpers', () => {
  it('reads the replay token of an OF-06 error', () => {
    expect(
      readReplayToken(
        ofError('OF-06', 'ya emitido', [{ field: 'token', issue: 'abc' }]),
      ),
    ).toBe('abc');
    expect(readReplayToken(ofError('OF-08', 'x'))).toBeNull();
  });

  it('parses the retry-after message', () => {
    expect(parseRetryAfterMs({ message: 'Try again in 1 seconds.' })).toBe(
      1000,
    );
    expect(parseRetryAfterMs({ message: 'other' })).toBeNull();
  });

  it('bounds the length of the described error', () => {
    expect(describeError({ message: 'x'.repeat(2000) }).length).toBe(500);
  });
});
