import { NestFactory } from '@nestjs/core';
import { RoleSeedService } from './role/role-seed.service';
import { SeedModule } from './seed.module';
import { StatusSeedService } from './status/status-seed.service';
import { UserSeedService } from './user/user-seed.service';

const runSeed = async () => {
  const app = await NestFactory.create(SeedModule);

  // run
  await app.get(RoleSeedService).run();
  await app.get(StatusSeedService).run();
  // Hub, Vehicle, and Driver data are managed directly via UI and DB, no longer seeded on deployment to preserve operational data
  // await app.get(HubSeedService).run();
  await app.get(UserSeedService).run();
  // await app.get(VehicleSeedService).run();
  // await app.get(DriverSeedService).run();

  await app.close();
};

void runSeed();
