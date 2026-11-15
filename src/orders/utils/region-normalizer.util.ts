/**
 * backend/src/orders/utils/region-normalizer.util.ts
 *
 * Chuẩn hóa Tỉnh/Thành Việt Nam & Phân Loại 3 Trục Miền Vận Tải Chính Thức:
 * - MIỀN BẮC (25 Tỉnh/Thành)
 * - MIỀN TRUNG (19 Tỉnh/Thành - gồm Duyên Hải & Tây Nguyên)
 * - MIỀN NAM (19 Tỉnh/Thành - Đông Nam Bộ & Tây Nam Bộ/Miền Tây gộp chung)
 * - N/A (Chưa phân miền / không khớp)
 */

export enum RegionEnum {
  NORTH = 'MIỀN BẮC',
  CENTRAL = 'MIỀN TRUNG',
  SOUTH = 'MIỀN NAM',
  STORAGE = 'LƯU KHO',
  NA = 'N/A',
}

export interface RegionResolveResult {
  region: RegionEnum;
  provinceName: string;
  isRecognized: boolean;
}

/**
 * Bỏ dấu tiếng Việt và ký tự đặc biệt để so sánh chuỗi linh hoạt
 */
export function removeVietnameseAccents(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Làm sạch chuỗi đầu vào (bỏ tiền tố hành chính: Tỉnh, TP., Thị xã...)
 */
export function sanitizeProvinceString(input: string): string {
  if (!input) return '';
  let cleaned = input.trim();

  // Bỏ các tiền tố hành chính phổ biến
  cleaned = cleaned.replace(
    /^(thành phố|thanh pho|tp\.|tp|tỉnh|tinh|thị xã|thi xa|tx\.|tx)\s+/i,
    '',
  );
  return cleaned.replace(/\s+/g, ' ').trim();
}

interface ProvinceDefinition {
  standardName: string;
  region: RegionEnum;
  aliases: string[];
}

const PROVINCE_DEFINITIONS: ProvinceDefinition[] = [
  // ==========================================
  // 1. MIỀN BẮC (25 TỈNH/THÀNH)
  // ==========================================
  {
    standardName: 'Hà Nội',
    region: RegionEnum.NORTH,
    aliases: ['ha noi', 'hn', 'thu do', 'thu do ha noi'],
  },
  {
    standardName: 'Hải Phòng',
    region: RegionEnum.NORTH,
    aliases: ['hai phong', 'hp'],
  },
  {
    standardName: 'Quảng Ninh',
    region: RegionEnum.NORTH,
    aliases: ['quang ninh', 'qn', 'ha long', 'cam pha', 'uong bi', 'mong cai'],
  },
  {
    standardName: 'Bắc Ninh',
    region: RegionEnum.NORTH,
    aliases: ['bac ninh', 'bn'],
  },
  {
    standardName: 'Hải Dương',
    region: RegionEnum.NORTH,
    aliases: ['hai duong', 'hd'],
  },
  {
    standardName: 'Hưng Yên',
    region: RegionEnum.NORTH,
    aliases: ['hung yen', 'hy'],
  },
  {
    standardName: 'Vĩnh Phúc',
    region: RegionEnum.NORTH,
    aliases: ['vinh phuc', 'vp', 'vinh yen'],
  },
  {
    standardName: 'Thái Bình',
    region: RegionEnum.NORTH,
    aliases: ['thai binh', 'tb'],
  },
  {
    standardName: 'Nam Định',
    region: RegionEnum.NORTH,
    aliases: ['nam dinh', 'nd'],
  },
  {
    standardName: 'Hà Nam',
    region: RegionEnum.NORTH,
    aliases: ['ha nam', 'phu ly'],
  },
  {
    standardName: 'Ninh Bình',
    region: RegionEnum.NORTH,
    aliases: ['ninh binh', 'nb'],
  },
  {
    standardName: 'Hà Giang',
    region: RegionEnum.NORTH,
    aliases: ['ha giang', 'hg'],
  },
  {
    standardName: 'Cao Bằng',
    region: RegionEnum.NORTH,
    aliases: ['cao bang', 'cb'],
  },
  {
    standardName: 'Bắc Kạn',
    region: RegionEnum.NORTH,
    aliases: ['bac kan', 'bac can', 'bk'],
  },
  {
    standardName: 'Tuyên Quang',
    region: RegionEnum.NORTH,
    aliases: ['tuyen quang', 'tq'],
  },
  {
    standardName: 'Lào Cai',
    region: RegionEnum.NORTH,
    aliases: ['lao cai', 'lc', 'sa pa', 'sapa'],
  },
  {
    standardName: 'Yên Bái',
    region: RegionEnum.NORTH,
    aliases: ['yen bai', 'yb'],
  },
  {
    standardName: 'Thái Nguyên',
    region: RegionEnum.NORTH,
    aliases: ['thai nguyen', 'tn'],
  },
  {
    standardName: 'Lạng Sơn',
    region: RegionEnum.NORTH,
    aliases: ['lang son', 'ls'],
  },
  {
    standardName: 'Bắc Giang',
    region: RegionEnum.NORTH,
    aliases: ['bac giang', 'bg'],
  },
  {
    standardName: 'Phú Thọ',
    region: RegionEnum.NORTH,
    aliases: ['phu tho', 'pt', 'viet tri'],
  },
  {
    standardName: 'Điện Biên',
    region: RegionEnum.NORTH,
    aliases: ['dien bien', 'db', 'dien bien phu'],
  },
  { standardName: 'Lai Châu', region: RegionEnum.NORTH, aliases: ['lai chau'] },
  {
    standardName: 'Sơn La',
    region: RegionEnum.NORTH,
    aliases: ['son la', 'sl', 'moc chau'],
  },
  {
    standardName: 'Hòa Bình',
    region: RegionEnum.NORTH,
    aliases: ['hoa binh', 'hb'],
  },

  // ==========================================
  // 2. MIỀN TRUNG & TÂY NGUYÊN (19 TỈNH/THÀNH)
  // ==========================================
  {
    standardName: 'Thanh Hóa',
    region: RegionEnum.CENTRAL,
    aliases: ['thanh hoa', 'th'],
  },
  {
    standardName: 'Nghệ An',
    region: RegionEnum.CENTRAL,
    aliases: ['nghe an', 'na', 'vinh'],
  },
  {
    standardName: 'Hà Tĩnh',
    region: RegionEnum.CENTRAL,
    aliases: ['ha tinh', 'ht'],
  },
  {
    standardName: 'Quảng Bình',
    region: RegionEnum.CENTRAL,
    aliases: ['quang binh', 'qb', 'dong hoi'],
  },
  {
    standardName: 'Quảng Trị',
    region: RegionEnum.CENTRAL,
    aliases: ['quang tri', 'qt', 'dong ha'],
  },
  {
    standardName: 'Thừa Thiên Huế',
    region: RegionEnum.CENTRAL,
    aliases: ['thua thien hue', 'thua thien - hue', 'hue', 'tth'],
  },
  {
    standardName: 'Đà Nẵng',
    region: RegionEnum.CENTRAL,
    aliases: ['da nang', 'dn'],
  },
  {
    standardName: 'Quảng Nam',
    region: RegionEnum.CENTRAL,
    aliases: ['quang nam', 'qnam', 'hoi an', 'tam ky'],
  },
  {
    standardName: 'Quảng Ngãi',
    region: RegionEnum.CENTRAL,
    aliases: ['quang ngai', 'qngai', 'qng'],
  },
  {
    standardName: 'Bình Định',
    region: RegionEnum.CENTRAL,
    aliases: ['binh dinh', 'bdinh', 'quy nhon'],
  },
  {
    standardName: 'Phú Yên',
    region: RegionEnum.CENTRAL,
    aliases: ['phu yen', 'py', 'tuy hoa'],
  },
  {
    standardName: 'Khánh Hòa',
    region: RegionEnum.CENTRAL,
    aliases: ['khanh hoa', 'kh', 'nha trang', 'cam ranh'],
  },
  {
    standardName: 'Ninh Thuận',
    region: RegionEnum.CENTRAL,
    aliases: ['ninh thuan', 'nt', 'phan rang'],
  },
  {
    standardName: 'Bình Thuận',
    region: RegionEnum.CENTRAL,
    aliases: ['binh thuan', 'bt', 'phan thiet'],
  },
  {
    standardName: 'Kon Tum',
    region: RegionEnum.CENTRAL,
    aliases: ['kon tum', 'kontum', 'kt'],
  },
  {
    standardName: 'Gia Lai',
    region: RegionEnum.CENTRAL,
    aliases: ['gia lai', 'gl', 'pleiku'],
  },
  {
    standardName: 'Đắk Lắk',
    region: RegionEnum.CENTRAL,
    aliases: ['dak lak', 'dac lac', 'daklak', 'buon ma thuot', 'bmt'],
  },
  {
    standardName: 'Đắk Nông',
    region: RegionEnum.CENTRAL,
    aliases: ['dak nong', 'dac nong', 'daknong', 'gia nghia'],
  },
  {
    standardName: 'Lâm Đồng',
    region: RegionEnum.CENTRAL,
    aliases: ['lam dong', 'ld', 'da lat', 'bao loc'],
  },

  // ==========================================
  // 3. MIỀN NAM (19 TỈNH/THÀNH: ĐÔNG NAM BỘ + TÂY NAM BỘ / MIỀN TÂY)
  // ==========================================
  // Đông Nam Bộ:
  {
    standardName: 'TP. Hồ Chí Minh',
    region: RegionEnum.SOUTH,
    aliases: [
      'ho chi minh',
      'hcm',
      'tphcm',
      'tp hcm',
      'tp.hcm',
      'sai gon',
      'saigon',
      'sg',
    ],
  },
  {
    standardName: 'Bình Dương',
    region: RegionEnum.SOUTH,
    aliases: [
      'binh duong',
      'bd',
      'thu dau mot',
      'di an',
      'thuan an',
      'ben cat',
      'tan uyen',
    ],
  },
  {
    standardName: 'Đồng Nai',
    region: RegionEnum.SOUTH,
    aliases: [
      'dong nai',
      'dnai',
      'dn',
      'bien hoa',
      'long khanh',
      'long thanh',
      'nhon trach',
      'trang bom',
      'vinh cuu',
      'dinh quan',
      'xuan loc',
      'thong nhat',
      'cam my',
      'tan phu',
    ],
  },
  {
    standardName: 'Bà Rịa - Vũng Tàu',
    region: RegionEnum.SOUTH,
    aliases: [
      'ba ria - vung tau',
      'ba ria vung tau',
      'ba ria',
      'vung tau',
      'brvt',
      'vt',
    ],
  },
  {
    standardName: 'Tây Ninh',
    region: RegionEnum.SOUTH,
    aliases: ['tay ninh', 'tn'],
  },
  {
    standardName: 'Bình Phước',
    region: RegionEnum.SOUTH,
    aliases: ['binh phuoc', 'bp', 'dong xoai'],
  },
  // Tây Nam Bộ (Miền Tây gộp vào Miền Nam):
  {
    standardName: 'Long An',
    region: RegionEnum.SOUTH,
    aliases: ['long an', 'la', 'tan an'],
  },
  {
    standardName: 'Tiền Giang',
    region: RegionEnum.SOUTH,
    aliases: ['tien giang', 'tg', 'my tho'],
  },
  {
    standardName: 'Bến Tre',
    region: RegionEnum.SOUTH,
    aliases: ['ben tre', 'btre'],
  },
  {
    standardName: 'Trà Vinh',
    region: RegionEnum.SOUTH,
    aliases: ['tra vinh', 'tv'],
  },
  {
    standardName: 'Vĩnh Long',
    region: RegionEnum.SOUTH,
    aliases: ['vinh long', 'vl'],
  },
  {
    standardName: 'Đồng Tháp',
    region: RegionEnum.SOUTH,
    aliases: ['dong thap', 'dt', 'cao lanh', 'sa dec'],
  },
  {
    standardName: 'An Giang',
    region: RegionEnum.SOUTH,
    aliases: ['an giang', 'ag', 'long xuyen', 'chau doc'],
  },
  {
    standardName: 'Kiên Giang',
    region: RegionEnum.SOUTH,
    aliases: ['kien giang', 'kg', 'rach gia', 'phu quoc', 'ha tien'],
  },
  {
    standardName: 'Cần Thơ',
    region: RegionEnum.SOUTH,
    aliases: ['can tho', 'ct'],
  },
  {
    standardName: 'Hậu Giang',
    region: RegionEnum.SOUTH,
    aliases: ['hau giang', 'hg', 'vi thanh'],
  },
  {
    standardName: 'Sóc Trăng',
    region: RegionEnum.SOUTH,
    aliases: ['soc trang', 'st'],
  },
  {
    standardName: 'Bạc Liêu',
    region: RegionEnum.SOUTH,
    aliases: ['bac lieu', 'bl'],
  },
  {
    standardName: 'Cà Mau',
    region: RegionEnum.SOUTH,
    aliases: ['ca mau', 'cm'],
  },
];

/**
 * Authoritative province/region source: `danh sach tỉnh thành.xlsx`, Sheet1.
 * The workbook labels the Mekong Delta as `MIỀN TÂY`; the report contract
 * intentionally rolls that label into `MIỀN NAM`.
 */
const EXCEL_PROVINCE_REGION_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['Hà Nội', 'MIỀN BẮC'],
  ['Vĩnh Phúc', 'MIỀN BẮC'],
  ['Bắc Ninh', 'MIỀN BẮC'],
  ['Quảng Ninh', 'MIỀN BẮC'],
  ['Hải Dương', 'MIỀN BẮC'],
  ['Hải Phòng', 'MIỀN BẮC'],
  ['Hưng Yên', 'MIỀN BẮC'],
  ['Thái Bình', 'MIỀN BẮC'],
  ['Hà Nam', 'MIỀN BẮC'],
  ['Nam Định', 'MIỀN BẮC'],
  ['Ninh Bình', 'MIỀN BẮC'],
  ['Hà Giang', 'MIỀN BẮC'],
  ['Cao Bằng', 'MIỀN BẮC'],
  ['Bắc Kạn', 'MIỀN BẮC'],
  ['Tuyên Quang', 'MIỀN BẮC'],
  ['Lào Cai', 'MIỀN BẮC'],
  ['Yên Bái', 'MIỀN BẮC'],
  ['Thái Nguyên', 'MIỀN BẮC'],
  ['Lạng Sơn', 'MIỀN BẮC'],
  ['Bắc Giang', 'MIỀN BẮC'],
  ['Phú Thọ', 'MIỀN BẮC'],
  ['Điện Biên', 'MIỀN BẮC'],
  ['Lai Châu', 'MIỀN BẮC'],
  ['Sơn La', 'MIỀN BẮC'],
  ['Hoà Bình', 'MIỀN BẮC'],
  ['Thanh Hoá', 'MIỀN TRUNG'],
  ['Nghệ An', 'MIỀN TRUNG'],
  ['Hà Tĩnh', 'MIỀN TRUNG'],
  ['Quảng Bình', 'MIỀN TRUNG'],
  ['Quảng Trị', 'MIỀN TRUNG'],
  ['Thừa Thiên Huế', 'MIỀN TRUNG'],
  ['Đà Nẵng', 'MIỀN TRUNG'],
  ['Quảng Nam', 'MIỀN TRUNG'],
  ['Quảng Ngãi', 'MIỀN TRUNG'],
  ['Bình Định', 'MIỀN TRUNG'],
  ['Phú Yên', 'MIỀN TRUNG'],
  ['Khánh Hòa', 'MIỀN TRUNG'],
  ['Ninh Thuận', 'MIỀN TRUNG'],
  ['Bình Thuận', 'MIỀN TRUNG'],
  ['Kon Tum', 'MIỀN TRUNG'],
  ['Gia Lai', 'MIỀN TRUNG'],
  ['Đắk Lắk', 'MIỀN TRUNG'],
  ['Đắk Nông', 'MIỀN TRUNG'],
  ['Lâm Đồng', 'MIỀN TRUNG'],
  ['Bình Phước', 'MIỀN NAM'],
  ['Tây Ninh', 'MIỀN NAM'],
  ['Bình Dương', 'MIỀN NAM'],
  ['Đồng Nai', 'MIỀN NAM'],
  ['Bà Rịa', 'MIỀN NAM'],
  ['hcm', 'MIỀN NAM'],
  ['Long An', 'MIỀN TÂY'],
  ['Tiền Giang', 'MIỀN TÂY'],
  ['Bến Tre', 'MIỀN TÂY'],
  ['Trà Vinh', 'MIỀN TÂY'],
  ['Vĩnh Long', 'MIỀN TÂY'],
  ['Đồng Tháp', 'MIỀN TÂY'],
  ['An Giang', 'MIỀN TÂY'],
  ['Kiên Giang', 'MIỀN TÂY'],
  ['Cần Thơ', 'MIỀN TÂY'],
  ['Hậu Giang', 'MIỀN TÂY'],
  ['Sóc Trăng', 'MIỀN TÂY'],
  ['Bạc Liêu', 'MIỀN TÂY'],
  ['Cà Mau', 'MIỀN TÂY'],
  ['Khánh Hoà', 'MIỀN TRUNG'],
  ['Huế', 'MIỀN TRUNG'],
  ['Vũng Tàu', 'MIỀN NAM'],
  ['Đà Lạt', 'MIỀN TRUNG'],
  ['THANH HÓA', 'MIỀN TRUNG'],
  ['TP. Hồ Chí Minh', 'MIỀN NAM'],
  ['Tỉnh Đồng Nai', 'MIỀN NAM'],
  ['Tỉnh Cà Mau', 'MIỀN NAM'],
  ['TP. Hà Nội', 'MIỀN BẮC'],
  ['Tỉnh Tây Ninh', 'MIỀN NAM'],
  ['TP. Huế', 'MIỀN TRUNG'],
  ['Tỉnh Gia Lai', 'MIỀN TRUNG'],
  ['TP. Cần Thơ', 'MIỀN NAM'],
  ['Tỉnh Quảng Ngãi', 'MIỀN TRUNG'],
  ['Tỉnh Khánh Hòa', 'MIỀN TRUNG'],
  ['TP. Hải Phòng', 'MIỀN BẮC'],
];

