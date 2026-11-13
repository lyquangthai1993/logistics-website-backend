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
  return cleaned.trim();
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

// Map lookup tối ưu O(1) theo không dấu
const LOOKUP_MAP = new Map<string, ProvinceDefinition>();

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

  if (normalizedKey === 'luu kho' || normalizedKey === 'luu tai kho') {
    return {
      region: RegionEnum.STORAGE,
      provinceName: 'Lưu Kho',
      isRecognized: true,
    };
  }

  // 1. Kiểm tra khớp chính xác trong Lookup Map
  const directMatch = LOOKUP_MAP.get(normalizedKey);
  if (directMatch) {
    return {
      region: directMatch.region,
      provinceName: directMatch.standardName,
      isRecognized: true,
    };
  }

  // 2. Kiểm tra chuỗi chứa (Sub-string match) nếu người dùng gõ có kèm quận/huyện
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
