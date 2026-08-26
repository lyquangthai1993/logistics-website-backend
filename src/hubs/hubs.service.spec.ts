import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HubsService } from './hubs.service';
import { HubEntity } from './infrastructure/persistence/relational/entities/hub.entity';
import { VehicleEntity } from '../vehicles/infrastructure/persistence/relational/entities/vehicle.entity';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('HubsService', () => {
  let service: HubsService;
  let hubRepo: jest.Mocked<Repository<HubEntity>>;
  let vehicleRepo: jest.Mocked<Repository<VehicleEntity>>;

  const mockHub: HubEntity = {
    id: 1,
    code: 'HUB-HAN-01',
    name: 'Andromeda Hub (Hà Nội)',
    city: 'Hà Nội',
    address: 'KCN Bắc Thăng Long, Hà Nội',
    contactPhone: '024-3886-1234',
    managerName: 'Nguyễn Văn Quản',
    isActive: true,
    vehicles: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as any;

  beforeEach(async () => {
    const mockQb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[mockHub], 1]),
    };

    const mockHubRepo = {
      create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 1 })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
      softRemove: jest.fn().mockResolvedValue(true),
    };

    const mockVehicleRepo = {
      count: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HubsService,
        {
          provide: getRepositoryToken(HubEntity),
          useValue: mockHubRepo,
        },
        {
          provide: getRepositoryToken(VehicleEntity),
          useValue: mockVehicleRepo,
        },
      ],
    }).compile();

    service = module.get<HubsService>(HubsService);
    hubRepo = module.get(getRepositoryToken(HubEntity));
    vehicleRepo = module.get(getRepositoryToken(VehicleEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully create a new hub', async () => {
      hubRepo.findOne.mockResolvedValue(null);
      const dto = {
        code: 'HUB-NEW-01',
        name: 'New Hub',
        city: 'Hải Phòng',
      };

      const result = await service.create(dto);
      expect(hubRepo.create).toHaveBeenCalledWith(dto);
      expect(result).toBeDefined();
    });

    it('should successfully create a new hub with randomly generated data', async () => {
      hubRepo.findOne.mockResolvedValue(null);

      const randomSuffix = Math.random()
        .toString(36)
        .substring(2, 7)
        .toUpperCase();
      const cities = [
        'Hải Phòng',
        'Đà Nẵng',
        'Cần Thơ',
        'Bình Dương',
        'Đồng Nai',
        'Nha Trang',
      ];
      const randomCity = cities[Math.floor(Math.random() * cities.length)];
      const randomPhone = `09${Math.floor(10000000 + Math.random() * 90000000)}`;

      const randomDto = {
        code: `HUB-RND-${randomSuffix}`,
        name: `Kho Vận Tự Động ${randomCity} #${randomSuffix}`,
        city: randomCity,
        address: `Số ${Math.floor(Math.random() * 500) + 1} Đường Hậu Cần, ${randomCity}`,
        contactPhone: randomPhone,
        managerName: `Trưởng kho ${randomSuffix}`,
      };

      const result = await service.create(randomDto);

      expect(hubRepo.create).toHaveBeenCalledWith(randomDto);
      expect(result).toBeDefined();
      expect(result.code).toBe(randomDto.code);
      expect(result.name).toBe(randomDto.name);
    });

    it('should throw ConflictException if hub code already exists', async () => {
      hubRepo.findOne.mockResolvedValue(mockHub);
      const dto = {
        code: 'HUB-HAN-01',
        name: 'Duplicate Hub',
        city: 'Hà Nội',
      };

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return paginated result', async () => {
      const result = await service.findAll({ page: 1, limit: 10 });
      expect(result.data).toEqual([mockHub]);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(10);
      expect(result.meta.totalPages).toBe(1);
    });
  });

  describe('findOne', () => {
    it('should return hub when found', async () => {
      hubRepo.findOne.mockResolvedValue(mockHub);
      const result = await service.findOne(1);
      expect(result).toEqual(mockHub);
    });

    it('should throw NotFoundException when hub not found', async () => {
      hubRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('toggleActive', () => {
    it('should flip isActive boolean from true to false', async () => {
      hubRepo.findOne.mockResolvedValue({ ...mockHub, isActive: true } as any);
      const result = await service.toggleActive(1);
      expect(result.isActive).toBe(false);
      expect(hubRepo.save).toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('should soft delete and set isActive = false', async () => {
      hubRepo.findOne.mockResolvedValue({ ...mockHub } as any);
      vehicleRepo.count.mockResolvedValue(2);

      const result = await service.softDelete(1);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Đã xóa mềm Hub');
      expect(result.message).toContain('Có 2 phương tiện');
      expect(hubRepo.softRemove).toHaveBeenCalled();
    });
  });
});
