import { normalizeRegion, RegionEnum } from './region-normalizer.util';

describe('RegionNormalizer', () => {
  it('should map Northern provinces to MIỀN BẮC', () => {
    expect(normalizeRegion('Hà Nội').region).toBe(RegionEnum.NORTH);
    expect(normalizeRegion('TP. Hà Nội').region).toBe(RegionEnum.NORTH);
    expect(normalizeRegion('Hải Phòng').region).toBe(RegionEnum.NORTH);
    expect(normalizeRegion('Tỉnh Quảng Ninh').region).toBe(RegionEnum.NORTH);
    expect(normalizeRegion('Bắc Ninh').region).toBe(RegionEnum.NORTH);
  });

  it('should map Central & Western Highlands provinces to MIỀN TRUNG', () => {
    expect(normalizeRegion('Thanh Hoá').region).toBe(RegionEnum.CENTRAL);
    expect(normalizeRegion('THANH HÓA').region).toBe(RegionEnum.CENTRAL);
    expect(normalizeRegion('Đà Nẵng').region).toBe(RegionEnum.CENTRAL);
    expect(normalizeRegion('Huế').region).toBe(RegionEnum.CENTRAL);
    expect(normalizeRegion('TP. Huế').region).toBe(RegionEnum.CENTRAL);
    expect(normalizeRegion('Đà Lạt').region).toBe(RegionEnum.CENTRAL);
    expect(normalizeRegion('Gia Lai').region).toBe(RegionEnum.CENTRAL);
    expect(normalizeRegion('Đắk Lắk').region).toBe(RegionEnum.CENTRAL);
  });

  it('should map Southern and ALL Western (Mekong Delta) provinces to MIỀN NAM', () => {
    // Đông Nam Bộ
    expect(normalizeRegion('TP. Hồ Chí Minh').region).toBe(RegionEnum.SOUTH);
    expect(normalizeRegion('hcm').region).toBe(RegionEnum.SOUTH);
    expect(normalizeRegion('Bình Dương').region).toBe(RegionEnum.SOUTH);
    expect(normalizeRegion('Đồng Nai').region).toBe(RegionEnum.SOUTH);
    expect(normalizeRegion('Vũng Tàu').region).toBe(RegionEnum.SOUTH);

    // Tây Nam Bộ (Miền Tây gộp vào Miền Nam)
    expect(normalizeRegion('Cần Thơ').region).toBe(RegionEnum.SOUTH);
    expect(normalizeRegion('TP. Cần Thơ').region).toBe(RegionEnum.SOUTH);
    expect(normalizeRegion('Cà Mau').region).toBe(RegionEnum.SOUTH);
    expect(normalizeRegion('Tỉnh Cà Mau').region).toBe(RegionEnum.SOUTH);
    expect(normalizeRegion('Long An').region).toBe(RegionEnum.SOUTH);
    expect(normalizeRegion('Tiền Giang').region).toBe(RegionEnum.SOUTH);
    expect(normalizeRegion('An Giang').region).toBe(RegionEnum.SOUTH);
    expect(normalizeRegion('Kiên Giang').region).toBe(RegionEnum.SOUTH);
  });

  it('should fallback to N/A for unknown or invalid text', () => {
    expect(normalizeRegion(null).region).toBe(RegionEnum.NA);
    expect(normalizeRegion('').region).toBe(RegionEnum.NA);
    expect(normalizeRegion('Nơi Kỳ Lạ 123456').region).toBe(RegionEnum.NA);
  });
});
