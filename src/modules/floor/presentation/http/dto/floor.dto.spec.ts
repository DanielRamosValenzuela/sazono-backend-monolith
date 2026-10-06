import { plainToInstance } from 'class-transformer';
import { ListCounterSessionsQueryDto } from './floor.dto';

describe('ListCounterSessionsQueryDto', () => {
  const parse = (mine?: string) =>
    plainToInstance(
      ListCounterSessionsQueryDto,
      { branchId: 'b', mine },
      { enableImplicitConversion: true },
    ).mine;

  it('parses mine from the raw query string', () => {
    expect(parse('true')).toBe(true);
    expect(parse('false')).toBe(false);
    expect(parse(undefined)).toBeUndefined();
  });
});
