import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { AbstractBaseEntity } from '../../../../../utils/abstract-base.entity';

@Entity({
  name: 'cron_job_config',
})
@Unique('UQ_cron_job_config_jobKey', ['jobKey'])
export class CronJobConfigEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('IDX_cron_job_config_jobKey')
  @Column({ type: String, length: 80, nullable: false })
  jobKey: string;

  @Column({ type: String, length: 150, nullable: false })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', nullable: false, default: true })
  isEnabled: boolean;

  /** Daily execution time in HH:mm (Vietnam Time GMT+7), default '18:05' */
  @Column({ type: String, length: 5, nullable: false, default: '18:05' })
  cronTime: string;

  /** Operational day cutoff hour in GMT+7 (default 18 = 6:00 PM) */
  @Column({ type: 'int', nullable: false, default: 18 })
  cutoffHour: number;

  @Column({ type: 'boolean', nullable: false, default: true })
  notifySuperAdmins: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastRunAt: Date | null;

  @Column({ type: String, length: 20, nullable: true })
  lastRunStatus: string | null;

  @Column({ type: String, length: 10, nullable: true })
  lastReportDate: string | null;

  @Column({ type: 'int', nullable: true })
  updatedByUserId: number | null;
}
