import { ProvinceReferenceService } from './province-reference.service';

describe('ProvinceReferenceService', () => {
  it('should resolve canonical names, aliases, and embedded address provinces', async () => {
    const service = new ProvinceReferenceService({
      find: jest.fn().mockResolvedValue([
        {
          name: 'Đà Nẵng',
          normalizedName: 'da nang',
          region: 'MIỀN TRUNG',
          aliases: ['TP Đà Nẵng'],
        },
      ]),
    } as never);

    const lookup = await service.getRegionLookup();

    expect(service.resolveRegion('TP Đà Nẵng', lookup)).toBe('MIỀN TRUNG');
    expect(service.resolveRegion('Quận Hải Châu, TP. Đà Nẵng', lookup)).toBe(
      'MIỀN TRUNG',
    );
  });
});
