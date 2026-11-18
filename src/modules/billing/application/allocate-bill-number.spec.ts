import { allocateBillNumber } from './allocate-bill-number';

describe('allocateBillNumber', () => {
  it('returns the sequence value produced by the branch update', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ bill_sequence: 42 }]);

    await expect(
      allocateBillNumber({ $queryRaw: queryRaw }, 'branch-1'),
    ).resolves.toBe(42);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('hands out consecutive numbers without gaps when each call commits', async () => {
    let sequence = 0;
    const queryRaw = jest.fn().mockImplementation(() => {
      sequence += 1;
      return Promise.resolve([{ bill_sequence: sequence }]);
    });
    const tx = { $queryRaw: queryRaw };

    const numbers = [
      await allocateBillNumber(tx, 'branch-1'),
      await allocateBillNumber(tx, 'branch-1'),
      await allocateBillNumber(tx, 'branch-1'),
    ];

    expect(numbers).toEqual([1, 2, 3]);
  });

  it('fails when the branch does not exist', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);

    await expect(
      allocateBillNumber({ $queryRaw: queryRaw }, 'missing'),
    ).rejects.toThrow('not found');
  });
});