// Map lookup tối ưu O(1) theo không dấu
const LOOKUP_MAP = new Map<string, ProvinceDefinition>();

const EXCEL_LOOKUP_MAP = new Map<string, ProvinceDefinition>();

function toReportRegion(excelRegion: string): RegionEnum {
  return excelRegion === 'MIỀN TÂY'
    ? RegionEnum.SOUTH
    : (excelRegion as RegionEnum);
}

for (const [provinceName, excelRegion] of EXCEL_PROVINCE_REGION_ROWS) {
  const key = removeVietnameseAccents(sanitizeProvinceString(provinceName));
  if (!EXCEL_LOOKUP_MAP.has(key)) {
    EXCEL_LOOKUP_MAP.set(key, {
      standardName: provinceName,
      region: toReportRegion(excelRegion),
      aliases: [],
    });
  }
}

for (const prov of PROVINCE_DEFINITIONS) {
  const normStandard = removeVietnameseAccents(prov.standardName);
  LOOKUP_MAP.set(normStandard, prov);
  for (const alias of prov.aliases) {
    LOOKUP_MAP.set(removeVietnameseAccents(alias), prov);
  }
}

/**
 * Tự động phân giải Tỉnh/Thành thành Miền (Bắc / Trung / Nam / N/A)
 */
export function normalizeRegion(
  input: string | null | undefined,
): RegionResolveResult {
  if (!input || !input.trim()) {
    return {
      region: RegionEnum.NA,
      provinceName: '',
      isRecognized: false,
    };
  }

  const rawCleaned = sanitizeProvinceString(input);
  const normalizedKey = removeVietnameseAccents(rawCleaned);

  if (/^(?:luu|gui)(?: tai| vao)? kho$/.test(normalizedKey)) {
    return {
      region: RegionEnum.STORAGE,
      provinceName: normalizedKey.startsWith('gui') ? 'Gửi Kho' : 'Lưu Kho',
      isRecognized: true,
    };
  }

  // 1. Excel là nguồn chuẩn; miền Tây được quy đổi thành miền Nam theo contract.
  const excelMatch = EXCEL_LOOKUP_MAP.get(normalizedKey);
  if (excelMatch) {
    return {
      region: excelMatch.region,
      provinceName: excelMatch.standardName,
      isRecognized: true,
    };
  }

  // 2. Giữ alias cũ để tương thích dữ liệu lịch sử không có trong Excel.
  const directMatch = LOOKUP_MAP.get(normalizedKey);
  if (directMatch) {
    return {
      region: directMatch.region,
      provinceName: directMatch.standardName,
      isRecognized: true,
    };
  }

  // 3. Kiểm tra chuỗi chứa nếu người dùng gõ kèm địa chỉ/quận/huyện.
  const excelSubstringMatch = [...EXCEL_LOOKUP_MAP.entries()]
    .filter(([key]) => key.length >= 3)
    .sort(([a], [b]) => b.length - a.length)
    .find(([key]) => normalizedKey.includes(key));
  if (excelSubstringMatch) {
    const [, province] = excelSubstringMatch;
    return {
      region: province.region,
      provinceName: province.standardName,
      isRecognized: true,
    };
  }

  // 4. Alias cũ cho dữ liệu lịch sử có kèm quận/huyện.
  // Ví dụ: "Quận 1, TP.HCM", "Nha Trang, Khánh Hòa", "Bến Lức, Long An"
  for (const [key, prov] of LOOKUP_MAP.entries()) {
    if (
      key.length >= 3 &&
      (normalizedKey.includes(key) || key.includes(normalizedKey))
    ) {
      return {
        region: prov.region,
        provinceName: prov.standardName,
        isRecognized: true,
      };
    }
  }

  // 3. Không nhận diện được -> Gán N/A
  return {
    region: RegionEnum.NA,
    provinceName: input.trim(),
    isRecognized: false,
  };
}

/**
 * Canonical value stored in `order.province` before `destinationRegion` is set.
 * Known values become the first canonical spelling from the Excel source;
 * unknown values still receive safe whitespace/prefix cleanup for auditability.
 */
export function normalizeProvinceInput(
  input: string | null | undefined,
): string | null {
  if (!input || !input.trim()) return null;
  const cleaned = sanitizeProvinceString(input);
  const resolved = normalizeRegion(cleaned);
  return resolved.isRecognized ? resolved.provinceName : cleaned;
}
